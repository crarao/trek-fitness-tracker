import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { sessions, goal, clientName } = await request.json()

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({ insight: null })
    }

    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })

    const sessionSummary = sessions.map((s: any) =>
      `Date: ${s.session_date}, Duration: ${s.duration_minutes || 0} mins, Notes: ${s.notes || 'none'}`
    ).join('\n')

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `You are a supportive fitness coach. Analyze this client's training data and give a brief 3-4 sentence encouraging insight.

Client: ${clientName}
Goal: ${goal || 'Not set'}

Sessions:
${sessionSummary}

Be warm, specific and motivating.`
      }]
    })

    const insight = message.content[0].type === 'text' ? message.content[0].text : null
    return NextResponse.json({ insight })

  } catch (error: any) {
    console.error('AI insights error:', error)
    return NextResponse.json({ error: error.message, full: JSON.stringify(error) }, { status: 500 })
  }
}