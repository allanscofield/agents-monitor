export type ToolCategory = 'read' | 'write' | 'bash' | 'agent' | 'search' | 'web' | 'other'

export type AgentStatus = 'running' | 'idle' | 'done' | 'failed' | 'aborted'

export type ToolMark = { at: number; category: ToolCategory }

export type AgentRow = {
  id: string
  label: string
  type: string
  model?: string
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  tools: number
  errors: number
  steps: number
  tokensIn: number
  tokensOut: number
  lastTool?: string
  parentId?: string
  isBackground?: boolean
  name?: string
  promptChars?: number
  promptHead?: string
  replyChars?: number
  replyHead?: string
  lastToolAt?: number
  ctxTokens?: number
  ctxPeak?: number
  marks: ToolMark[]
}

export type ContextCategoryRow = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }

export type ContextPoint = { at: number; tokens: number }

export type ContextState = {
  at: number
  tokens?: number
  window: number
  percent?: number
  compactAt?: number
  categories?: ContextCategoryRow[]
  series: ContextPoint[]
  compactions: number[]
  peak: number
}

export type LinkKind = 'dispatch' | 'message' | 'reply'

export type Link = { at: number; from: string; to: string; kind: LinkKind; chars: number }

export type AdvisorCall = { at: number; endedAt?: number; agentId: string }

export type WikiTouch = 'read' | 'write' | 'search'

export type WikiPage = {
  slug: string
  reads: number
  writes: number
  firstAt: number
  lastAt: number
  agents: string[]
}

export type WikiMark = { at: number; slug: string; touch: WikiTouch; agentId: string }

export type FeedEvent = {
  at: number
  agentId: string
  category: ToolCategory | 'advisor' | 'spawn' | 'message' | 'done'
  text: string
  isError?: boolean
}

export type ModelTokens = { input: number; output: number }

export type Snapshot = {
  startedAt: number
  advisorModel?: string
  agents: Record<string, AgentRow>
  advisor: AdvisorCall[]
  wiki: Record<string, WikiPage>
  wikiMarks: WikiMark[]
  wikiSearches: number
  declared: string[] | null
  feed: FeedEvent[]
  links: Link[]
  context?: ContextState
  tokens: Record<string, ModelTokens>
  isBackfilled: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'agents-monitor': { snapshot: Snapshot | null; tick: number; windowMs: number }
  }
}
