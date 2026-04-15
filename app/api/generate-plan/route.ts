import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'

const client = new Anthropic()

const coachingStyles: Record<string, string> = {
  gym: `Focus on strength training, sets and reps, gym equipment. Use fitness terminology a gym coach would use. Include exercises using common gym equipment like dumbbells, barbells, cables and machines.`,
  trek: `Focus on cardio endurance, leg strength, breathing capacity and altitude preparation. Think hiking, stair climbing, loaded walks and mountain fitness. Prepare the client physically for trekking demands.`,
  pilates: `Focus on core strength, posture, controlled movements, breathing technique and body alignment. Use pilates terminology and progressive exercises suitable for their level.`,
  yoga: `Focus on flexibility, balance, mindfulness and progressive poses suited to their fitness level. Include breathing exercises and relaxation techniques.`,
  cycling: `Focus on leg endurance, cadence, interval training and cardiovascular fitness. Include both on-bike and off-bike strength work.`,
  general: `Focus on overall fitness with a balanced mix of cardio, strength and flexibility exercises.`
}

export async function POST(request: Request) {
  try {
    const { profile } = await request.json()

    const businessType = profile.business_type || 'gym'
    const style = coachingStyles[businessType] || coachingStyles.general

    const prompt = `You are a friendly, experienced ${businessType} coach writing a weekly training plan for a client. Write in plain conversational language — no markdown, no asterisks, no hashtags, no tables. Just clean text a coach would write.

Coaching approach: ${style}

CLIENT PROFILE:
Name: ${profile.full_name}
Age: ${profile.age} | Gender: ${profile.gender}
Height: ${profile.height_cm}cm | Weight: ${profile.weight_kg}kg
Fitness Level: ${profile.fitness_level}
Available Days: ${profile.available_days}
Food Preference: ${profile.food_preference}
Medical Conditions: ${profile.medical_conditions || 'None'}
Goal: ${profile.goal}

Write a weekly plan covering only their available days. For each day write:
- Day name and session focus on one line
- Warm up in 2-3 sentences
- Main workout with 4-6 exercises written naturally with sets and reps
- Cool down in 1-2 sentences
- One short nutrition tip relevant to their food preference

Keep each day concise — a coach talking to a client, not a textbook.
If they have medical conditions, quietly adjust exercises without making a big deal of it.
End with one encouraging line about their goal.
Write as if speaking directly to ${profile.full_name}.`

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })

    const plan = message.content[0].type === 'text' ? message.content[0].text : null
    return NextResponse.json({ plan })

  } catch (error: any) {
    console.error('Plan generation error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}