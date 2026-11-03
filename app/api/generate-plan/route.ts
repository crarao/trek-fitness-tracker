import Anthropic from '@anthropic-ai/sdk'
import { isGymType } from '@/lib/leads'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCaller, PLAN_ROLES, forbidden, checkCanManageClient } from '@/lib/auth-server'
import { normalizePlan, planToText, workoutDays, parseAvailableDays, daysPerWeekMentioned, WEEKDAYS, type PlanJson, type Weekday } from '@/lib/plan-structure'
import { recordAiUsage } from '@/lib/ai-usage'
import { getAiPlanUsage, type AiPlanUsage } from '@/lib/ai-plan-limit'
import { normalizeCountry, formatDate } from '@/lib/locale'

export const maxDuration = 60

const client = new Anthropic()

const EXERCISE = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    sets: { type: 'string' },
    reps: { type: 'string' },
    rest: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['name', 'sets', 'reps', 'rest', 'note'],
} as const

// Fixed form the AI fills in, so plans arrive as days and exercises instead of free text
const PLAN_TOOL: Anthropic.Tool = {
  name: 'weekly_plan',
  description: 'Save the weekly training plan: all 7 days, Monday to Sunday.',
  input_schema: {
    type: 'object',
    properties: {
      days: {
        type: 'array',
        minItems: 7,
        maxItems: 7,
        items: {
          type: 'object',
          properties: {
            day: { type: 'string', enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
            rest: { type: 'boolean' },
            focus: { type: 'string' },
            exercises: { type: 'array', items: EXERCISE },
          },
          required: ['day', 'rest', 'focus', 'exercises'],
        },
      },
      note: { type: 'string' },
    },
    required: ['days', 'note'],
  },
}

const coachingStyles: Record<string, string> = {
  gym: `Focus on strength training, sets and reps, gym equipment. Use fitness terminology a gym coach would use. Include exercises using common gym equipment like dumbbells, barbells, cables and machines.`,
  trek: `Focus on cardio endurance, leg strength, breathing capacity and altitude preparation. Think hiking, stair climbing, loaded walks and mountain fitness. Prepare the client physically for trekking demands.`,
  pilates: `Focus on core strength, posture, controlled movements, breathing technique and body alignment. Use pilates terminology and progressive exercises suitable for their level.`,
  yoga: `Focus on flexibility, balance, mindfulness and progressive poses suited to their fitness level. Include breathing exercises and relaxation techniques.`,
  cycling: `Focus on leg endurance, cadence, interval training and cardiovascular fitness. Include both on-bike and off-bike strength work.`,
  general: `Focus on overall fitness with a balanced mix of cardio, strength and flexibility exercises.`
}

// Available days the AI left as rest (or with no exercises)
function missingWorkoutDays(plan: PlanJson, trainDays: Weekday[]): Weekday[] {
  return trainDays.filter(d => {
    const day = plan.days.find(x => x.day === d)
    return !day || day.rest || day.exercises.length === 0
  })
}

// Days outside Available Days always end up as rest days with at most an optional light item,
// even if the AI marked them rest but still filled in a workout
const LIGHT_ITEM = { name: 'Light walk or stretching', sets: '', reps: '20 min', rest: '', note: 'Optional' }
function enforceSchedule(plan: PlanJson, trainDays: Weekday[]): PlanJson {
  if (!trainDays.length) return plan
  return {
    ...plan,
    days: plan.days.map(d => {
      if (trainDays.includes(d.day)) return d
      if (d.rest && d.exercises.length <= 1) return { ...d, focus: '' }
      return { ...d, rest: true, focus: '', exercises: [LIGHT_ITEM] }
    }),
  }
}

// Time for the whole request (maxDuration is 60 s); the schedule retry only runs if it fits
const TIME_BUDGET_MS = 52_000
const MIN_RETRY_MS = 20_000

export async function POST(request: Request) {
  const startedAt = Date.now()
  // Only gym staff, coaches (PT clients only) or super admin can generate plans — protects Anthropic credits
  const { caller, error: authError } = await getCaller(PLAN_ROLES)
  if (authError) return authError

  try {
    const { profile } = await request.json()
    const clientId: string | undefined = typeof profile?.id === 'string' ? profile.id : undefined
    if (!clientId) return NextResponse.json({ error: 'Client missing' }, { status: 400 })

    // Staff can only generate for clients in their own gym (checked against the database, not the request)
    const notAllowed = await checkCanManageClient(caller, clientId)
    if (notAllowed) return notAllowed

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    // The client's gym, read from the database (for super admin this is the only source)
    const { data: clientRow } = await admin.from('profiles').select('company_id').eq('id', clientId).single()
    const companyId: string | null = caller.role === 'super_admin' ? clientRow?.company_id ?? null : caller.companyId
    if (caller.role !== 'super_admin' && clientRow?.company_id !== caller.companyId) return forbidden()

    let usage: AiPlanUsage | null = null
    if (companyId) {
      const { data: company } = await admin.from('companies').select('*').eq('id', companyId).single()
      // Turned off for this company by the super admin (absent before the column exists = allowed)
      if ((company as { ai_plans_enabled?: boolean | null } | null)?.ai_plans_enabled === false) {
        return NextResponse.json({ error: 'AI plans are turned off for this gym. You can still write or edit plans by hand.' }, { status: 403 })
      }
      // #37: cap AI plans per client per month (super admin is not capped, but sees the count)
      const country = normalizeCountry((company as { country?: string | null } | null)?.country)
      usage = await getAiPlanUsage(admin, clientId, country)
      if (usage && usage.used >= usage.limit && caller.role !== 'super_admin') {
        return NextResponse.json({
          error: `All ${usage.limit} AI plans for this client are used this month. You can still write or edit plans by hand. More AI plans from ${formatDate(usage.resetsOn, country, 'dayMonth')}.`,
          aiPlans: usage,
        }, { status: 429 })
      }
    }

    const businessType = profile.business_type || 'gym'
    // Martial arts (dojo) is treated like a gym type (lib/leads.ts GYM_TYPES): the gym approach, worded "martial arts coach"
    const style = coachingStyles[businessType] || (isGymType(businessType) ? coachingStyles.gym : coachingStyles.general)

    // The schedule comes from the Available Days chips, worked out here so the AI can't miscount
    const trainDays = parseAvailableDays(profile.available_days)
    const restDays = WEEKDAYS.filter(d => trainDays.length && !trainDays.includes(d))
    const schedule = trainDays.length
      ? `WEEKLY SCHEDULE (fixed, do not change):
- Workout days (exactly ${trainDays.length}): ${trainDays.join(', ')}
- Rest days (exactly ${restDays.length}): ${restDays.length ? restDays.join(', ') : 'none'}
If the Goal or Medical Conditions text mentions a different number of days, still follow this schedule exactly.`
      : `WEEKLY SCHEDULE: no available days were set. Pick a sensible number of workout days for the client's goal and level.`

    // The chips win over the free text; tell the coach when the notes say something else
    const mentioned = daysPerWeekMentioned(profile.goal) ?? daysPerWeekMentioned(profile.medical_conditions)
    const scheduleNotes: string[] = []
    if (trainDays.length && mentioned && mentioned !== trainDays.length) {
      scheduleNotes.push(`This plan uses the Available Days from the client's profile (${trainDays.join(', ')}: ${trainDays.length} days). `
        + `The client's notes mention ${mentioned} days a week. If the profile is wrong, update Available Days and generate again.`)
    }

    const prompt = `You are an experienced ${businessType.replace(/_/g, ' ')} coach creating a detailed weekly training plan for a client.

Coaching approach: ${style}

CLIENT PROFILE:
Name: ${profile.full_name}
Age: ${profile.age} | Gender: ${profile.gender}
Height: ${profile.height_cm}cm | Weight: ${profile.weight_kg}kg
Fitness Level: ${profile.fitness_level}
Available Days: ${trainDays.length ? trainDays.join(', ') : 'Not set'}
Goal: ${profile.goal}
Medical Conditions / Injuries: ${profile.medical_conditions || 'None'}

${schedule}

PRIORITY RULES (these override the coaching approach above):
- Treat every instruction in the Goal and Medical Conditions fields as a hard requirement for equipment, exercise choice and preferences (the weekly schedule above decides which days are workouts).
- If machines are excluded, do NOT use any machine or cable station (no cable exercises, pec deck, leg press, leg curl, lat pulldown, smith machine). Free weights, bodyweight and outdoor exercises are allowed unless also excluded.
- If the client has knee pain, avoid deep or heavy loaded knee flexion (back squats, deep lunges, jumping) and prefer knee-friendly alternatives (glute bridges, hip thrusts, step-ups to a low box, wall sits with limited range).
- Never include exercises that could aggravate the listed medical conditions or injuries.
- Give every workout day in the schedule a full workout; never turn one into a rest day.
- Before answering, silently check every exercise against these rules and replace any that break them.
- Schedule workouts ONLY on the workout days above. Every other day of the week must be a rest day (optional light walk/stretching only).

OUTPUT: call the weekly_plan tool. Fill in all 7 days, Monday to Sunday.
- Workout days: rest = false, a short focus (e.g. "Lower Body Strength"), 5–7 exercises including a warm-up first and a cool-down last.
- Every other day: rest = true, focus "", and either no exercises or one optional light item (e.g. "Light walk or stretching" – 20 min).
- Each exercise: name, sets (a number, e.g. "3"), reps (e.g. "10", "8–12", "30 s", "1 km"), rest (e.g. "60 s"), and an optional short note (a form cue or a safety tip). Use "" for parts that don't apply.
- note: "Review with your coach before starting. Not medical advice."
Plain words only, no markdown symbols.`

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]
    const askAi = async (options?: Anthropic.RequestOptions) => {
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        tools: [PLAN_TOOL],
        tool_choice: { type: 'tool', name: 'weekly_plan' },
        messages,
      }, options)
      // Cost of this call, per gym, for the super admin Dashboard (the client's gym)
      await recordAiUsage({
        companyId, userId: caller.userId, clientId, feature: 'plan', model: message.model, usage: message.usage,
      })
      const toolUse = message.content.find(c => c.type === 'tool_use')
      const plan = toolUse && toolUse.type === 'tool_use' ? normalizePlan(toolUse.input) : null
      return { message, toolUse, plan }
    }

    const first = await askAi()
    let { message } = first
    const { toolUse } = first
    let planJson = first.plan

    // The AI sometimes leaves a workout day as rest. Ask it once to fix that (still one plan towards the
    // client's monthly cap; both calls are recorded as cost), if there's time left. Extra workout days
    // need no retry: enforceSchedule turns them into rest days below.
    const missing = planJson ? missingWorkoutDays(planJson, trainDays) : []
    const timeLeft = TIME_BUDGET_MS - (Date.now() - startedAt)
    if (planJson && missing.length && toolUse && toolUse.type === 'tool_use' && timeLeft >= MIN_RETRY_MS) {
      messages.push({ role: 'assistant', content: message.content })
      messages.push({ role: 'user', content: [{
        type: 'tool_result', tool_use_id: toolUse.id, is_error: true,
        content: `The schedule is wrong. These must be workout days with a full workout: ${missing.join(', ')}. Workout days are exactly ${trainDays.join(', ')}; every other day is a rest day. Call weekly_plan again with all 7 days, keeping every other rule.`,
      }] })
      try {
        const retry = await askAi({ timeout: timeLeft, maxRetries: 0 })
        // Use the retry only if it is actually better
        if (retry.plan && workoutDays(retry.plan).length && missingWorkoutDays(retry.plan, trainDays).length < missing.length) {
          planJson = retry.plan
          message = retry.message
        }
      } catch (e) {
        // The first plan is usable and already paid for: keep it rather than failing the request
        console.error('Plan generation: schedule retry failed, keeping first plan', e)
      }
    }
    if (planJson) {
      planJson = enforceSchedule(planJson, trainDays)
      const stillMissing = missingWorkoutDays(planJson, trainDays)
      if (stillMissing.length && workoutDays(planJson).length) {
        scheduleNotes.push(`The AI left ${stillMissing.join(', ')} without a workout. Add exercises for ${stillMissing.length === 1 ? 'that day' : 'those days'} before assigning, or generate again.`)
      }
    }

    // Counts as one plan towards the month even if the output below turns out unusable (it was paid for)
    const aiPlans = usage ? { ...usage, used: usage.used + 1 } : null

    // The plan comes back as structured days; the text copy is built from it
    if (!planJson || workoutDays(planJson).length === 0) {
      console.error('Plan generation: unusable output', message.stop_reason)
      return NextResponse.json({ error: 'The AI returned an incomplete plan. Please try again.', aiPlans }, { status: 502 })
    }
    return NextResponse.json({ plan: planToText(planJson), plan_json: planJson, aiPlans, scheduleNotes })

  } catch (error: any) {
    console.error('Plan generation error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}