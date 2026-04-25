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

    const prompt = `You are an experienced ${businessType} coach creating a weekly training plan structure for a client.

Coaching approach: ${style}

CLIENT PROFILE:
Name: ${profile.full_name}
Age: ${profile.age} | Gender: ${profile.gender}
Height: ${profile.height_cm}cm | Weight: ${profile.weight_kg}kg
Fitness Level: ${profile.fitness_level}
Available Days: ${profile.available_days}
Goal: ${profile.goal}
Medical Conditions / Injuries: ${profile.medical_conditions || 'None'}

Output ONLY a list of day headings — one line per day. No exercises, no descriptions, no extra text.
Format exactly like this example:
Day 1 – Lower Body Strength (Injury Safe) + Core Stability
Day 2 – Upper Body Push (Shoulder-Friendly) + Cardio
Day 3 – Active Recovery + Mobility + Rehab

Rules:
- Cover only the client's available days (skip rest days if not listed, or label them Rest)
- Each heading must reflect their goal and any injuries or limitations
- Keep each heading concise — session focus + any relevant modifier in brackets
- Output nothing else. No intro, no sign-off, no blank lines before or after the list.`

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    })

    const plan = message.content[0].type === 'text' ? message.content[0].text : null
    return NextResponse.json({ plan })

  } catch (error: any) {
    console.error('Plan generation error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}