import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCaller, STAFF, checkCanManageClient } from '@/lib/auth-server'
import { recordAiUsage } from '@/lib/ai-usage'

export const maxDuration = 60

const anthropic = new Anthropic()

// Generic daily diet chart from the client's profile.
// The client's details are read on the server (not trusted from the browser),
// and only staff of the client's own gym (or super admin) can call this.
export async function POST(request: Request) {
  const { caller, error: authError } = await getCaller(STAFF)
  if (authError) return authError

  try {
    const { clientId } = await request.json()
    if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

    const notAllowed = await checkCanManageClient(caller, clientId)
    if (notAllowed) return notAllowed

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: p, error: pError } = await admin
      .from('profiles')
      .select('company_id, full_name, goal, age, gender, height_cm, weight_kg, fitness_level, food_preference, meals_per_day, medical_conditions, available_days, companies:company_id(country, business_type)')
      .eq('id', clientId)
      .single()
    if (pError || !p) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const company = (p as { companies?: { country?: string | null; business_type?: string | null } }).companies
    const isUS = company?.country === 'US'
    const meals = p.meals_per_day || 4

    const cuisine = isUS
      ? 'Use everyday foods easily found in US grocery stores. Use US units (oz, cups) alongside grams where helpful.'
      : 'Use simple Indian home-style foods (dal, roti, rice, sabzi, curd, paneer, eggs, seasonal fruit, etc.) that work across Indian regions. Use household measures (katori, roti count, cup) alongside grams.'

    const prompt = `You are a sports nutrition coach writing a simple, practical one-day diet chart for a ${company?.business_type || 'gym'} client.

CLIENT PROFILE:
Goal: ${p.goal || 'general fitness'}
Age: ${p.age ?? 'unknown'} | Gender: ${p.gender || 'unknown'}
Height: ${p.height_cm ? p.height_cm + ' cm' : 'unknown'} | Weight: ${p.weight_kg ? p.weight_kg + ' kg' : 'unknown'}
Fitness level: ${p.fitness_level || 'unknown'}
Training days: ${p.available_days || 'not set'}
Food preference: ${p.food_preference || 'not set'}
Meals per day: ${meals}
Medical conditions / injuries: ${p.medical_conditions || 'None'}

RULES (hard requirements):
- Respect the food preference strictly: Vegetarian = no meat, fish or eggs; Eggetarian = vegetarian + eggs; Vegan = no animal products incl. dairy and honey; Jain = vegetarian, no eggs, no root vegetables (onion, garlic, potato, carrot, beetroot); Non-Vegetarian = any.
- Exactly ${meals} meals/snacks, with suggested times.
- ${cuisine}
- If weight and height are known, estimate a daily calorie and protein target suited to the goal; otherwise say "Targets: ask your coach".
- Keep portions realistic and the chart affordable. No supplements unless the goal clearly needs them, and then only protein powder as optional.
- If medical conditions are listed, keep the chart conservative and add one line advising the client to confirm with their doctor.

FORMAT (plain text, no markdown symbols like # or **):
Daily target: <~kcal> kcal · <~g> g protein (estimate)

<Meal name> (<time>)
- <food> – <portion>
- <food> – <portion>

(one block per meal, blank line between meals)

Swaps: <one line with 2–3 easy swaps>
Water: <one line>
Note: Review with your coach. Not medical advice.
Output nothing else.`

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    })

    await recordAiUsage({ companyId: p.company_id, userId: caller.userId, feature: 'diet', model: message.model, usage: message.usage })

    const diet = message.content[0].type === 'text' ? message.content[0].text.trim() : null
    if (!diet) return NextResponse.json({ error: 'The AI returned an empty diet chart' }, { status: 502 })
    return NextResponse.json({ diet })
  } catch (error: unknown) {
    console.error('Diet generation error:', error)
    const message = error instanceof Error ? error.message : 'Diet generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
