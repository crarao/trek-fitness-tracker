import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/auth-server'
import { recordAiUsage } from '@/lib/ai-usage'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  // Must be logged in (clients request their own insights; staff may too)
  const { caller, error: authError } = await getCaller(['client', 'company_admin', 'partner', 'super_admin'])
  if (authError) return authError

  try {
    const { sessions, goal, clientName } = await request.json()

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({ insight: null })
    }

    // Turned off for this gym by the super admin: no AI call (and no cost)
    if (caller.companyId) {
      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
      const { data: co } = await admin.from('companies').select('ai_insights_enabled').eq('id', caller.companyId).single()
      if (co?.ai_insights_enabled === false) {
        return NextResponse.json({ error: 'AI insights are turned off for this gym' }, { status: 403 })
      }
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

    await recordAiUsage({ companyId: caller.companyId, userId: caller.userId, feature: 'insights', model: message.model, usage: message.usage })

    const insight = message.content[0].type === 'text' ? message.content[0].text : null
    return NextResponse.json({ insight })

  } catch (error: any) {
    console.error('AI insights error:', error)
    return NextResponse.json({ error: error.message, full: JSON.stringify(error) }, { status: 500 })
  }
}