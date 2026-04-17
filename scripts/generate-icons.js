const { createCanvas } = require('canvas')
const fs = require('fs')
const path = require('path')

function generateIcon(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')

  // Background
  ctx.fillStyle = '#030712'
  ctx.fillRect(0, 0, size, size)

  // Rounded rectangle orange background
  const padding = size * 0.15
  const radius = size * 0.2
  ctx.fillStyle = '#f97316'
  ctx.beginPath()
  ctx.moveTo(padding + radius, padding)
  ctx.lineTo(size - padding - radius, padding)
  ctx.quadraticCurveTo(size - padding, padding, size - padding, padding + radius)
  ctx.lineTo(size - padding, size - padding - radius)
  ctx.quadraticCurveTo(size - padding, size - padding, size - padding - radius, size - padding)
  ctx.lineTo(padding + radius, size - padding)
  ctx.quadraticCurveTo(padding, size - padding, padding, size - padding - radius)
  ctx.lineTo(padding, padding + radius)
  ctx.quadraticCurveTo(padding, padding, padding + radius, padding)
  ctx.closePath()
  ctx.fill()

  // Letter C
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${size * 0.5}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('C', size / 2, size / 2)

  return canvas.toBuffer('image/png')
}

const publicDir = path.join(__dirname, '..', 'public')
fs.writeFileSync(path.join(publicDir, 'icon-192.png'), generateIcon(192))
fs.writeFileSync(path.join(publicDir, 'icon-512.png'), generateIcon(512))
console.log('Icons generated successfully!')