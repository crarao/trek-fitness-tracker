// Editable content for the public home page (getcoachboard.com).
// Change these values without touching the page layout in app/page.tsx.

// Not shown on the page any more: visitors use the contact form (saved to contact_requests,
// read in /admin → Requests). Kept here for a future email notification.
export const CONTACT_EMAIL = 'crarao@gmail.com'

export const DEMO_SUBJECT = 'CoachBoard demo'

// Testimonials appear on the page automatically once this list has at least one entry.
// Example:
// { quote: 'We stopped losing renewals the first month.', name: 'Priya S.', role: 'Owner', place: 'Iron House Gym, Pune' },
export type Testimonial = { quote: string; name: string; role: string; place: string }

export const TESTIMONIALS: Testimonial[] = []
