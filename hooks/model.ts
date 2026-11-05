import type {
  AgentRow,
  ContextCategoryRow,
  ContextState,
  Link,
  LinkKind,
  AgentStatus,
  Snapshot,
  ToolCategory,
  WikiTouch,
} from '../types'

export const MAIN = 'main'

const FEED_CAP = 120
const MARK_CAP = 240
const WIKI_MARK_CAP = 300
const ADVISOR_CAP = 120
const LINK_CAP = 200
const CONTEXT_CAP = 240
const DEFAULT_WINDOW = 200_000

export const DISPATCH_MS = 12_000
export const REPLY_MS = 20_000
export const WIKI_HOT_MS = 15_000
export const ADVISOR_HOT_MS = 45_000

export type Family = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'other'

export type ToolInput = Record<string, unknown>

export function emptySnapshot(now: number, advisorModel?: string): Snapshot {
  return {
    startedAt: now,
    advisorModel,
    agents: { [MAIN]: newAgent(MAIN, 'Sessão principal', 'main', now, 'idle') },
    advisor: [],
    wiki: {},
    wikiMarks: [],
    wikiSearches: 0,
    declared: null,
    feed: [],
    links: [],
    tokens: {},
    isBackfilled: false,
  }
}

export function newAgent(
  id: string,
  label: string,
  type: string,
  at: number,
  status: AgentStatus = 'running',
): AgentRow {
  return {
    id,
    label,
    type,
    status,
    startedAt: at,
    tools: 0,
    errors: 0,
    steps: 0,
    tokensIn: 0,
    tokensOut: 0,
    marks: [],
  }
}

export function family(model: string | undefined): Family {
  const id = (model ?? '').toLowerCase()
  if (id.includes('fable')) return 'fable'
  if (id.includes('opus')) return 'opus'
  if (id.includes('sonnet')) return 'sonnet'
  if (id.includes('haiku')) return 'haiku'
  return 'other'
}

export function modelLabel(model: string | undefined): string {
  if (!model) return '?'
  const id = model.toLowerCase().replace(/\[.*\]$/, '')
  const match = id.match(/claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/)
  if (match) {
    const [, word = '', major = '', minor] = match
    const name = capitalize(word)
    return minor ? `${name} ${major}.${minor}` : `${name} ${major}`
  }
  const alias = id.match(/^(opus|sonnet|haiku|fable)$/)
  if (alias) return capitalize(alias[1] ?? '')
  return model
}

export function capitalize(word: string): string {
  return word.slice(0, 1).toUpperCase() + word.slice(1)
}

export function shortTool(tool: string): string {
  const mcp = tool.match(/^mcp__(.+?)__(.+)$/)
  return mcp?.[2] ?? tool
}

export function toolCategory(tool: string, input: ToolInput): ToolCategory {
  switch (tool) {
    case 'Read':
    case 'NotebookRead':
      return 'read'
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return 'write'
    case 'Bash':
      return /\b(grep|rg|find)\b/.test(String(input.command ?? '')) ? 'search' : 'bash'
    case 'Grep':
    case 'Glob':
    case 'ToolSearch':
      return 'search'
    case 'Agent':
    case 'Task':
    case 'SendMessage':
    case 'Workflow':
      return 'agent'
    case 'WebFetch':
    case 'WebSearch':
      return 'web'
    default:
      return tool.includes('mcp__') && /fetch|search|query|docs/i.test(tool) ? 'web' : 'other'
  }
}

function basename(path: unknown): string {
  const text = String(path ?? '')
  return text.split('/').filter(Boolean).pop() ?? text
}

