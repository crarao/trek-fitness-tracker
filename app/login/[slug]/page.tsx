import { redirect } from 'next/navigation'

// Branded login link getcoachboard.com/login/<slug> (shown in /admin under the Slug field).
// The login page reads the company from ?company=<slug>, so forward there; old ?company= links keep working.
export default async function CompanyLogin({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  redirect(`/login?company=${encodeURIComponent(slug.toLowerCase())}`)
}
