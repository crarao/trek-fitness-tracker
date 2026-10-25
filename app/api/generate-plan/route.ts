import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { getCaller, STAFF, forbidden } from '@/lib/auth-server'
import { normalizePlan, planToText, workoutDays } from '@/lib/plan-structure'

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

export async function POST(request: Request) {
  // Only gym staff (or super admin) can generate plans — protects Anthropic credits
  const { caller, error: authError } = await getCaller(STAFF)
  if (authError) return authError

  try {
    const { profile } = await request.json()

    // Staff can only generate for clients in their own gym
    if (caller.role !== 'super_admin' && profile?.company_id && profile.company_id !== caller.companyId) {
      return forbidden()
    }

    const businessType = profile.business_type || 'gym'
    const style = coachingStyles[businessType] || coachingStyles.general

    const prompt = `You are an experienced ${businessType} coach creating a detailed weekly training plan for a client.

Coaching approach: ${style}

CLIENT PROFILE:
Name: ${profile.full_name}
Age: ${profile.age} | Gender: ${profile.gender}
Height: ${profile.height_cm}cm | Weight: ${profile.weight_kg}kg
Fitness Level: ${profile.fitness_level}
Available Days: ${profile.available_days}
Goal: ${profile.goal}
Medical Conditions / Injuries: ${profile.medical_conditions || 'None'}

PRIORITY RULES (these override the coaching approach above):
- Treat every instruction in the Goal and Medical Conditions fields as a hard requirement, including schedule, rest days, equipment and exercise preferences.
- If machines are excluded, do NOT use any machine or cable station (no cable exercises, pec deck, leg press, leg curl, lat pulldown, smith machine). Free weights, bodyweight and outdoor exercises are allowed unless also excluded.
- If the client has knee pain, avoid deep or heavy loaded knee flexion (back squats, deep lunges, jumping) and prefer knee-friendly alternatives (glute bridges, hip thrusts, step-ups to a low box, wall sits with limited range).
- Never include exercises that could aggravate the listed medical conditions or injuries.
- Match the exact number of workout days and rest days requested.
- Before answering, silently check every exercise against these rules and replace any that break them.
- Schedule workouts ONLY on the client's Available Days. Every other day of the week must be "REST DAY" (optional light walk/stretching only).

OUTPUT: call the weekly_plan tool. Fill in all 7 days, Monday to Sunday.
- Workout days: rest = false, a short focus (e.g. "Lower Body Strength"), 5–7 exercises including a warm-up first and a cool-down last.
- Every other day: rest = true, focus "", and either no exercises or one optional light item (e.g. "Light walk or stretching" – 20 min).
- Each exercise: name, sets (a number, e.g. "3"), reps (e.g. "10", "8–12", "30 s", "1 km"), rest (e.g. "60 s"), and an optional short note (a form cue or a safety tip). Use "" for parts that don't apply.
- note: "Review with your coach before starting. Not medical advice."
Plain words only, no markdown symbols.`

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      tools: [PLAN_TOOL],
      tool_choice: { type: 'tool', name: 'weekly_plan' },
      messages: [{ role: 'user', content: prompt }]
    })

    // The plan comes back as structured days; the text copy is built from it
    const toolUse = message.content.find(c => c.type === 'tool_use')
    const planJson = toolUse && toolUse.type === 'tool_use' ? normalizePlan(toolUse.input) : null
    if (!planJson || workoutDays(planJson).length === 0) {
      console.error('Plan generation: unusable output', message.stop_reason)
      return NextResponse.json({ error: 'The AI returned an incomplete plan. Please try again.' }, { status: 502 })
    }
    return NextResponse.json({ plan: planToText(planJson), plan_json: planJson })

  } catch (error: any) {
    console.error('Plan generation error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}