export function oneLine(text: unknown, max = 90): string {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

export function toolSummary(tool: string, input: ToolInput): string {
  switch (tool) {
    case 'Bash':
      return `Bash ${oneLine(input.description ?? input.command, 80)}`
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return `${tool} ${basename(input.file_path ?? input.notebook_path)}`
    case 'Grep':
      return `Grep ${oneLine(input.pattern, 60)}`
    case 'Glob':
      return `Glob ${oneLine(input.pattern, 60)}`
    case 'Agent':
    case 'Task':
      return `Agent ${oneLine(input.description, 60)}`
    case 'Skill':
      return `Skill ${oneLine(input.skill, 60)}`
    case 'ToolSearch':
      return `ToolSearch ${oneLine(input.query, 60)}`
    case 'WebFetch':
      return `WebFetch ${oneLine(input.url, 60)}`
    case 'WebSearch':
      return `WebSearch ${oneLine(input.query, 60)}`
    default:
      return shortTool(tool)
  }
}

const DOC_PATH = /(?<![\w.-])(?:[\w.~-]+\/)*docs\/([A-Za-z0-9][\w.-]*?)\.md(?![\w])/g

function slugsIn(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(DOC_PATH)) {
    const slug = match[1]
    if (slug && !found.includes(slug)) found.push(slug)
  }
  return found
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function bashTouch(command: string, slug: string): WikiTouch {
  const path = `[\\w./~-]*docs/${escapeRegex(slug)}\\.md`
  if (new RegExp(`(?:>>?|\\btee(?:\\s+-a)?)\\s*["']?${path}`).test(command)) return 'write'
  if (new RegExp(`\\bsed\\s+-i[^|;&]*${path}`).test(command)) return 'write'
  if (new RegExp(`\\b(?:grep|rg)\\b[^|;&]*${path}`).test(command)) return 'search'
  return 'read'
}

export type WikiHit = { slug: string; touch: WikiTouch }

export function wikiHits(tool: string, input: ToolInput): { hits: WikiHit[]; isSearch: boolean } {
  if (tool === 'Read') {
    return { hits: slugsIn(String(input.file_path ?? '')).map(slug => ({ slug, touch: 'read' })), isSearch: false }
  }
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write') {
    return { hits: slugsIn(String(input.file_path ?? '')).map(slug => ({ slug, touch: 'write' })), isSearch: false }
  }
  if (tool === 'Grep' || tool === 'Glob') {
    const where = `${input.path ?? ''} ${input.glob ?? ''} ${input.pattern ?? ''}`
    return { hits: [], isSearch: /(?:^|[\s/])docs(?:\/|\s|$)/.test(where) }
  }
  if (tool === 'Bash') {
    const command = String(input.command ?? '')
    const hits = slugsIn(command).map(slug => ({ slug, touch: bashTouch(command, slug) }))
    const isSearch = /\b(?:grep|rg)\b[^|;&]*\bdocs\//.test(command) && hits.every(hit => hit.touch !== 'read')
    return { hits: hits.filter(hit => hit.touch !== 'search'), isSearch: isSearch || hits.some(hit => hit.touch === 'search') }
  }
  return { hits: [], isSearch: false }
}

