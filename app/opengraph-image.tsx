import { ImageResponse } from 'next/og'

// Preview card shown when getcoachboard.com is shared on WhatsApp, LinkedIn, etc.
export const alt = 'CoachBoard: renewals, reminders and training plans for gyms and coaches'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#F6F6F3', padding: '72px', color: '#1B1E23' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: 12, background: '#EA620C', color: 'white', fontSize: 40, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>C</div>
          <div style={{ fontSize: 44, fontWeight: 800 }}>CoachBoard</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, maxWidth: 1000 }}>Renewals, reminders and training plans. On one phone.</div>
          <div style={{ marginTop: 28, fontSize: 32, color: '#5E646E' }}>For gyms, studios and personal trainers</div>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ height: 12, width: 240, background: '#EA620C', borderRadius: 6 }} />
          <div style={{ height: 12, width: 240, background: '#2350B8', borderRadius: 6 }} />
        </div>
      </div>
    ),
    { ...size }
  )
}
