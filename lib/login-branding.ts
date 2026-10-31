// What a gym's login screen shows when the gym hasn't uploaded its own banner: a stock photo and a
// tagline for its business type. Used by the login page and the super admin's branding preview.

type Branded = { banner_url?: string | null; business_type?: string | null; banner_has_branding?: boolean | null }

export const DEFAULT_BANNERS: Record<string, string> = {
  gym: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1200&q=80',
  pilates: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=1200&q=80',
  yoga: 'https://images.unsplash.com/photo-1588286840104-8957b019727f?w=1200&q=80',
  trek: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=80',
  cycling: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=80',
  general: 'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=1200&q=80'
}

export const DEFAULT_TAGLINES: Record<string, string> = {
  gym: 'Real Training. Real Results.',
  pilates: 'Strength From Within.',
  yoga: 'Find Your Balance.',
  trek: 'Every Summit Begins With A Single Step.',
  cycling: 'Push Your Limits.',
  general: 'Achieve Your Goals.'
}

export const bannerFor = (c: Branded | null | undefined) =>
  c?.banner_url || DEFAULT_BANNERS[c?.business_type || 'general'] || DEFAULT_BANNERS.general

export const taglineFor = (c: Branded | null | undefined) =>
  DEFAULT_TAGLINES[c?.business_type || 'general'] || DEFAULT_TAGLINES.general

// The gym's uploaded banner is a finished design with its own name / logo (switch set by super admin,
// db/2026-10-31-banner-branding.md): show it whole, without the name, tagline and logo on top
export const bannerShowsBranding = (c: Branded | null | undefined) => !!(c?.banner_has_branding && c?.banner_url)