export function parseDeclared(text: string): string[] | null {
  const match = text.match(/^\s*\**Wiki:\**\s*(.+)$/m)
  if (!match?.[1]) return null
  const body = match[1].trim()
  if (/^none\b/i.test(body)) return []
  return body
    .split(/[,;]/)
    .map(part => part.replace(/[`*_[\]]/g, '').replace(/^docs\//, '').replace(/\.md$/, '').trim())
    .map(part => part.split(/\s/)[0] ?? '')
    .filter(part => /^[A-Za-z0-9][\w.-]*$/.test(part))
}

function cap<T>(list: T[], max: number): T[] {
  return list.length > max ? list.slice(list.length - max) : list
}

function withAgent(s: Snapshot, id: string, at: number, fn: (row: AgentRow) => AgentRow): Snapshot {
  const row = s.agents[id] ?? newAgent(id, `Agente ${id.slice(0, 6)}`, 'subagent', at)
  return { ...s, agents: { ...s.agents, [id]: fn(row) } }
}

export type ToolStart = { at: number; agentId?: string; tool: string; input: ToolInput }

export function applyToolStart(s: Snapshot, call: ToolStart): Snapshot {
  const agentId = call.agentId ?? MAIN
  const category = toolCategory(call.tool, call.input)
  const text = toolSummary(call.tool, call.input)
  let next = withAgent(s, agentId, call.at, row => ({
    ...row,
    status: row.status === 'idle' || row.status === 'done' ? 'running' : row.status,
    tools: row.tools + 1,
    lastTool: text,
    lastToolAt: call.at,
    marks: cap([...row.marks, { at: call.at, category }], MARK_CAP),
  }))
  const target = call.tool === 'SendMessage' ? findAgent(next, call.input.to) : undefined
  if (target && target !== agentId) {
    const chars = String(call.input.message ?? '').length
    next = withLink(next, { at: call.at, from: agentId, to: target, kind: 'message', chars })
    next = {
      ...next,
      feed: cap([...next.feed, { at: call.at, agentId, category: 'message', text: `→ ${agentLabel(next, target)} · mensagem ${formatTokens(chars)} chars` }], FEED_CAP),
    }
  } else if (call.tool !== 'Agent' && call.tool !== 'Task') {
    next = { ...next, feed: cap([...next.feed, { at: call.at, agentId, category, text }], FEED_CAP) }
  }

  const { hits, isSearch } = wikiHits(call.tool, call.input)
  if (isSearch) next = { ...next, wikiSearches: next.wikiSearches + 1 }
  for (const hit of hits) next = applyWiki(next, call.at, agentId, hit)
  return next
}

function applyWiki(s: Snapshot, at: number, agentId: string, hit: WikiHit): Snapshot {
  const page = s.wiki[hit.slug] ?? { slug: hit.slug, reads: 0, writes: 0, firstAt: at, lastAt: at, agents: [] }
  const updated = {
    ...page,
    reads: page.reads + (hit.touch === 'read' ? 1 : 0),
    writes: page.writes + (hit.touch === 'write' ? 1 : 0),
    lastAt: Math.max(page.lastAt, at),
    agents: page.agents.includes(agentId) ? page.agents : [...page.agents, agentId],
  }
  return {
    ...s,
    wiki: { ...s.wiki, [hit.slug]: updated },
    wikiMarks: cap([...s.wikiMarks, { at, slug: hit.slug, touch: hit.touch, agentId }], WIKI_MARK_CAP),
  }
}

export function applyToolEnd(s: Snapshot, agentId: string | undefined, isError: boolean): Snapshot {
  if (!isError) return s
  const id = agentId ?? MAIN
  const feed = [...s.feed]
  for (let i = feed.length - 1; i >= 0; i--) {
    const event = feed[i]
    if (event && event.agentId === id && !event.isError) {
      feed[i] = { ...event, isError: true }
      break
    }
  }
  return withAgent({ ...s, feed }, id, 0, row => ({ ...row, errors: row.errors + 1 }))
}

function findAgent(s: Snapshot, to: unknown): string | undefined {
  const key = String(to ?? '').replace(/\s*\[.*\]$/, '').trim()
  if (!key) return undefined
  if (key === MAIN) return MAIN
  if (s.agents[key]) return key
  return Object.values(s.agents).find(row => row.name === key)?.id
}

function agentLabel(s: Snapshot, id: string): string {
  const row = s.agents[id]
  if (!row || id === MAIN) return 'principal'
  return row.name ?? row.type
}

function withLink(s: Snapshot, link: Link): Snapshot {
  return { ...s, links: cap([...(s.links ?? []), link], LINK_CAP) }
}

export type Spawn = {
  at: number
  agentId: string
  type: string
  description: string
  model?: string
  parentId?: string
  isBackground?: boolean
  name?: string
  prompt?: string
}

export function applySpawn(s: Snapshot, spawn: Spawn): Snapshot {
  const row: AgentRow = {
    ...newAgent(spawn.agentId, spawn.description || spawn.type, spawn.type, spawn.at),
    model: spawn.model,
    parentId: spawn.parentId,
    isBackground: spawn.isBackground,
    name: spawn.name,
    promptChars: spawn.prompt === undefined ? undefined : spawn.prompt.length,
    promptHead: spawn.prompt === undefined ? undefined : oneLine(spawn.prompt, 120),
  }
  const from = spawn.parentId ?? MAIN
  const sized = spawn.prompt === undefined ? '' : ` · prompt ${formatTokens(spawn.prompt.length)} chars`
  const next = {
    ...s,
    agents: { ...s.agents, [spawn.agentId]: row },
    feed: cap([...s.feed, { at: spawn.at, agentId: from, category: 'spawn' as const, text: `→ ${spawn.type} · ${spawn.description}${sized}` }], FEED_CAP),
  }
  return withLink(next, { at: spawn.at, from, to: spawn.agentId, kind: 'dispatch', chars: spawn.prompt?.length ?? 0 })
}

export type Usage = {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export type Step = {
  at: number
  agentId?: string
  model: string
  effort?: string
  answer: string
  usage: Usage | null
  advisorCalls: { startedAt: number; endedAt?: number }[]
}

export function applyStep(s: Snapshot, step: Step): Snapshot {
  const agentId = step.agentId ?? MAIN
  const input = step.usage
    ? step.usage.input_tokens + step.usage.cache_read_input_tokens + step.usage.cache_creation_input_tokens
    : 0
  const output = step.usage?.output_tokens ?? 0
  const model = step.usage?.model || step.model
  let next = withAgent(s, agentId, step.at, row => ({
    ...row,
    ctxTokens: step.usage ? input : row.ctxTokens,
    ctxPeak: step.usage ? Math.max(row.ctxPeak ?? 0, input) : row.ctxPeak,
    model,
    effort: step.effort ?? row.effort,
    status: agentId === MAIN || row.status !== 'running' ? 'running' : row.status,
    steps: row.steps + 1,
    tokensIn: row.tokensIn + input,
    tokensOut: row.tokensOut + output,
  }))
  if (step.usage) {
    const old = next.tokens[model] ?? { input: 0, output: 0 }
    next = { ...next, tokens: { ...next.tokens, [model]: { input: old.input + input, output: old.output + output } } }
  }
  for (const call of step.advisorCalls) {
    next = {
      ...next,
      advisor: cap([...next.advisor, { at: call.startedAt, endedAt: call.endedAt, agentId }], ADVISOR_CAP),
      feed: cap([...next.feed, { at: call.startedAt, agentId, category: 'advisor', text: 'advisor consultado' }], FEED_CAP),
    }
  }
  if (agentId === MAIN) {
    const declared = parseDeclared(step.answer)
    if (declared !== null && next.declared === null) next = { ...next, declared }
  }
  return next
}

export function applyTurnStart(s: Snapshot, at: number): Snapshot {
  return withAgent(s, MAIN, at, row => ({ ...row, status: 'running', endedAt: undefined }))
}

export type TurnEnd = { at: number; agentId?: string; reason: 'answer' | 'aborted' | 'refusal' | 'error'; answer?: string }

export function applyTurnComplete(s: Snapshot, end: TurnEnd): Snapshot {
  const agentId = end.agentId ?? MAIN
  const status: AgentStatus =
    agentId === MAIN ? 'idle' : end.reason === 'answer' ? 'done' : end.reason === 'aborted' ? 'aborted' : 'failed'
  const chars = end.answer?.length
  const next = withAgent(s, agentId, end.at, row => ({
    ...row,
    status,
    endedAt: end.at,
    replyChars: agentId === MAIN || chars === undefined ? row.replyChars : chars,
    replyHead: agentId === MAIN || !end.answer ? row.replyHead : oneLine(end.answer, 120),
  }))
  if (agentId === MAIN) return next
  const to = next.agents[agentId]?.parentId ?? MAIN
  const text = status === 'done' ? `← respondeu ${to === MAIN ? 'ao principal' : `a ${agentLabel(next, to)}`}${chars ? ` · relatório ${formatTokens(chars)} chars` : ''}` : `terminou (${status})`
  const withFeed = { ...next, feed: cap([...next.feed, { at: end.at, agentId, category: 'done' as const, text }], FEED_CAP) }
  return status === 'done' ? withLink(withFeed, { at: end.at, from: agentId, to, kind: 'reply', chars: chars ?? 0 }) : withFeed
}

export type HistoryAgent = {
  id: string
  type: string
  description: string
  status: string
  parentId?: string
  toolUses: { tool: string; input: ToolInput; isError?: boolean }[]
}

export function applyHistory(
  s: Snapshot,
  main: { assistantTexts: string[]; toolUses: { tool: string; input: ToolInput; isError?: boolean }[] },
  agents: HistoryAgent[],
): Snapshot {
  const at = s.startedAt
  let next = s
  for (const use of main.toolUses) {
    next = applyToolStart(next, { at, tool: use.tool, input: use.input })
    next = applyToolEnd(next, MAIN, use.isError === true)
  }
  for (const text of main.assistantTexts) {
    const declared = parseDeclared(text)
    if (declared !== null && next.declared === null) next = { ...next, declared }
  }
  for (const agent of agents) {
    if (!next.agents[agent.id]) {
      next = applySpawn(next, { at, agentId: agent.id, type: agent.type, description: agent.description, parentId: agent.parentId })
    }
    for (const use of agent.toolUses) {
      next = applyToolStart(next, { at, agentId: agent.id, tool: use.tool, input: use.input })
      next = applyToolEnd(next, agent.id, use.isError === true)
    }
    const status: AgentStatus =
      agent.status === 'completed' ? 'done' : agent.status === 'failed' || agent.status === 'killed' ? 'failed' : 'running'
    next = withAgent(next, agent.id, at, row => ({ ...row, status }))
  }
  return { ...next, isBackfilled: true }
}

export type ContextReading = {
  at: number
  tokens?: number
  window: number
  percent?: number
  compactAt?: number
  categories?: ContextCategoryRow[]
}

export function applyContext(s: Snapshot, reading: ContextReading): Snapshot {
  const old = s.context
  const series = old?.series ?? []
  const last = series[series.length - 1]
  const tokens = reading.tokens
  const isCompaction = tokens !== undefined && last !== undefined && last.tokens > 20_000 && tokens < last.tokens * 0.6
  const grows = tokens !== undefined && (last === undefined || last.tokens !== tokens || reading.at - last.at > 60_000)
  const context: ContextState = {
    at: reading.at,
    tokens: tokens ?? old?.tokens,
    window: reading.window || old?.window || DEFAULT_WINDOW,
    percent: reading.percent ?? old?.percent,
    compactAt: reading.compactAt ?? old?.compactAt,
    categories: reading.categories ?? old?.categories,
    series: grows && tokens !== undefined ? cap([...series, { at: reading.at, tokens }], CONTEXT_CAP) : series,
    compactions: isCompaction ? [...(old?.compactions ?? []), reading.at] : (old?.compactions ?? []),
    peak: Math.max(old?.peak ?? 0, tokens ?? 0),
  }
  return { ...s, context }
}

export function contextWindowOf(s: Snapshot, row: AgentRow): number {
  const mainModel = s.agents[MAIN]?.model
  const window = s.context?.window
  if (window && row.model && row.model === mainModel) return window
  return /\[1m\]/i.test(row.model ?? '') ? 1_000_000 : DEFAULT_WINDOW
}

export function percentOf(tokens: number | undefined, window: number): number | undefined {
  if (tokens === undefined || window <= 0) return undefined
  return Math.min(100, Math.round((tokens / window) * 100))
}

export function isLive(s: Snapshot): boolean {
  return Object.values(s.agents).some(row => row.status === 'running')
}

export function migrate(s: Snapshot): Snapshot {
  return Array.isArray(s.links) ? s : { ...s, links: [] }
}

export type Flow = 'down' | 'up' | 'both'

export type Phase = {
  kind: 'dispatch' | 'message' | 'working' | 'reply' | 'replied' | 'failed' | 'aborted'
  flow?: Flow
  isBurst: boolean
  since: number
}

export function lastLink(s: Snapshot, id: string, kinds: LinkKind[]): Link | undefined {
  const links = s.links ?? []
  for (let i = links.length - 1; i >= 0; i--) {
    const link = links[i]
    if (link && kinds.includes(link.kind) && (link.to === id || link.from === id)) return link
  }
  return undefined
}

export function phaseOf(s: Snapshot, row: AgentRow, now: number): Phase {
  const inbound = lastLink(s, row.id, ['dispatch', 'message'])
  const inboundAt = inbound && inbound.to === row.id ? inbound.at : row.startedAt
  if (row.status === 'running') {
    if (now - inboundAt < DISPATCH_MS) {
      return { kind: inbound?.kind === 'message' ? 'message' : 'dispatch', flow: 'down', isBurst: true, since: inboundAt }
    }
    return { kind: 'working', flow: row.isBackground ? undefined : 'down', isBurst: false, since: row.lastToolAt ?? inboundAt }
  }
  const end = row.endedAt ?? now
  if (row.status === 'failed') return { kind: 'failed', isBurst: false, since: end }
  if (row.status === 'aborted') return { kind: 'aborted', isBurst: false, since: end }
  if (now - end < REPLY_MS) return { kind: 'reply', flow: 'up', isBurst: true, since: end }
  return { kind: 'replied', isBurst: false, since: end }
}

export type WikiActivity = { read: boolean; write: boolean; slug?: string; touch?: WikiTouch; at?: number }

export function wikiActivity(s: Snapshot, agentId: string, now: number): WikiActivity {
  const out: WikiActivity = { read: false, write: false }
  for (let i = s.wikiMarks.length - 1; i >= 0; i--) {
    const mark = s.wikiMarks[i]
    if (!mark || now - mark.at > WIKI_HOT_MS) break
    if (mark.agentId !== agentId) continue
    if (mark.touch === 'write') out.write = true
    else out.read = true
    if (out.slug === undefined) {
      out.slug = mark.slug
      out.touch = mark.touch
      out.at = mark.at
    }
  }
  return out
}

export function wikiTotals(s: Snapshot, agentId: string): { reads: number; writes: number } {
  let reads = 0
  let writes = 0
  for (const mark of s.wikiMarks) {
    if (mark.agentId !== agentId) continue
    if (mark.touch === 'write') writes += 1
    else reads += 1
  }
  return { reads, writes }
}

export function needsTick(s: Snapshot, now: number): boolean {
  if (isLive(s)) return true
  const lastLinkAt = (s.links ?? [])[(s.links ?? []).length - 1]?.at ?? 0
  const lastWikiAt = s.wikiMarks[s.wikiMarks.length - 1]?.at ?? 0
  const lastAdvisor = s.advisor[s.advisor.length - 1]
  const lastAdvisorAt = lastAdvisor?.endedAt ?? lastAdvisor?.at ?? 0
  return now - lastLinkAt < REPLY_MS + 5000 || now - lastWikiAt < WIKI_HOT_MS + 5000 || now - lastAdvisorAt < ADVISOR_HOT_MS + 5000
}

export function orderedAgents(s: Snapshot): AgentRow[] {
  return Object.values(s.agents)
    .filter(row => row.id !== MAIN)
    .sort((a, b) => {
      const rank = (row: AgentRow) => (row.status === 'running' ? 0 : 1)
      return rank(a) - rank(b) || b.startedAt - a.startedAt
    })
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(n)
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

export function clock(at: number): string {
  const date = new Date(at)
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}
