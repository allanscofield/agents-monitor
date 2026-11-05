import type { AgentRow, FeedEvent, Snapshot, WikiMark } from '../types'
import {
  ADVISOR_HOT_MS,
  MAIN,
  WIKI_HOT_MS,
  capitalize,
  clock,
  family,
  formatDuration,
  formatTokens,
  isLive,
  modelLabel,
  orderedAgents,
  contextWindowOf,
  percentOf,
  phaseOf,
  wikiActivity,
  wikiTotals,
  type Family,
  type Flow,
  type Phase,
  type WikiActivity,
} from './model'

import { LOGO_DEFS, logo } from './brand'

export const SVG_LIMIT = 120_000

const INK = {
  page: '#07070A',
  core0: '#121217',
  core1: '#0C0C10',
  primary: '#F4F4F5',
  secondary: '#A1A1AA',
  muted: '#6B6B76',
  faint: '#3A3A43',
  hairline: '#1C1C22',
  baseline: '#2A2A31',
}

const STATUS = { good: '#0CA30C', warning: '#FAB219', critical: '#D03B3B' }

export const FAMILY_COLOR: Record<Family, string> = {
  opus: '#C98500',
  sonnet: '#3987E5',
  fable: '#D55181',
  haiku: '#8A8F98',
  other: '#8A8F98',
}

export const CATEGORY_COLOR: Record<FeedEvent['category'], string> = {
  read: '#3987E5',
  write: '#0CA30C',
  bash: '#C98500',
  agent: '#9085E9',
  search: '#199E70',
  web: '#D95926',
  other: '#6B6B76',
  advisor: '#D55181',
  spawn: '#9085E9',
  message: '#9085E9',
  done: '#6B6B76',
}

const DISPLAY = `'SF Pro Display', system-ui, -apple-system, sans-serif`
const TEXT = `'SF Pro Text', system-ui, -apple-system, sans-serif`
const MONO = `'SF Mono', ui-monospace, Menlo, monospace`
const EASE = 'keyTimes="0;1" keySplines="0.32 0.72 0 1" calcMode="spline"'

const GENERIC_TYPES = new Set(['general-purpose', 'subagent', 'claude', 'fork'])

export function agentColor(row: AgentRow | undefined): string {
  return FAMILY_COLOR[family(row?.model)]
}

export function agentName(row: AgentRow | undefined, id: string): string {
  if (!row) return id.slice(0, 8)
  if (row.id === MAIN) return 'principal'
  return GENERIC_TYPES.has(row.type) ? row.label : `${row.type} · ${row.label}`
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fit(text: string, px: number, charPx: number): string {
  const max = Math.max(1, Math.floor(px / charPx))
  return text.length > max ? text.slice(0, Math.max(1, max - 1)).trimEnd() + '…' : text
}

function n(value: number): string {
  return String(Math.round(value * 10) / 10)
}

function axisDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return `${Math.round(ms / 1000)}s`
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h${String(minutes % 60).padStart(2, '0')}`
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

type Font = 'display' | 'text' | 'mono'

type TextOptions = {
  size?: number
  fill?: string
  weight?: number
  font?: Font
  anchor?: 'start' | 'middle' | 'end'
  spacing?: number
  opacity?: number
  tabular?: boolean
}

class Canvas {
  parts: string[] = []
  seq = 0
  halos = new Map<string, string>()

  halo(color: string): string {
    let id = this.halos.get(color)
    if (!id) {
      id = `halo${this.halos.size}`
      this.halos.set(color, id)
    }
    return `url(#${id})`
  }

  id(prefix: string): string {
    this.seq += 1
    return `${prefix}${this.seq}`
  }

  push(...markup: string[]) {
    this.parts.push(...markup)
  }

  text(x: number, y: number, body: string, o: TextOptions = {}) {
    const attrs = [
      `x="${n(x)}"`,
      `y="${n(y)}"`,
      `class="${o.font === 'display' ? 'd' : o.font === 'mono' ? 'm' : 't'}${o.tabular ? ' n' : ''}"`,
      `font-size="${o.size ?? 12}"`,
      `fill="${o.fill ?? INK.primary}"`,
      o.weight ? `font-weight="${o.weight}"` : '',
      o.anchor && o.anchor !== 'start' ? `text-anchor="${o.anchor}"` : '',
      o.spacing !== undefined ? `letter-spacing="${o.spacing}"` : '',
      o.opacity !== undefined ? `opacity="${o.opacity}"` : '',
    ]
    this.push(`<text ${attrs.filter(Boolean).join(' ')}>${esc(body)}</text>`)
  }

  shell(x: number, y: number, w: number, h: number) {
    this.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="22" fill="#FFFFFF" fill-opacity="0.025" stroke="#FFFFFF" stroke-opacity="0.06"/>`,
      `<rect x="${n(x + 5)}" y="${n(y + 5)}" width="${n(w - 10)}" height="${n(h - 10)}" rx="17" fill="url(#core)" stroke="url(#rim)"/>`,
    )
  }

  heading(x: number, y: number, w: number, title: string, meta?: string) {
    this.text(x + 21, y + 32, title, { size: 13, weight: 600, spacing: -0.1 })
    if (meta) this.text(x + w - 21, y + 32, meta, { size: 11, fill: INK.muted, anchor: 'end' })
  }

  pill(x: number, y: number, label: string, o: { color?: string; dot?: string; pulse?: boolean } = {}): number {
    const w = label.length * 7.4 + (o.dot ? 32 : 22)
    this.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="22" rx="11" fill="#FFFFFF" fill-opacity="0.04" stroke="#FFFFFF" stroke-opacity="0.08"/>`,
    )
    if (o.dot) {
      const cx = x + 13
      this.push(`<circle cx="${n(cx)}" cy="${n(y + 11)}" r="3" fill="${o.dot}"/>`)
      if (o.pulse) {
        this.push(
          `<circle cx="${n(cx)}" cy="${n(y + 11)}" r="3" fill="none" stroke="${o.dot}" stroke-width="1.2"><animate attributeName="r" values="3;8" dur="1.8s" ${EASE} repeatCount="indefinite"/><animate attributeName="stroke-opacity" values="0.9;0" dur="1.8s" ${EASE} repeatCount="indefinite"/></circle>`,
        )
      }
    }
    this.text(x + (o.dot ? 23 : 11), y + 15, label, { size: 9.5, weight: 600, spacing: 1.6, fill: o.color ?? INK.secondary })
    return w
  }
}

function spinner(c: Canvas, cx: number, cy: number, r: number, color: string) {
  const len = 2 * Math.PI * r
  c.push(
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="${color}" stroke-opacity="0.2" stroke-width="1.6"/>`,
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="${n(len * 0.28)} ${n(len)}"><animateTransform attributeName="transform" type="rotate" from="0 ${n(cx)} ${n(cy)}" to="360 ${n(cx)} ${n(cy)}" dur="1.1s" repeatCount="indefinite"/></circle>`,
  )
}

