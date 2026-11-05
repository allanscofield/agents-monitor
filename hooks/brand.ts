export const LOGO_DEFS = ''

export function logo(x: number, y: number, h: number, o: { live?: boolean; ink?: string } = {}): { svg: string; w: number } {
  const k = h / 32
  const ink = o.ink ?? '#FFFFFF'
  const font = `style="font-family:'SF Pro Display',system-ui,-apple-system,sans-serif"`
  const label =
    `<text x="0" y="23" font-size="22" font-weight="700" letter-spacing="-0.4" fill="${ink}" ${font}>Agents</text>` +
    `<text x="79" y="23" font-size="22" font-weight="500" letter-spacing="-0.4" fill="${ink}" fill-opacity="0.6" ${font}>Monitor</text>`
  const width = 166
  return {
    svg: `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(4)})">${label}</g>`,
    w: width * k,
  }
}
