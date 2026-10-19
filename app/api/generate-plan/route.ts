import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'

export const maxDuration = 60

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

FORMAT (plain text, no markdown symbols like # or **):
Day 1 – <Session focus> (<modifier>)
- <Exercise> – <sets> x <reps or time>, rest <seconds>s
- ... (5–7 exercises per day, including a warm-up and cool-down line)

Leave one blank line between days. Cover only the client's available days.
End with one line: "Note: Review with your coach before starting. Not medical advice."
Output nothing else — no intro, no sign-off.`

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