function statusGlyph(c: Canvas, cx: number, cy: number, row: AgentRow) {
  const color = agentColor(row)
  if (row.status === 'running') {
    spinner(c, cx, cy, 7, color)
  } else if (row.status === 'failed') {
    c.push(
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="7.5" fill="${STATUS.critical}" fill-opacity="0.16"/>`,
      `<path d="M ${n(cx - 2.6)} ${n(cy - 2.6)} l 5.2 5.2 M ${n(cx + 2.6)} ${n(cy - 2.6)} l -5.2 5.2" stroke="${STATUS.critical}" stroke-width="1.5" stroke-linecap="round"/>`,
    )
  } else if (row.status === 'aborted') {
    c.push(
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="7.5" fill="none" stroke="${INK.faint}" stroke-width="1.2"/>`,
      `<rect x="${n(cx - 2.4)}" y="${n(cy - 2.4)}" width="4.8" height="4.8" rx="1" fill="${INK.muted}"/>`,
    )
  } else {
    c.push(
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="7.5" fill="none" stroke="${INK.faint}" stroke-width="1.2"/>`,
      `<path d="M ${n(cx - 3)} ${n(cy + 0.2)} l 2 2.1 l 4 -4.3" fill="none" stroke="${INK.secondary}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
  }
}

function checkIcon(c: Canvas, cx: number, cy: number) {
  c.push(
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="7" fill="${STATUS.good}" fill-opacity="0.16"/>`,
    `<path d="M ${n(cx - 3)} ${n(cy + 0.2)} l 2 2.1 l 4 -4.3" fill="none" stroke="${STATUS.good}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  )
}

function warnIcon(c: Canvas, cx: number, cy: number) {
  c.push(
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="7" fill="${STATUS.warning}" fill-opacity="0.16"/>`,
    `<path d="M ${n(cx)} ${n(cy - 3.2)} L ${n(cx)} ${n(cy + 0.8)}" stroke="${STATUS.warning}" stroke-width="1.6" stroke-linecap="round"/>`,
    `<circle cx="${n(cx)}" cy="${n(cy + 3.3)}" r="0.95" fill="${STATUS.warning}"/>`,
  )
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

export type RenderOptions = { width: number; now: number; bucketPx?: number; windowMs?: number; clockMs?: number }

type Ctx = { s: Snapshot; now: number; agents: AgentRow[]; bucket: number; windowMs: number }

type Section = (c: Canvas, x: number, y: number, w: number, ctx: Ctx) => number

const header: Section = (c, x, y, w, { s, now, agents }) => {
  const live = isLive(s)
  const running = agents.filter(row => row.status === 'running').length + (s.agents[MAIN]?.status === 'running' ? 1 : 0)
  const mark = logo(x, y - 2, w >= 420 ? 30 : 24, { live })
  c.push(mark.svg)
  c.pill(x + mark.w + 14, y + 2, live ? 'AO VIVO' : 'OCIOSO', { dot: live ? STATUS.good : INK.muted, pulse: live, color: live ? INK.primary : INK.muted })
  c.text(x + w, y + 17, formatDuration(now - s.startedAt), { size: 11, fill: INK.muted, anchor: 'end', font: 'mono', tabular: true })
  y += 16
  const big = String(running)
  c.text(x - 2, y + 82, big, { size: 56, weight: 600, font: 'display', spacing: -2.5 })
  const bx = x + big.length * 31 + 10
  c.text(bx, y + 62, running === 1 ? 'agente trabalhando' : 'agentes trabalhando', { size: 14, weight: 500, fill: INK.primary })
  c.text(
    bx,
    y + 81,
    fit(
      `${plural(agents.length + 1, 'agente', 'agentes')} na sessão · ${plural(s.advisor.length, 'consulta', 'consultas')} ao advisor${s.context?.percent !== undefined ? ` · contexto ${s.context.percent}%` : ''}`,
      w - (bx - x),
      6.1,
    ),
    { size: 11.5, fill: INK.muted },
  )
  return 120
}

type Energy = { flow: Flow; isBurst: boolean; down: string; up: string }

function cable(c: Canvas, d: string, o: { idle: string; idleOpacity?: number; energy?: Energy; failed?: boolean; dashed?: boolean }) {
  const id = c.id('w')
  const stroke = o.failed ? STATUS.critical : o.idle
  const dash = o.failed || o.dashed ? ' stroke-dasharray="4 5"' : ''
  c.push(`<path id="${id}" d="${d}" fill="none" stroke="${stroke}" stroke-opacity="${o.failed ? 0.7 : (o.idleOpacity ?? 1)}" stroke-width="1.4" stroke-linecap="round"${dash}/>`)
  const e = o.energy
  if (!e) return
  const fast = e.isBurst
  const lanes: [string, boolean][] = []
  if (e.flow === 'down' || e.flow === 'both') lanes.push([e.down, true])
  if (e.flow === 'up' || e.flow === 'both') lanes.push([e.up, false])
  for (const [color, isForward] of lanes) {
    const flicker = fast ? `<animate attributeName="stroke-opacity" values="0.5;1;0.65;0.95;0.55" dur="0.5s" repeatCount="indefinite"/>` : ''
    c.push(
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="${fast ? 11 : 7}" stroke-opacity="${fast ? 0.07 : 0.035}" stroke-linecap="round"/>`,
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="${fast ? 6 : 4}" stroke-opacity="${fast ? 0.14 : 0.06}" stroke-linecap="round"/>`,
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="${fast ? 2 : 1.5}" stroke-linecap="round" stroke-dasharray="${fast ? '7 7' : '3 11'}" stroke-opacity="0.9">` +
        `<animate attributeName="stroke-dashoffset" values="${isForward ? '28;0' : '0;28'}" dur="${fast ? 0.45 : 1.4}s" repeatCount="indefinite"/>${flicker}</path>`,
    )
    const count = fast ? 3 : 2
    const dur = fast ? 1.1 : 2.8
    for (let i = 0; i < count; i++) {
      c.push(
        `<g opacity="0"><set attributeName="opacity" to="1" begin="0s" fill="freeze"/>` +
          `<circle r="${fast ? 8 : 5.5}" fill="${c.halo(color)}"/>` +
          `<circle r="${fast ? 2.4 : 1.7}" fill="#FFFFFF"/>` +
          `<animateMotion dur="${dur}s" begin="${n(-(dur * i) / count)}s" repeatCount="indefinite" keyPoints="${isForward ? '0;1' : '1;0'}" keyTimes="0;1" calcMode="linear"><mpath href="#${id}"/></animateMotion></g>`,
      )
    }
  }
}

function spark(c: Canvas, cx: number, cy: number, color: string) {
  c.push(
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="3" fill="${color}"/>`,
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="3" fill="none" stroke="${color}" stroke-width="1.6"><animate attributeName="r" values="3;14" dur="1.1s" ${EASE} repeatCount="indefinite"/><animate attributeName="stroke-opacity" values="1;0" dur="1.1s" ${EASE} repeatCount="indefinite"/></circle>`,
  )
}

function curve(sx: number, sy: number, ex: number, ey: number): string {
  const mid = (ex - sx) / 2
  return `M ${n(sx)} ${n(sy)} C ${n(sx + mid)} ${n(sy)} ${n(ex - mid)} ${n(ey)} ${n(ex)} ${n(ey)}`
}

function spread(i: number, count: number, from: number, to: number): number {
  if (count <= 1) return (from + to) / 2
  return from + ((to - from) * i) / (count - 1)
}

function bookIcon(c: Canvas, x: number, y: number, color: string) {
  c.push(
    `<rect x="${n(x + 5)}" y="${n(y)}" width="18" height="23" rx="3" fill="none" stroke="${color}" stroke-opacity="0.35" stroke-width="1.3"/>`,
    `<rect x="${n(x)}" y="${n(y + 4)}" width="18" height="23" rx="3" fill="${INK.core0}" stroke="${color}" stroke-width="1.4"/>`,
    `<path d="M ${n(x + 4.5)} ${n(y + 11)} h 9 M ${n(x + 4.5)} ${n(y + 15.5)} h 9 M ${n(x + 4.5)} ${n(y + 20)} h 6" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/>`,
  )
}

function phaseShort(row: AgentRow, phase: Phase, now: number): { icon: string; text: string; color: string } {
  switch (phase.kind) {
    case 'dispatch':
      return { icon: '▼', text: `▼ ordem${row.promptChars !== undefined ? ` ${formatTokens(row.promptChars)}` : ''}`, color: INK.primary }
    case 'message':
      return { icon: '▼', text: '▼ mensagem', color: INK.primary }
    case 'working':
      return { icon: '●', text: `● ${row.lastTool?.split(' ')[0] ?? 'pensando'}`, color: INK.secondary }
    case 'reply':
      return { icon: '▲', text: `▲ resposta${row.replyChars !== undefined ? ` ${formatTokens(row.replyChars)}` : ''}`, color: INK.primary }
    case 'replied':
      return { icon: '✓', text: `✓ há ${formatDuration(now - phase.since)}`, color: INK.muted }
    case 'failed':
      return { icon: '✕', text: '✕ falhou', color: STATUS.critical }
    case 'aborted':
      return { icon: '■', text: '■ parado', color: INK.muted }
  }
}

const network: Section = (c, x, y, w, { s, now, agents }) => {
  const main = s.agents[MAIN]
  const mainColor = agentColor(main)
  const advColor = FAMILY_COLOR[family(s.advisorModel ?? 'fable')]
  const iw = w - 42
  const wide = iw >= 640
  const x0 = x + 21
  const leftW = wide ? Math.min(220, Math.round(iw * 0.24)) : 58
  const rightW = wide ? Math.min(230, Math.round(iw * 0.25)) : 58
  const gutter = wide ? 66 : 30
  const cardsX = x0 + leftW + gutter
  const cardsW = iw - leftW - rightW - gutter * 2
  const cardH = 30
  const cardGap = 6
  const shown = agents.slice(0, wide ? 14 : 12)
  const extra = agents.length - shown.length
  const phases = new Map(shown.map(row => [row.id, phaseOf(s, row, now)]))

  const recentWiki: WikiMark[] = []
  for (let i = s.wikiMarks.length - 1; i >= 0 && recentWiki.length < (wide ? 6 : 0); i--) {
    const mark = s.wikiMarks[i]
    const prev = recentWiki[recentWiki.length - 1]
    if (mark && !(prev && prev.slug === mark.slug && prev.agentId === mark.agentId && prev.touch === mark.touch)) recentWiki.push(mark)
  }

  const busY = y + 60
  const top = y + 84
  const cardsH = Math.max(1, shown.length) * (cardH + cardGap) - cardGap + (extra > 0 ? 24 : 0)
  const mainH = wide ? 186 : 70
  const advH = wide ? 70 : 56
  const leftH = mainH + 36 + advH
  const wikiH = wide ? 124 + Math.max(1, recentWiki.length) * 24 : 76
  const contentH = Math.max(cardsH, leftH, wikiH)
  const h = top - y + contentH + 22 + 26
  c.shell(x, y, w, h)

  const counts = { down: 0, working: 0, up: 0 }
  for (const phase of phases.values()) {
    if (phase.kind === 'dispatch' || phase.kind === 'message') counts.down += 1
    else if (phase.kind === 'working') counts.working += 1
    else if (phase.kind === 'reply') counts.up += 1
  }
  const meta = [
    counts.down ? `${counts.down} recebendo ordem` : '',
    counts.working ? `${counts.working} trabalhando` : '',
    counts.up ? `${counts.up} respondendo` : '',
  ].filter(Boolean)
  c.heading(x, y, w, 'Interação', meta.length ? meta.join(' · ') : `${plural(agents.length, 'subagente', 'subagentes')} · ${plural((s.links ?? []).length, 'troca', 'trocas')}`)

  const mainY = top + (contentH - leftH) / 2
  const mcx = x0 + leftW / 2
  const advY = mainY + mainH + 36
  const wikiX = x0 + iw - rightW
  const wikiY = top + (contentH - wikiH) / 2
  const cardsY = top + (contentH - cardsH) / 2

  const mainWiki = wikiActivity(s, MAIN, now)
  const wikiEnergy = (a: WikiActivity): Energy | undefined =>
    a.read || a.write
      ? { flow: a.read && a.write ? 'both' : a.write ? 'down' : 'up', isBurst: a.at !== undefined && now - a.at < 6000, down: CATEGORY_COLOR.write, up: CATEGORY_COLOR.read }
      : undefined

  const wcx = wikiX + rightW / 2
  const r = 10
  cable(
    c,
    `M ${n(mcx)} ${n(mainY)} V ${n(busY + r)} Q ${n(mcx)} ${n(busY)} ${n(mcx + r)} ${n(busY)} H ${n(wcx - r)} Q ${n(wcx)} ${n(busY)} ${n(wcx)} ${n(busY + r)} V ${n(wikiY)}`,
    { idle: INK.baseline, energy: wikiEnergy(mainWiki) },
  )
  if (mainWiki.slug) {
    const label = `principal ${mainWiki.touch === 'write' ? 'escrevendo' : 'lendo'} ${mainWiki.slug}.md`
    const lw = Math.min(label.length * 6 + 20, cardsW)
    c.push(`<rect x="${n((mcx + wcx) / 2 - lw / 2)}" y="${n(busY - 10)}" width="${n(lw)}" height="20" rx="10" fill="${INK.core1}" stroke="${mainWiki.touch === 'write' ? CATEGORY_COLOR.write : CATEGORY_COLOR.read}" stroke-opacity="0.6"/>`)
    c.text((mcx + wcx) / 2, busY + 4, fit(label, lw - 16, 6), { size: 10.5, anchor: 'middle', fill: INK.primary })
  }

  const lastAdvisor = s.advisor[s.advisor.length - 1]
  const advAge = lastAdvisor ? now - (lastAdvisor.endedAt ?? lastAdvisor.at) : Infinity
  const advTop = advY + (wide ? 2 : 4)
  cable(c, `M ${n(mcx)} ${n(mainY + mainH + (wide ? 0 : 16))} L ${n(mcx)} ${n(advTop)}`, {
    idle: advColor,
    idleOpacity: 0.3,
    energy: advAge < ADVISOR_HOT_MS ? { flow: 'both', isBurst: advAge < 12_000, down: mainColor, up: advColor } : undefined,
  })

  const anchors = new Map<string, number>()
  shown.forEach((row, i) => anchors.set(row.id, cardsY + i * (cardH + cardGap) + cardH / 2))
  const wikiLinked = shown.filter(row => wikiTotals(s, row.id).reads + wikiTotals(s, row.id).writes > 0)

  shown.forEach((row, i) => {
    const cy = anchors.get(row.id) ?? 0
    const phase = phases.get(row.id) ?? phaseOf(s, row, now)
    const color = agentColor(row)
    const energy: Energy | undefined = phase.flow ? { flow: phase.flow, isBurst: phase.isBurst, down: mainColor, up: color } : undefined
    const parentY = row.parentId ? anchors.get(row.parentId) : undefined
    if (parentY !== undefined) {
      cable(c, `M ${n(cardsX)} ${n(parentY + 8)} C ${n(cardsX - gutter * 0.8)} ${n(parentY + 8)} ${n(cardsX - gutter * 0.8)} ${n(cy)} ${n(cardsX)} ${n(cy)}`, {
        idle: INK.baseline,
        energy: energy && { ...energy, down: agentColor(s.agents[row.parentId ?? MAIN]) },
        failed: phase.kind === 'failed',
        dashed: row.isBackground,
      })
    } else {
      const sy = wide ? spread(i, shown.length, mainY + 24, mainY + mainH - 24) : mainY + 26
      cable(c, curve(x0 + (wide ? leftW : leftW / 2 + 22), sy, cardsX, cy), {
        idle: phase.kind === 'working' || phase.isBurst ? color : INK.baseline,
        idleOpacity: phase.kind === 'working' || phase.isBurst ? 0.3 : 1,
        energy,
        failed: phase.kind === 'failed',
        dashed: row.isBackground,
      })
      if (phase.kind === 'reply') spark(c, x0 + (wide ? leftW : leftW / 2 + 22), sy, color)
    }
    if (phase.kind === 'dispatch' || phase.kind === 'message') spark(c, cardsX, cy, mainColor)
    const wikiIndex = wikiLinked.indexOf(row)
    if (wikiIndex >= 0) {
      const a = wikiActivity(s, row.id, now)
      const wy = wide ? spread(wikiIndex, wikiLinked.length, wikiY + 26, wikiY + wikiH - 26) : wikiY + 26
      cable(c, curve(cardsX + cardsW, cy, wide ? wikiX : wcx - 22, wy), { idle: CATEGORY_COLOR.read, idleOpacity: 0.22, energy: wikiEnergy(a) })
      if (a.write) spark(c, wide ? wikiX : wcx - 22, wy, CATEGORY_COLOR.write)
      if (a.read) spark(c, cardsX + cardsW, cy, CATEGORY_COLOR.read)
    }
  })

  const waiting = agents.filter(row => row.status === 'running' && !row.isBackground).length
  const mainActive = main?.status === 'running'
  const anyBurst = [...phases.values()].some(phase => phase.isBurst)
  if (wide) {
    c.push(
      `<rect x="${n(x0)}" y="${n(mainY)}" width="${n(leftW)}" height="${mainH}" rx="16" fill="${INK.core0}" stroke="${mainColor}" stroke-opacity="0.55">${anyBurst ? `<animate attributeName="stroke-opacity" values="0.4;1;0.4" dur="0.9s" repeatCount="indefinite"/>` : ''}</rect>`,
    )
    if (mainActive) spinner(c, x0 + 26, mainY + 28, 10, mainColor)
    else c.push(`<circle cx="${n(x0 + 26)}" cy="${n(mainY + 28)}" r="10" fill="none" stroke="${mainColor}" stroke-opacity="0.5" stroke-width="1.6"/>`)
    c.push(`<circle cx="${n(x0 + 26)}" cy="${n(mainY + 28)}" r="4" fill="${mainColor}"/>`)
    c.text(x0 + 46, mainY + 26, fit(modelLabel(main?.model), leftW - 100, 8.5), { size: 15, weight: 600, font: 'display' })
    c.text(x0 + 46, mainY + 42, 'sessão principal', { size: 11, fill: INK.muted })
    const level = main?.effort ? EFFORTS.indexOf(main.effort) : -1
    EFFORTS.forEach((_, i) => {
      const bh = 6 + i * 3
      c.push(`<rect x="${n(x0 + leftW - 52 + i * 8)}" y="${n(mainY + 36 - bh)}" width="4.5" height="${bh}" rx="2" fill="${i <= level ? mainColor : INK.baseline}"/>`)
    })
    const status = waiting > 0 ? `aguardando ${plural(waiting, 'subagente', 'subagentes')}` : mainActive ? 'trabalhando' : 'aguardando o próximo prompt'
    c.text(x0 + 16, mainY + 68, fit(status, leftW - 32, 6.4), { size: 12, weight: 500, fill: waiting > 0 || mainActive ? INK.primary : INK.muted })
    const sent = (s.links ?? []).filter(link => link.from === MAIN && link.kind !== 'reply').length
    const got = (s.links ?? []).filter(link => link.to === MAIN && link.kind === 'reply').length
    const lines = [
      `▼ ${plural(sent, 'ordem enviada', 'ordens enviadas')}`,
      `▲ ${plural(got, 'resposta recebida', 'respostas recebidas')}`,
      `${main?.steps ?? 0} passos · ${main?.tools ?? 0} tools · ${formatTokens((main?.tokensIn ?? 0) + (main?.tokensOut ?? 0))} tok`,
    ]
    lines.forEach((line, i) => c.text(x0 + 16, mainY + 90 + i * 17, fit(line, leftW - 32, 5.9), { size: 10.5, fill: INK.secondary }))
    const ctxLabel = s.context?.tokens === undefined ? 'contexto —' : `contexto ${s.context.percent ?? percentOf(s.context.tokens, s.context.window)}% · ${formatTokens(s.context.tokens)}/${formatTokens(s.context.window)}`
    c.text(x0 + 16, mainY + 150, fit(ctxLabel, leftW - 32, 5.9), { size: 10.5, fill: INK.secondary })
    gauge(c, x0 + 16, mainY + 156, leftW - 32, 4, s.context?.tokens, s.context?.window ?? 200_000)
    c.text(x0 + 16, mainY + mainH - 10, fit(main?.lastTool ?? '—', leftW - 32, 6.2), { size: 10, font: 'mono', fill: INK.muted })

    const ay = advY + 30
    c.push(
      `<rect x="${n(mcx - 13)}" y="${n(ay - 13)}" width="26" height="26" rx="6" transform="rotate(45 ${n(mcx)} ${n(ay)})" fill="${advColor}" fill-opacity="0.16" stroke="${advColor}" stroke-width="1.4"/>`,
    )
    if (advAge < 12_000) spark(c, mcx, ay, advColor)
    c.text(mcx, ay + 4.5, String(s.advisor.length), { size: 13, weight: 650, anchor: 'middle', font: 'display' })
    c.text(mcx + 28, ay - 2, s.advisorModel ? `advisor · ${modelLabel(s.advisorModel)}` : 'advisor', { size: 11.5, weight: 600 })
    c.text(mcx + 28, ay + 13, lastAdvisor ? `respondeu há ${formatDuration(advAge)}` : 'em espera', { size: 10.5, fill: INK.muted })
  } else {
    const cy = mainY + 26
    c.push(`<circle cx="${n(mcx)}" cy="${n(cy)}" r="22" fill="${INK.core0}" stroke="${mainColor}" stroke-opacity="0.6" stroke-width="1.4"/>`)
    if (mainActive) spinner(c, mcx, cy, 22, mainColor)
    c.push(`<circle cx="${n(mcx)}" cy="${n(cy)}" r="5" fill="${mainColor}"/>`)
    c.text(mcx, cy + 38, fit(modelLabel(main?.model), leftW, 6), { size: 10.5, weight: 600, anchor: 'middle' })
    c.text(mcx, cy + 52, s.context?.percent !== undefined ? `ctx ${s.context.percent}%` : waiting > 0 ? `espera ${waiting}` : 'principal', { size: 9.5, fill: s.context?.percent !== undefined ? fillColor(s.context.percent) : INK.muted, anchor: 'middle' })
    const ay = advY + 18
    c.push(
      `<rect x="${n(mcx - 10)}" y="${n(ay - 10)}" width="20" height="20" rx="5" transform="rotate(45 ${n(mcx)} ${n(ay)})" fill="${advColor}" fill-opacity="0.16" stroke="${advColor}" stroke-width="1.4"/>`,
    )
    c.text(mcx, ay + 4, String(s.advisor.length), { size: 11, weight: 650, anchor: 'middle', font: 'display' })
    c.text(mcx, ay + 32, 'advisor', { size: 9.5, fill: INK.muted, anchor: 'middle' })
  }

  if (shown.length === 0) {
    c.push(`<rect x="${n(cardsX)}" y="${n(cardsY)}" width="${n(cardsW)}" height="${cardH}" rx="14" fill="none" stroke="${INK.faint}" stroke-dasharray="4 5"/>`)
    c.text(cardsX + cardsW / 2, cardsY + cardH / 2 + 4, fit('nenhum subagente nesta sessão ainda', cardsW - 16, 5.4), { size: 11, fill: INK.muted, anchor: 'middle' })
  }
  shown.forEach((row, i) => {
    const cy0 = cardsY + i * (cardH + cardGap)
    const mid = cy0 + cardH / 2
    const phase = phases.get(row.id) ?? phaseOf(s, row, now)
    const color = agentColor(row)
    const hot = phase.isBurst ? color : phase.kind === 'failed' ? STATUS.critical : phase.kind === 'working' ? color : '#FFFFFF'
    const hotOpacity = phase.isBurst ? 0.9 : phase.kind === 'failed' ? 0.7 : phase.kind === 'working' ? 0.35 : 0.07
    c.push(
      `<rect x="${n(cardsX)}" y="${n(cy0)}" width="${n(cardsW)}" height="${cardH}" rx="10" fill="${INK.core0}" stroke="${hot}" stroke-opacity="${hotOpacity}">${phase.isBurst ? `<animate attributeName="stroke-opacity" values="0.35;1;0.35" dur="0.8s" repeatCount="indefinite"/>` : ''}</rect>`,
    )
    statusGlyph(c, cardsX + 15, mid, row)
    const elapsed = formatDuration((row.endedAt ?? now) - row.startedAt)
    let right = cardsX + cardsW - 10
    c.text(right, mid + 3.5, elapsed, { size: 10, fill: INK.muted, anchor: 'end', font: 'mono', tabular: true })
    right -= elapsed.length * 6.2 + 10
    const short = phaseShort(row, phase, now)
    if (wide) {
      const percent = percentOf(row.ctxTokens, contextWindowOf(s, row))
      if (percent !== undefined) {
        const label = `${percent}%`
        c.text(right, mid + 3.5, label, { size: 10, fill: INK.muted, anchor: 'end', font: 'mono', tabular: true })
        right -= label.length * 6.2 + 5
        gauge(c, right - 26, mid - 2, 26, 4, row.ctxTokens, contextWindowOf(s, row))
        right -= 36
      }
      const text = fit(short.text, Math.min(150, cardsW * 0.36), 6)
      c.text(right, mid + 3.5, text, { size: 10.5, weight: phase.isBurst ? 600 : 400, fill: short.color, anchor: 'end' })
      right -= text.length * 6 + 10
    } else {
      c.text(right, mid + 4, short.icon, { size: 10.5, fill: short.color, anchor: 'end' })
      right -= 16
    }
    const nameX = cardsX + 28
    c.text(nameX, mid + 4, fit(agentName(row, row.id), right - nameX, 6.5), {
      size: 11.5,
      weight: row.status === 'running' ? 600 : 500,
      fill: row.status === 'running' ? INK.primary : INK.secondary,
    })
  })
  if (extra > 0) {
    c.text(cardsX + 4, cardsY + cardsH - 6, `+${plural(extra, 'subagente anterior', 'subagentes anteriores')}`, { size: 11, fill: INK.muted })
  }

  const hotWiki = s.wikiMarks.filter(mark => now - mark.at < WIKI_HOT_MS)
  const isWriting = hotWiki.some(mark => mark.touch === 'write')
  const isReading = hotWiki.some(mark => mark.touch !== 'write')
  const wikiStroke = isWriting ? CATEGORY_COLOR.write : isReading ? CATEGORY_COLOR.read : '#FFFFFF'
  const reads = Object.values(s.wiki).reduce((sum, page) => sum + page.reads, 0)
  const writes = Object.values(s.wiki).reduce((sum, page) => sum + page.writes, 0)
  if (wide) {
    c.push(
      `<rect x="${n(wikiX)}" y="${n(wikiY)}" width="${n(rightW)}" height="${wikiH}" rx="16" fill="${INK.core0}" stroke="${wikiStroke}" stroke-opacity="${isReading || isWriting ? 0.85 : 0.08}">${isReading || isWriting ? `<animate attributeName="stroke-opacity" values="0.35;1;0.35" dur="1s" repeatCount="indefinite"/>` : ''}</rect>`,
    )
    bookIcon(c, wikiX + 16, wikiY + 14, isWriting ? CATEGORY_COLOR.write : isReading ? CATEGORY_COLOR.read : INK.secondary)
    c.text(wikiX + 50, wikiY + 30, 'Wiki', { size: 15, weight: 600, font: 'display' })
    c.text(wikiX + 50, wikiY + 45, isWriting ? 'sendo escrita agora' : isReading ? 'sendo lida agora' : 'docs/ · em repouso', { size: 10.5, fill: isWriting || isReading ? INK.primary : INK.muted })
    c.text(wikiX + 16, wikiY + 76, String(reads), { size: 22, weight: 600, font: 'display', fill: CATEGORY_COLOR.read })
    c.text(wikiX + 16, wikiY + 92, reads === 1 ? 'leitura' : 'leituras', { size: 10, fill: INK.muted })
    const wx2 = wikiX + rightW / 2
    c.text(wx2, wikiY + 76, String(writes), { size: 22, weight: 600, font: 'display', fill: CATEGORY_COLOR.write })
    c.text(wx2, wikiY + 92, writes === 1 ? 'escrita' : 'escritas', { size: 10, fill: INK.muted })
    c.push(`<line x1="${n(wikiX + 14)}" y1="${n(wikiY + 106)}" x2="${n(wikiX + rightW - 14)}" y2="${n(wikiY + 106)}" stroke="${INK.hairline}"/>`)
    if (recentWiki.length === 0) c.text(wikiX + 16, wikiY + 128, 'nenhum acesso ainda', { size: 11, fill: INK.muted })
    recentWiki.forEach((mark, i) => {
      const ry = wikiY + 126 + i * 24
      const isHot = now - mark.at < WIKI_HOT_MS
      const tint = mark.touch === 'write' ? CATEGORY_COLOR.write : CATEGORY_COLOR.read
      if (mark.touch === 'write') c.push(`<rect x="${n(wikiX + 16)}" y="${n(ry - 8)}" width="8" height="8" rx="2" fill="${tint}" fill-opacity="${isHot ? 1 : 0.5}"/>`)
      else c.push(`<circle cx="${n(wikiX + 20)}" cy="${n(ry - 4)}" r="3.8" fill="none" stroke="${tint}" stroke-opacity="${isHot ? 1 : 0.5}" stroke-width="1.4"/>`)
      if (isHot) spark(c, wikiX + 20, ry - 4, tint)
      const age = formatDuration(now - mark.at)
      c.text(wikiX + rightW - 14, ry, age, { size: 9.5, fill: INK.muted, anchor: 'end', font: 'mono', tabular: true })
      c.push(`<circle cx="${n(wikiX + 33)}" cy="${n(ry - 4)}" r="2.6" fill="${agentColor(s.agents[mark.agentId])}"/>`)
      c.text(wikiX + 40, ry, fit(mark.slug, rightW - 40 - age.length * 6 - 22, 6.3), { size: 10.5, font: 'mono', fill: isHot ? INK.primary : INK.secondary })
    })
  } else {
    const cy = wikiY + 26
    c.push(`<circle cx="${n(wcx)}" cy="${n(cy)}" r="22" fill="${INK.core0}" stroke="${wikiStroke}" stroke-opacity="${isReading || isWriting ? 0.9 : 0.15}" stroke-width="1.4"/>`)
    if (isReading || isWriting) spinner(c, wcx, cy, 22, wikiStroke)
    bookIcon(c, wcx - 11, cy - 14, isWriting ? CATEGORY_COLOR.write : isReading ? CATEGORY_COLOR.read : INK.secondary)
    c.text(wcx, cy + 38, 'wiki', { size: 10.5, weight: 600, anchor: 'middle' })
    c.text(wcx, cy + 52, `${reads}↓ ${writes}↑`, { size: 9.5, fill: INK.muted, anchor: 'middle', font: 'mono' })
  }

  const ky = y + h - 20
  let kx = x0
  const legend = (color: string, label: string, dashed = false) => {
    if (kx + label.length * 5.6 + 30 > x + w - 21) return
    c.push(`<path d="M ${n(kx)} ${n(ky - 4)} h 18" stroke="${color}" stroke-width="2" stroke-linecap="round"${dashed ? ' stroke-dasharray="3 4"' : ''}/>`)
    c.text(kx + 24, ky, label, { size: 10, fill: INK.muted })
    kx += label.length * 5.6 + 42
  }
  legend(mainColor, wide ? '▼ ordem / mensagem' : '▼ ordem')
  legend(INK.primary, wide ? '▲ resposta (cor do subagente)' : '▲ resposta')
  legend(CATEGORY_COLOR.read, wide ? 'lendo a wiki' : 'lê wiki')
  legend(CATEGORY_COLOR.write, wide ? 'escrevendo na wiki' : 'escreve')
  legend(INK.secondary, '2º plano', true)
  return h
}

const SLICE_COLORS = ['#3987E5', '#9085E9', '#199E70', '#C98500', '#D55181', '#D95926', '#8A8F98']

export function fillColor(percent: number | undefined): string {
  if (percent === undefined) return INK.muted
  if (percent >= 85) return STATUS.critical
  if (percent >= 65) return STATUS.warning
  return STATUS.good
}

function gauge(c: Canvas, x: number, y: number, w: number, h: number, tokens: number | undefined, window: number) {
  const percent = percentOf(tokens, window)
  c.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${h}" rx="${h / 2}" fill="${INK.hairline}"/>`)
  if (percent !== undefined) {
    c.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(Math.max(h, (w * percent) / 100))}" height="${h}" rx="${h / 2}" fill="${fillColor(percent)}"/>`)
  }
}

