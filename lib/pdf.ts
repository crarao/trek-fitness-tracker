// Minimal PDF writer: one JPEG image per A4 page, filling the page.
// Enough for reports drawn on a canvas (text, emoji and charts look exactly as drawn),
// without adding a PDF library. Text in the PDF is part of the picture (not selectable).

export type PdfPage = { jpeg: Uint8Array; width: number; height: number } // pixel size of the image

const A4 = { w: 595.28, h: 841.89 } // points

export function imagesToPdf(pages: PdfPage[]): Blob {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part
    chunks.push(bytes)
    length += bytes.length
  }
  const object = (id: number, ...parts: (string | Uint8Array)[]) => {
    offsets[id] = length
    push(`${id} 0 obj\n`)
    parts.forEach(push)
    push('\nendobj\n')
  }

  // Objects: 1 catalog, 2 page list, then 3 per page (page, drawing, image)
  const pageId = (i: number) => 3 + i * 3
  push('%PDF-1.4\n%âãÏÓ\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`)
  pages.forEach((p, i) => {
    const id = pageId(i)
    const draw = `q ${A4.w} 0 0 ${A4.h} 0 0 cm /Im0 Do Q`
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`)
    object(id + 1, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`)
    object(id + 2,
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream')
  })

  const count = 3 + pages.length * 3
  const xref = length
  push(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}
