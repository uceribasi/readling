/** Draws the shareable progress image (1200×630, the usual link-preview size). */

export interface ShareCardData {
  heading: string
  stats: { value: string; label: string }[]
  /** Words added per day, oldest first. */
  days: number[]
  footer: string
}

export const SHARE_CARD_SIZE = { width: 1200, height: 630 }

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight: number) {
  let fontSize = size
  do {
    context.font = `${weight} ${fontSize}px ${FONT}`
    fontSize -= 2
  } while (context.measureText(text).width > maxWidth && fontSize > 16)
}

export async function renderShareCard(data: ShareCardData): Promise<Blob> {
  const { width, height } = SHARE_CARD_SIZE
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is not supported')

  const background = context.createLinearGradient(0, 0, width, height)
  background.addColorStop(0, '#4338ca')
  background.addColorStop(1, '#6d28d9')
  context.fillStyle = background
  context.fillRect(0, 0, width, height)

  const padding = 72
  context.textBaseline = 'alphabetic'
  context.fillStyle = '#ffffff'

  const logo = await loadImage(`${import.meta.env.BASE_URL}favicon.svg`)
  if (logo) context.drawImage(logo, padding, padding - 6, 44, 44)
  context.font = `600 30px ${FONT}`
  context.fillText('readling', padding + (logo ? 58 : 0), padding + 28)

  fitText(context, data.heading, width - padding * 2, 64, 700)
  context.fillText(data.heading, padding, 210)

  // Big numbers in a row.
  const columnWidth = (width - padding * 2) / data.stats.length
  data.stats.forEach((stat, index) => {
    const x = padding + index * columnWidth
    context.fillStyle = '#ffffff'
    fitText(context, stat.value, columnWidth - 24, 72, 700)
    context.fillText(stat.value, x, 330)
    context.fillStyle = 'rgba(255, 255, 255, 0.75)'
    fitText(context, stat.label, columnWidth - 24, 26, 500)
    context.fillText(stat.label, x, 370)
  })

  // Daily new words as small bars.
  const chartTop = 420
  const chartHeight = 110
  const max = Math.max(1, ...data.days)
  const gap = 6
  const barWidth = (width - padding * 2 - gap * (data.days.length - 1)) / data.days.length
  data.days.forEach((count, index) => {
    const barHeight = Math.max(4, (count / max) * chartHeight)
    context.fillStyle = count > 0 ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.2)'
    context.beginPath()
    context.roundRect(padding + index * (barWidth + gap), chartTop + chartHeight - barHeight, barWidth, barHeight, 3)
    context.fill()
  })

  context.fillStyle = 'rgba(255, 255, 255, 0.75)'
  context.font = `500 24px ${FONT}`
  context.fillText(data.footer, padding, height - 44)

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the image'))), 'image/png'),
  )
}
