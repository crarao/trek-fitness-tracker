// Editable content for the public home page (getcoachboard.com).
// Change these values without touching the page layout in app/page.tsx.

// Not shown on the page any more: visitors use the contact form (saved to contact_requests,
// read in /admin → Requests). Kept here for a future email notification.
export const CONTACT_EMAIL = 'crarao@gmail.com'

export const DEMO_SUBJECT = 'CoachBoard demo'

// Shown in the contact box under the form
export const INSTAGRAM_HANDLE = 'coachboard.in'
export const INSTAGRAM_URL = `https://www.instagram.com/${INSTAGRAM_HANDLE}/`

// Testimonials appear on the page automatically once this list has at least one entry.
// Example:
// { quote: 'We stopped losing renewals the first month.', name: 'Priya S.', role: 'Owner', place: 'Iron House Gym, Pune' },
export type Testimonial = { quote: string; name: string; role: string; place: string }

export const TESTIMONIALS: Testimonial[] = []

// Short product walkthrough videos (YouTube video IDs, e.g. 'dQw4w9WgXcQ').
// Each one appears on the home page automatically once its ID is filled in; empty = hidden.
// renewals → shown in the "For gym owners" section; plans → in the "For personal trainers" section.
export const WALKTHROUGHS = {
  renewals: '',
  plans: '',
}