const contextSection: Section = (c, x, y, w, { s, now, agents }) => {
  const ctx = s.context
  const main = s.agents[MAIN]
  const window = ctx?.window ?? 200_000
  const tokens = ctx?.tokens
  const percent = ctx?.percent ?? percentOf(tokens, window)
  const used = (ctx?.categories ?? []).filter(row => row.kind === 'used' && row.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  const legendRows = Math.ceil(Math.min(used.length, 6) / 2)
  const subs = agents.filter(row => row.ctxTokens !== undefined).sort((a, b) => (b.ctxTokens ?? 0) - (a.ctxTokens ?? 0)).slice(0, 5)
  const chartH = 64
  const h = 148 + legendRows * 20 + (legendRows ? 8 : 0) + chartH + (subs.length ? 62 + subs.length * 22 : 32)
  c.shell(x, y, w, h)
  c.heading(x, y, w, 'Janela de contexto', `${modelLabel(main?.model)} · janela ${formatTokens(window)}`)
  const x0 = x + 21
  const iw = w - 42

  const big = percent === undefined ? '—' : `${percent}%`
  c.text(x0 - 1, y + 98, big, { size: 40, weight: 600, font: 'display', spacing: -1.5, fill: percent === undefined ? INK.muted : INK.primary })
  const bx = x0 + big.length * 25 + 16
  c.text(bx, y + 80, tokens === undefined ? 'sem leitura ainda' : `${formatTokens(tokens)} de ${formatTokens(window)} tokens`, { size: 13, weight: 500 })
  const free = tokens === undefined ? undefined : Math.max(0, (ctx?.compactAt ?? window) - tokens)
  c.text(
    bx,
    y + 97,
    fit(free === undefined ? 'a primeira resposta do principal preenche este quadro' : ctx?.compactAt ? `${formatTokens(free)} até o autocompact` : `${formatTokens(free)} livres`, x0 + iw - bx, 6),
    { size: 11, fill: free !== undefined && ctx?.compactAt && free < window * 0.1 ? STATUS.warning : INK.muted },
  )

  const by = y + 116
  const bh = 10
  c.push(`<rect x="${n(x0)}" y="${n(by)}" width="${n(iw)}" height="${bh}" rx="5" fill="${INK.hairline}"/>`)
  if (used.length > 0) {
    let sx = x0
    used.forEach((row, i) => {
      const sw = (row.tokens / window) * iw
      if (sw < 0.5) return
      c.push(`<rect x="${n(sx)}" y="${n(by)}" width="${n(sw)}" height="${bh}" fill="${SLICE_COLORS[i % SLICE_COLORS.length]}"><title>${esc(`${row.name} · ${formatTokens(row.tokens)}`)}</title></rect>`)
      sx += sw
    })
    c.push(`<rect x="${n(x0)}" y="${n(by)}" width="${n(iw)}" height="${bh}" rx="5" fill="none" stroke="${INK.core1}" stroke-width="2"/>`)
  } else if (percent !== undefined) {
    c.push(`<rect x="${n(x0)}" y="${n(by)}" width="${n(Math.max(bh, (iw * percent) / 100))}" height="${bh}" rx="5" fill="${fillColor(percent)}"/>`)
  }
  if (ctx?.compactAt && ctx.compactAt < window) {
    const cx = x0 + (ctx.compactAt / window) * iw
    c.push(
      `<rect x="${n(cx)}" y="${n(by)}" width="${n(x0 + iw - cx)}" height="${bh}" fill="${STATUS.warning}" fill-opacity="0.14"/>`,
      `<line x1="${n(cx)}" y1="${n(by - 4)}" x2="${n(cx)}" y2="${n(by + bh + 4)}" stroke="${STATUS.warning}" stroke-width="1.4"/>`,
    )
    c.text(Math.min(cx, x0 + iw - 2), by - 7, 'autocompact', { size: 9.5, fill: STATUS.warning, anchor: cx > x0 + iw - 60 ? 'end' : 'middle' })
  }
  let cy = by + bh + 22
  used.slice(0, 6).forEach((row, i) => {
    const col = i % 2
    const lx = x0 + col * (iw / 2)
    const ly = cy + Math.floor(i / 2) * 20
    c.push(`<rect x="${n(lx)}" y="${n(ly - 8)}" width="8" height="8" rx="2" fill="${SLICE_COLORS[i % SLICE_COLORS.length]}"/>`)
    const value = formatTokens(row.tokens)
    c.text(lx + iw / 2 - 12, ly, value, { size: 10.5, fill: INK.secondary, anchor: 'end', font: 'mono', tabular: true })
    c.text(lx + 13, ly, fit(row.name, iw / 2 - 30 - value.length * 6.5, 5.8), { size: 10.5, fill: INK.muted })
  })
  cy += legendRows * 20 + (legendRows ? 8 : 0)

  const series = (ctx?.series ?? []).filter(point => point.at >= s.startedAt)
  const top = cy
  const t0 = series[0]?.at ?? s.startedAt
  const t1 = Math.max(now, t0 + 60_000)
  const yMax = Math.max(window * 0.25, ctx?.peak ?? 0, ...(ctx?.compactAt ? [ctx.compactAt] : [])) * 1.05
  const xOf = (at: number) => x0 + ((at - t0) / (t1 - t0)) * iw
  const yOf = (value: number) => top + chartH - (value / yMax) * chartH
  c.push(`<line x1="${n(x0)}" y1="${n(top + chartH)}" x2="${n(x0 + iw)}" y2="${n(top + chartH)}" stroke="${INK.baseline}"/>`)
  if (ctx?.compactAt && ctx.compactAt <= yMax) {
    c.push(`<line x1="${n(x0)}" y1="${n(yOf(ctx.compactAt))}" x2="${n(x0 + iw)}" y2="${n(yOf(ctx.compactAt))}" stroke="${STATUS.warning}" stroke-opacity="0.5" stroke-dasharray="3 4"/>`)
  }
  if (series.length >= 1) {
    const pts = series.map(point => `${n(xOf(point.at))} ${n(yOf(point.tokens))}`)
    const lastPoint = series[series.length - 1]
    const tail = lastPoint ? ` L ${n(xOf(now))} ${n(yOf(lastPoint.tokens))}` : ''
    const line = `M ${pts.join(' L ')}${tail}`
    const color = fillColor(percent)
    c.push(
      `<path d="${line} L ${n(xOf(now))} ${n(top + chartH)} L ${n(xOf(series[0]?.at ?? t0))} ${n(top + chartH)} Z" fill="${color}" fill-opacity="0.12"/>`,
      `<path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`,
    )
    if (lastPoint) c.push(`<circle cx="${n(xOf(now))}" cy="${n(yOf(lastPoint.tokens))}" r="3" fill="${color}"/>`)
  } else {
    c.text(x0 + iw / 2, top + chartH / 2 + 4, 'a curva aparece depois da primeira resposta', { size: 11, fill: INK.muted, anchor: 'middle' })
  }
  for (const at of ctx?.compactions ?? []) {
    if (at < t0) continue
    const cx = xOf(at)
    c.push(`<line x1="${n(cx)}" y1="${n(top)}" x2="${n(cx)}" y2="${n(top + chartH)}" stroke="${STATUS.warning}" stroke-width="1.2" stroke-dasharray="2 3"><title>compactação · ${clock(at)}</title></line>`)
  }
  const compactions = ctx?.compactions.length ?? 0
  c.text(x0, top + chartH + 18, `desde ${clock(t0).slice(0, 5)}`, { size: 10, fill: INK.muted, font: 'mono', tabular: true })
  c.text(x0 + iw, top + chartH + 18, `pico ${formatTokens(ctx?.peak ?? 0)} · ${plural(compactions, 'compactação', 'compactações')}`, { size: 10, fill: INK.muted, anchor: 'end' })
  cy = top + chartH + 40

  if (subs.length) {
    c.push(`<line x1="${n(x0)}" y1="${n(cy - 8)}" x2="${n(x0 + iw)}" y2="${n(cy - 8)}" stroke="${INK.hairline}"/>`)
    c.text(x0, cy + 10, 'Contexto dos subagentes', { size: 11, fill: INK.muted })
    cy += 28
    const barW = Math.min(140, iw * 0.35)
    subs.forEach((row, i) => {
      const ry = cy + i * 22
      const sw = contextWindowOf(s, row)
      const label = `${formatTokens(row.ctxTokens ?? 0)} · ${percentOf(row.ctxTokens, sw) ?? 0}%`
      c.push(`<circle cx="${n(x0 + 4)}" cy="${n(ry - 4)}" r="3" fill="${agentColor(row)}"/>`)
      c.text(x0 + 13, ry, fit(agentName(row, row.id), iw - barW - 13 - label.length * 6.2 - 20, 6), { size: 11, fill: row.status === 'running' ? INK.primary : INK.secondary })
      gauge(c, x0 + iw - barW, ry - 7, barW, 5, row.ctxTokens, sw)
      c.text(x0 + iw - barW - 10, ry, label, { size: 10, fill: INK.muted, anchor: 'end', font: 'mono', tabular: true })
    })
  }
  return h
}

const stats: Section = (c, x, y, w, { s }) => {
  const main = s.agents[MAIN]
  const all = Object.values(s.agents)
  const tools = all.reduce((sum, row) => sum + row.tools, 0)
  const errors = all.reduce((sum, row) => sum + row.errors, 0)
  const tokensIn = all.reduce((sum, row) => sum + row.tokensIn, 0)
  const tokensOut = all.reduce((sum, row) => sum + row.tokensOut, 0)
  const pagesRead = Object.values(s.wiki).filter(page => page.reads > 0).length
  const pagesWritten = Object.values(s.wiki).filter(page => page.writes > 0).length
  const tiles: [string, string, string, boolean][] = [
    ['Passos', String(all.reduce((sum, row) => sum + row.steps, 0)), `${main?.steps ?? 0} na principal`, false],
    ['Tools', String(tools), errors > 0 ? plural(errors, 'erro', 'erros') : 'sem erros', errors > 0],
    ['Tokens', formatTokens(tokensIn + tokensOut), `${formatTokens(tokensOut)} escritos`, false],
    ['Wiki', String(pagesRead), plural(pagesWritten, 'editada', 'editadas'), false],
  ]
  const cols = w >= 560 ? 4 : 2
  const gap = 10
  const tw = (w - gap * (cols - 1)) / cols
  const th = 92
  tiles.forEach(([label, value, sub, isWarning], i) => {
    const tx = x + (i % cols) * (tw + gap)
    const ty = y + Math.floor(i / cols) * (th + gap)
    c.shell(tx, ty, tw, th)
    c.text(tx + 19, ty + 29, label, { size: 11, fill: INK.muted })
    c.text(tx + 18, ty + 60, value, { size: 26, weight: 600, font: 'display', spacing: -0.8 })
    if (isWarning) warnIcon(c, tx + 25, ty + 75)
    c.text(tx + (isWarning ? 37 : 19), ty + 78, fit(sub, tw - 38, 5.8), { size: 10.5, fill: isWarning ? INK.secondary : INK.muted })
  })
  const rows = Math.ceil(tiles.length / cols)
  let h = rows * th + (rows - 1) * gap

  const models = Object.entries(s.tokens).sort((a, b) => b[1].input + b[1].output - (a[1].input + a[1].output))
  const total = models.reduce((sum, [, t]) => sum + t.input + t.output, 0)
  if (total > 0) {
    const by = y + h + 16
    const bw = w - 4 - (models.length - 1) * 2
    let bx = x + 2
    for (const [model, t] of models) {
      const segment = Math.max(3, ((t.input + t.output) / total) * bw)
      const title = `${modelLabel(model)} · ${formatTokens(t.input)} lidos · ${formatTokens(t.output)} escritos`
      c.push(`<rect x="${n(bx)}" y="${n(by)}" width="${n(segment)}" height="6" rx="3" fill="${FAMILY_COLOR[family(model)]}"><title>${esc(title)}</title></rect>`)
      bx += segment + 2
    }
    let lx = x + 2
    const ly = by + 24
    for (const [model, t] of models.slice(0, 4)) {
      const label = `${modelLabel(model)} ${Math.round(((t.input + t.output) / total) * 100)}%`
      c.push(`<rect x="${n(lx)}" y="${n(ly - 8)}" width="8" height="8" rx="2" fill="${FAMILY_COLOR[family(model)]}"/>`)
      c.text(lx + 13, ly, label, { size: 10.5, fill: INK.secondary })
      lx += label.length * 5.8 + 30
    }
    h += 16 + 6 + 26
  }
  return h
}

type Lane = { name: string; color: string; kind: 'agent' | 'advisor' | 'wiki'; row?: AgentRow }

const timeline: Section = (c, x, y, w, { s, now, agents, bucket, windowMs }) => {
  const main = s.agents[MAIN]
  const firstMark = Math.min(
    s.startedAt,
    ...Object.values(s.agents).map(row => row.marks[0]?.at ?? row.startedAt),
    ...s.advisor.map(call => call.at),
  )
  const isWindowed = windowMs > 0 && now - firstMark > windowMs
  const t0 = isWindowed ? now - windowMs : firstMark
  const t1 = Math.max(now, t0 + 60_000)
  const inWindow = (at: number) => at >= t0
  const lanes: Lane[] = [
    { name: 'principal', color: agentColor(main), kind: 'agent', row: main },
    { name: 'advisor', color: FAMILY_COLOR[family(s.advisorModel ?? 'fable')], kind: 'advisor' },
    { name: 'wiki', color: INK.primary, kind: 'wiki' },
    ...agents
      .filter(row => inWindow(row.endedAt ?? now))
      .slice(0, 8)
      .map(row => ({ name: agentName(row, row.id), color: agentColor(row), kind: 'agent' as const, row })),
  ]
  const laneH = 26
  const top = y + 52
  const h = 52 + lanes.length * laneH + 50
  c.shell(x, y, w, h)
  c.heading(x, y, w, 'Linha do tempo', isWindowed ? `últimos ${axisDuration(windowMs)}` : `desde ${clock(t0).slice(0, 5)}`)
  const labelW = w >= 560 ? 132 : 86
  const tx = x + 21 + labelW
  const tw = w - 42 - labelW - 6
  const xOf = (at: number) => tx + ((Math.min(Math.max(at, t0), t1) - t0) / (t1 - t0)) * tw
  for (let i = 0; i <= 4; i++) {
    const gx = tx + (tw * i) / 4
    c.push(`<line x1="${n(gx)}" y1="${n(top - 4)}" x2="${n(gx)}" y2="${n(top + lanes.length * laneH)}" stroke="${INK.hairline}"/>`)
    if (i % 2 === 1 && tw < 320) continue
    const label = i === 4 ? 'agora' : `−${axisDuration(((t1 - t0) * (4 - i)) / 4)}`
    c.text(gx, top + lanes.length * laneH + 18, label, {
      size: 10,
      fill: INK.muted,
      anchor: i === 0 ? 'start' : i === 4 ? 'end' : 'middle',
      font: 'mono',
      tabular: true,
    })
  }
  lanes.forEach((lane, i) => {
    const ly = top + i * laneH + laneH / 2
    if (i > 0) c.push(`<line x1="${n(x + 21)}" y1="${n(ly - laneH / 2)}" x2="${n(x + w - 21)}" y2="${n(ly - laneH / 2)}" stroke="${INK.hairline}"/>`)
    if (lane.kind === 'wiki') c.push(`<circle cx="${n(x + 25)}" cy="${n(ly)}" r="3.6" fill="none" stroke="${INK.secondary}" stroke-width="1.3"/>`)
    else c.push(`<rect x="${n(x + 21)}" y="${n(ly - 4)}" width="8" height="8" rx="2" fill="${lane.color}"/>`)
    c.text(x + 36, ly + 4, fit(lane.name, labelW - 20, 6.1), { size: 11.5, fill: INK.secondary })
    if (lane.kind === 'agent' && lane.row) {
      const row = lane.row
      if (row.id !== MAIN) {
        const sx = xOf(row.startedAt)
        const ex = xOf(row.endedAt ?? now)
        c.push(`<rect x="${n(sx)}" y="${n(ly - 9)}" width="${n(Math.max(6, ex - sx))}" height="18" rx="9" fill="${lane.color}" fill-opacity="0.1"/>`)
        for (const link of s.links ?? []) {
          if (!inWindow(link.at) || (link.to !== row.id && link.from !== row.id)) continue
          const lx = xOf(link.at)
          const isDown = link.to === row.id
          const tint = isDown ? agentColor(main) : lane.color
          const tip = isDown ? `M ${n(lx - 4)} ${n(ly - 12)} l 8 0 l -4 6 z` : `M ${n(lx - 4)} ${n(ly + 12)} l 8 0 l -4 -6 z`
          const what = link.kind === 'reply' ? 'resposta' : link.kind === 'message' ? 'mensagem' : 'ordem'
          c.push(`<path d="${tip}" fill="${tint}"><title>${esc(`${clock(link.at)} · ${what} · ${formatTokens(link.chars)} chars`)}</title></path>`)
        }
      }
      const cells = new Map<number, { count: number; first: number }>()
      for (const mark of row.marks) {
        if (!inWindow(mark.at)) continue
        const key = Math.floor((xOf(mark.at) - tx) / bucket)
        const prev = cells.get(key)
        cells.set(key, { count: (prev?.count ?? 0) + 1, first: prev?.first ?? mark.at })
      }
      for (const [key, cell] of cells) {
        const bh = Math.min(16, 7 + cell.count * 2)
        c.push(
          `<rect x="${n(tx + key * bucket + bucket / 2 - 1.5)}" y="${n(ly - bh / 2)}" width="3" height="${n(bh)}" rx="1.5" fill="${lane.color}"><title>${esc(`${clock(cell.first)} · ${plural(cell.count, 'tool', 'tools')}`)}</title></rect>`,
        )
      }
      if (row.status === 'running') {
        const hx = xOf(now)
        c.push(
          `<circle cx="${n(hx)}" cy="${n(ly)}" r="3.5" fill="${lane.color}"/>`,
          `<circle cx="${n(hx)}" cy="${n(ly)}" r="3.5" fill="none" stroke="${lane.color}" stroke-width="1.2"><animate attributeName="r" values="3.5;9" dur="1.6s" ${EASE} repeatCount="indefinite"/><animate attributeName="stroke-opacity" values="0.9;0" dur="1.6s" ${EASE} repeatCount="indefinite"/></circle>`,
        )
      }
    } else if (lane.kind === 'advisor') {
      for (const call of s.advisor) {
        if (!inWindow(call.at)) continue
        const cx = xOf(call.at)
        const ex = call.endedAt ? xOf(call.endedAt) : cx
        if (ex - cx > 2) c.push(`<rect x="${n(cx)}" y="${n(ly - 1.5)}" width="${n(ex - cx)}" height="3" rx="1.5" fill="${lane.color}" fill-opacity="0.5"/>`)
        c.push(
          `<rect x="${n(cx - 5)}" y="${n(ly - 5)}" width="10" height="10" rx="2" transform="rotate(45 ${n(cx)} ${n(ly)})" fill="${lane.color}" stroke="${INK.core1}" stroke-width="2"><title>${esc(`advisor · ${clock(call.at)} · ${agentName(s.agents[call.agentId], call.agentId)}`)}</title></rect>`,
        )
      }
    } else {
      const step = Math.max(bucket, 9)
      const cells = new Map<number, { write: boolean; slugs: string[] }>()
      for (const mark of s.wikiMarks) {
        if (!inWindow(mark.at)) continue
        const key = Math.floor((xOf(mark.at) - tx) / step)
        const prev = cells.get(key) ?? { write: false, slugs: [] }
        cells.set(key, {
          write: prev.write || mark.touch === 'write',
          slugs: prev.slugs.includes(mark.slug) ? prev.slugs : [...prev.slugs, mark.slug],
        })
      }
      for (const [key, cell] of cells) {
        const cx = tx + key * step + step / 2
        const title = `<title>${esc(cell.slugs.slice(0, 6).join(', '))}</title>`
        if (cell.write) c.push(`<rect x="${n(cx - 4.5)}" y="${n(ly - 4.5)}" width="9" height="9" rx="2.5" fill="${INK.primary}">${title}</rect>`)
        else c.push(`<circle cx="${n(cx)}" cy="${n(ly)}" r="4.2" fill="${INK.core1}" stroke="${INK.primary}" stroke-width="1.5">${title}</circle>`)
      }
    }
  })
  const ky = y + h - 17
  let kx = x + 21
  const legend = (glyph: (gx: number) => string, label: string) => {
    if (kx + label.length * 5.4 + 14 > x + w - 21) return
    c.push(glyph(kx))
    c.text(kx + 12, ky, label, { size: 10, fill: INK.muted })
    kx += label.length * 5.4 + 28
  }
  legend(gx => `<rect x="${n(gx + 2)}" y="${n(ky - 9)}" width="3" height="10" rx="1.5" fill="${INK.secondary}"/>`, 'tool')
  legend(gx => `<path d="M ${n(gx)} ${n(ky - 8)} l 8 0 l -4 6 z" fill="${INK.secondary}"/>`, 'ordem')
  legend(gx => `<path d="M ${n(gx)} ${n(ky)} l 8 0 l -4 -6 z" fill="${INK.secondary}"/>`, 'resposta')
  legend(gx => `<rect x="${n(gx + 1)}" y="${n(ky - 7.5)}" width="7" height="7" rx="1.5" transform="rotate(45 ${n(gx + 4.5)} ${n(ky - 4)})" fill="${INK.secondary}"/>`, 'advisor')
  legend(gx => `<circle cx="${n(gx + 4)}" cy="${n(ky - 4)}" r="3.5" fill="none" stroke="${INK.secondary}" stroke-width="1.4"/>`, 'lida')
  legend(gx => `<rect x="${n(gx)}" y="${n(ky - 8)}" width="8" height="8" rx="2" fill="${INK.secondary}"/>`, 'editada')
  return h
}

const wiki: Section = (c, x, y, w, { s, now }) => {
  const pages = Object.values(s.wiki).sort((a, b) => b.writes - a.writes || b.lastAt - a.lastAt)
  const declared = s.declared
  const shown = pages.slice(0, 10)
  const declRows = declared === null ? 1 : Math.max(1, declared.length)
  const rowH = 30
  const h = 62 + 22 + declRows * 24 + 30 + 4 + Math.max(1, shown.length) * rowH + (pages.length > shown.length ? 22 : 0) + 12
  c.shell(x, y, w, h)
  const readCount = pages.filter(page => page.reads > 0).length
  const writeCount = pages.filter(page => page.writes > 0).length
  c.heading(x, y, w, 'Wiki', `${plural(readCount, 'lida', 'lidas')} · ${plural(writeCount, 'editada', 'editadas')} · ${plural(s.wikiSearches, 'busca', 'buscas')}`)

  let cy = y + 62
  c.text(x + 21, cy, 'Declaradas na linha Wiki:', { size: 11, fill: INK.muted })
  cy += 22
  if (declared === null) {
    warnIcon(c, x + 28, cy - 4)
    c.text(x + 43, cy, fit('a resposta ainda não abriu com Wiki:', w - 64, 6), { size: 12, fill: INK.secondary })
    cy += 24
  } else if (declared.length === 0) {
    c.text(x + 21, cy, 'none', { size: 12, fill: INK.secondary, font: 'mono' })
    cy += 24
  } else {
    for (const slug of declared) {
      const page = s.wiki[slug]
      const touched = (page?.reads ?? 0) + (page?.writes ?? 0) > 0
      if (touched) checkIcon(c, x + 28, cy - 4)
      else warnIcon(c, x + 28, cy - 4)
      c.text(x + 43, cy, fit(slug, w - 130, 7.3), { size: 12, font: 'mono', fill: INK.primary })
      c.text(x + w - 21, cy, touched ? 'lida' : 'não lida', { size: 11, fill: touched ? INK.muted : INK.secondary, anchor: 'end' })
      cy += 24
    }
  }
  cy += 4
  c.push(`<line x1="${n(x + 21)}" y1="${n(cy)}" x2="${n(x + w - 21)}" y2="${n(cy)}" stroke="${INK.hairline}"/>`)
  cy += 26
  c.text(x + 21, cy, 'Tocadas na sessão', { size: 11, fill: INK.muted })
  cy += 4
  if (shown.length === 0) c.text(x + 21, cy + 22, 'nenhuma página aberta ainda', { size: 12, fill: INK.muted })
  const maxReads = Math.max(1, ...shown.map(page => page.reads))
  const barW = w >= 560 ? 110 : 52
  shown.forEach((page, i) => {
    const mid = cy + i * rowH + rowH / 2 + 2
    c.push(`<g><title>${esc(`${page.slug}.md · ${plural(page.reads, 'leitura', 'leituras')} · ${plural(page.writes, 'edição', 'edições')}`)}</title>`)
    if (page.writes > 0) c.push(`<rect x="${n(x + 21)}" y="${n(mid - 4.5)}" width="9" height="9" rx="2.5" fill="${INK.primary}"/>`)
    else c.push(`<circle cx="${n(x + 25.5)}" cy="${n(mid)}" r="4.2" fill="none" stroke="${INK.secondary}" stroke-width="1.4"/>`)
    const tailW = 44
    const barX = x + w - 21 - tailW - barW
    const editW = page.writes > 0 ? 60 : 0
    c.text(x + 38, mid + 4, fit(page.slug, barX - (x + 38) - editW - 10, 7.3), { size: 12, font: 'mono', fill: INK.primary })
    if (page.writes > 0) {
      const ex = barX - 10 - 52
      c.push(`<rect x="${n(ex)}" y="${n(mid - 9)}" width="52" height="18" rx="9" fill="#FFFFFF" fill-opacity="0.07"/>`)
      c.text(ex + 26, mid + 3.5, 'editada', { size: 10, weight: 600, anchor: 'middle', fill: INK.primary })
    }
    c.push(`<rect x="${n(barX)}" y="${n(mid - 2)}" width="${barW}" height="4" rx="2" fill="${INK.hairline}"/>`)
    c.push(`<rect x="${n(barX)}" y="${n(mid - 2)}" width="${n(Math.max(4, (page.reads / maxReads) * barW))}" height="4" rx="2" fill="${INK.secondary}"/>`)
    c.text(x + w - 21, mid + 4, formatDuration(now - page.lastAt), { size: 10.5, fill: INK.muted, anchor: 'end', font: 'mono', tabular: true })
    c.push(`</g>`)
  })
  if (pages.length > shown.length) {
    c.text(x + 21, cy + shown.length * rowH + 18, `+${plural(pages.length - shown.length, 'página', 'páginas')}`, { size: 11, fill: INK.muted })
  }
  return h
}

const feed: Section = (c, x, y, w, { s }) => {
  const events = s.feed.slice(-10).reverse()
  const rowH = 26
  const h = 52 + Math.max(1, events.length) * rowH + 14
  c.shell(x, y, w, h)
  c.heading(x, y, w, 'Agora', 'tail -f')
  if (events.length === 0) c.text(x + 21, y + 74, 'aguardando o primeiro evento…', { size: 12, fill: INK.muted })
  const whoW = w >= 560 ? 130 : 84
  events.forEach((event, i) => {
    const mid = y + 48 + i * rowH + rowH / 2 + 4
    const row = s.agents[event.agentId]
    const opacity = i === 0 ? 1 : Math.max(0.5, 1 - i * 0.06)
    c.text(x + 21, mid, clock(event.at), { size: 10.5, fill: INK.muted, font: 'mono', tabular: true, opacity })
    c.push(`<circle cx="${n(x + 84)}" cy="${n(mid - 3.5)}" r="3" fill="${agentColor(row)}" opacity="${opacity}"/>`)
    c.text(x + 93, mid, fit(agentName(row, event.agentId), whoW - 10, 6), { size: 11.5, fill: INK.secondary, opacity })
    const tx = x + 93 + whoW
    if (event.isError) {
      c.push(`<path d="M ${n(tx)} ${n(mid - 7)} l 6 6 M ${n(tx + 6)} ${n(mid - 7)} l -6 6" stroke="${STATUS.critical}" stroke-width="1.5" stroke-linecap="round" opacity="${opacity}"/>`)
    }
    const offset = event.isError ? 13 : 0
    c.text(tx + offset, mid, fit(event.text, x + w - 21 - tx - offset, 7), { size: 11.5, font: 'mono', fill: INK.primary, opacity })
  })
  return h
}

export function renderSvg(s: Snapshot, opts: RenderOptions): string {
  const clock = opts.clockMs ?? opts.now
  const draw = (o: RenderOptions) => phaseLock(build(s, o), clock)
  let svg = draw(opts)
  for (const bucketPx of [15, 30, 60]) {
    if (svg.length <= SVG_LIMIT) return svg
    svg = draw({ ...opts, bucketPx })
  }
  if (svg.length <= SVG_LIMIT) return svg
  return svg.replace(/<title>[^<]*<\/title>/g, '')
}

export function phaseLock(svg: string, clockMs: number): string {
  const seconds = clockMs / 1000
  return svg.replace(/<(animate|animateMotion|animateTransform)\b([^>]*?)(\/?)>/g, (tag, name: string, attrs: string, close: string) => {
    if (!attrs.includes('repeatCount="indefinite"')) return tag
    const dur = attrs.match(/\bdur="(\d*\.?\d+)s"/)
    if (!dur) return tag
    const period = Number(dur[1])
    if (!(period > 0)) return tag
    const begin = attrs.match(/\bbegin="(-?\d*\.?\d+)s"/)
    if (attrs.includes('begin="') && !begin) return tag
    const offset = (begin ? Number(begin[1]) : 0) - (seconds % period)
    const rest = begin ? attrs.replace(begin[0], '') : attrs
    return `<${name}${rest} begin="${offset.toFixed(3)}s"${close}>`
  })
}

function build(s: Snapshot, opts: RenderOptions): string {
  const W = Math.max(340, Math.min(1600, Math.round(opts.width)))
  const P = W >= 560 ? 24 : 16
  const inner = W - P * 2
  const ctx: Ctx = { s, now: opts.now, agents: orderedAgents(s), bucket: opts.bucketPx ?? 5, windowMs: opts.windowMs ?? 0 }
  const c = new Canvas()
  const gap = 14
  let y = P
  y += header(c, P, y, inner, ctx) + 6

  y += network(c, P, y, inner, ctx) + gap
  if (W >= 900) {
    const lw = Math.round(inner * 0.57)
    const rw = inner - lw - gap
    let ly = y
    let ry = y
    for (const section of [timeline, feed]) ly += section(c, P, ly, lw, ctx) + gap
    for (const section of [contextSection, stats, wiki]) ry += section(c, P + lw + gap, ry, rw, ctx) + gap
    y = Math.max(ly, ry)
  } else {
    for (const section of [contextSection, stats, timeline, wiki, feed]) y += section(c, P, y, inner, ctx) + gap
  }
  const H = Math.ceil(y - gap + P)

  const style = `.t{font-family:${TEXT}}.d{font-family:${DISPLAY}}.m{font-family:${MONO}}.n{font-variant-numeric:tabular-nums}`
  const orb = (id: string, color: string, opacity: number) =>
    `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<style>${style}</style><defs>` +
    `<linearGradient id="core" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${INK.core0}"/><stop offset="1" stop-color="${INK.core1}"/></linearGradient>` +
    `<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.11"/><stop offset="0.18" stop-color="#FFFFFF" stop-opacity="0.04"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0.02"/></linearGradient>` +
    orb('orbA', FAMILY_COLOR.opus, 0.16) +
    orb('orbB', FAMILY_COLOR.sonnet, 0.1) +
    orb('orbC', FAMILY_COLOR.fable, 0.09) +
    `<filter id="glow" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><feGaussianBlur stdDeviation="2.6"/></filter>` +
    `<pattern id="grainTile" width="180" height="180" patternUnits="userSpaceOnUse"><rect width="180" height="180" filter="url(#grain)"/></pattern>` +
    `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0"/></filter>` +
    LOGO_DEFS +
    [...c.halos].map(([color, id]) => `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="0.7"/><stop offset="0.45" stop-color="${color}" stop-opacity="0.35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`).join('') +
    `</defs>` +
    `<rect width="${W}" height="${H}" fill="${INK.page}"/>` +
    `<ellipse cx="${n(W * 0.12)}" cy="0" rx="${n(W * 0.75)}" ry="380" fill="url(#orbA)"/>` +
    `<ellipse cx="${n(W * 0.95)}" cy="${n(H * 0.45)}" rx="${n(W * 0.7)}" ry="420" fill="url(#orbB)"/>` +
    `<ellipse cx="${n(W * 0.1)}" cy="${n(H * 0.85)}" rx="${n(W * 0.7)}" ry="380" fill="url(#orbC)"/>` +
    `<rect width="${W}" height="${H}" fill="url(#grainTile)"/>`
  return head + c.parts.join('') + `</svg>`
}

export function svgHeight(svg: string): number {
  const match = svg.match(/viewBox="0 0 \d+ (\d+)"/)
  return match ? Number(match[1]) : 0
}
