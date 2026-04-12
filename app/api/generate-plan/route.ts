import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'

const client = new Anthropic()

export async function POST(request: Request) {
  try {
    const { profile } = await request.json()

    const prompt = `You are an expert fitness coach creating a personalized weekly training plan.

CLIENT PROFILE:
- Name: ${profile.full_name}
- Age: ${profile.age}
- Gender: ${profile.gender}
- Height: ${profile.height_cm} cm
- Weight: ${profile.weight_kg} kg
- Fitness Level: ${profile.fitness_level}
- Available Days: ${profile.available_days}
- Food Preference: ${profile.food_preference}
- Medical Conditions: ${profile.medical_conditions || 'None'}
- Goal: ${profile.goal}

Create a detailed weekly training plan for the available days only.
For each day include:
- Session type and focus
- Specific exercises with sets, reps or duration
- Important notes considering their medical conditions
- Nutrition tip based on their food preference

Format it clearly day by day. Be specific, practical and safe.
If they have medical conditions, modify exercises accordingly.
Keep the plan realistic for their fitness level.`

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