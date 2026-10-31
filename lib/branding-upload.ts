// Gym logo / banner upload (super admin → company edit panel). Files go to the public Supabase Storage
// bucket `branding`, in a folder per company id; the public link is saved in companies.logo_url /
// banner_url. Storage rule: db/2026-10-31-branding-upload.md (only super admin may add files).
// A new upload never overwrites: each gets its own name, so old links keep working and nothing is deleted.
import type { SupabaseClient } from '@supabase/supabase-js'

export type BrandingKind = 'logo' | 'banner'

export const BRANDING_BUCKET = 'branding'

// Logo: longest side 512 px, PNG (keeps transparency). Banner: up to 1600 px wide, JPEG.
const MAX_SIDE: Record<BrandingKind, number> = { logo: 512, banner: 1600 }
const MAX_INPUT_MB = 20

// Shrink in the browser (a phone photo can be 10 MB) and re-encode, which also drops photo metadata
async function prepareImage(file: File, kind: BrandingKind): Promise<{ blob: Blob; ext: string; type: string }> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    throw new Error('Pick a photo or image file (PNG, JPG or WebP)')
  }
  if (file.size > MAX_INPUT_MB * 1024 * 1024) throw new Error(`That file is over ${MAX_INPUT_MB} MB`)

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('Could not read that image. Try a PNG or JPG.')
  }
  const longest = kind === 'logo' ? Math.max(bitmap.width, bitmap.height) : bitmap.width
  const scale = Math.min(1, MAX_SIDE[kind] / longest)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const type = kind === 'logo' ? 'image/png' : 'image/jpeg'
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.85))
  if (!blob) throw new Error('Could not prepare that image')
  return { blob, type, ext: kind === 'logo' ? 'png' : 'jpg' }
}

// Upload and return the public link (not yet saved on the company)
export async function uploadBranding(supabase: SupabaseClient, companyId: string, kind: BrandingKind, file: File) {
  const { blob, ext, type } = await prepareImage(file, kind)
  const path = `${companyId}/${kind}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(BRANDING_BUCKET).upload(path, blob, { contentType: type, upsert: false })
  if (error) {
    // Show Supabase's own words too, so a refusal can be told apart from a size or type limit
    throw new Error(/row-level security|unauthorized|not allowed/i.test(error.message)
      ? `Upload not allowed (${error.message}): check the Storage rules in db/2026-10-31-branding-upload.md`
      : error.message)
  }
  return supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl
}
