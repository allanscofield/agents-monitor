import type { Elements } from 'claude-code'
import type { AgentRow, Snapshot } from '../types'
import {
  MAIN,
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
} from './model'
import { CATEGORY_COLOR, FAMILY_COLOR, agentColor, agentName } from './svg'

const DIM = '#8A97A8'
const MUTE = '#5B6779'
const OK = '#34D399'
const WARN = '#FBBF24'
const BAD = '#F87171'

const GLYPH: Record<AgentRow['status'], string> = {
  running: '◐',
  idle: '○',
  done: '✓',
  failed: '✕',
  aborted: '■',
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

function effortBar(effort: string | undefined): string {
  const level = effort ? EFFORTS.indexOf(effort) : -1
  return EFFORTS.map((_, i) => (i <= level ? '█' : '░')).join('')
}

function pad(text: string, width: number): string {
  if (text.length > width) return text.slice(0, Math.max(1, width - 1)) + '…'
  return text + ' '.repeat(width - text.length)
}

const WIRE: Record<string, string> = {
  dispatch: '══▶══',
  message: '══▶══',
  working: '──▷──',
  reply: '◀════',
  replied: '─────',
  failed: '──✕──',
  aborted: '──■──',
}

function meter(tokens: number | undefined, window: number, width: number): string {
  const percent = percentOf(tokens, window) ?? 0
  const filled = Math.round((percent / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function lane(marks: number[], from: number, to: number, width: number): string {
  const cells = Array.from({ length: width }, () => '·')
  const span = Math.max(1, to - from)
  for (const at of marks) {
    const col = Math.min(width - 1, Math.max(0, Math.floor(((at - from) / span) * width)))
    cells[col] = '●'
  }
  return cells.join('')
}

export function terminalView(els: Elements['terminal'], s: Snapshot, now: number, columns: number) {
  const { Box, Text } = els
  const width = Math.max(40, columns)
  const agents = orderedAgents(s)
  const main = s.agents[MAIN]
  const live = isLive(s)
  const advColor = FAMILY_COLOR[family(s.advisorModel ?? 'fable')]
  const pages = Object.values(s.wiki).sort((a, b) => b.writes - a.writes || b.lastAt - a.lastAt)
  const t0 = Math.min(s.startedAt, ...Object.values(s.agents).map(row => row.marks[0]?.at ?? row.startedAt))
  const laneW = Math.max(10, width - 16)
  const lanes: { name: string; color: string; marks: number[] }[] = [
    { name: 'principal', color: agentColor(main), marks: main?.marks.map(mark => mark.at) ?? [] },
    { name: 'advisor', color: advColor, marks: s.advisor.map(call => call.at) },
    { name: 'wiki', color: CATEGORY_COLOR.read, marks: s.wikiMarks.map(mark => mark.at) },
    ...agents.slice(0, 6).map(row => ({ name: agentName(row, row.id), color: agentColor(row), marks: row.marks.map(mark => mark.at) })),
  ]
  const last = s.advisor[s.advisor.length - 1]

  return (
    <Box flexDirection="column" width={width}>
      <Box justifyContent="space-between">
        <Text bold>MONITOR DE AGENTES</Text>
        <Text color={live ? OK : DIM} bold>
          {live ? '● AO VIVO' : '○ OCIOSO'} · {formatDuration(now - s.startedAt)}
        </Text>
      </Box>

      <Box borderStyle="round" borderColor={agentColor(main)} flexDirection="column" paddingX={1} marginTop={1}>
        <Box justifyContent="space-between">
          <Text>
            <Text color={DIM}>principal </Text>
            <Text color={agentColor(main)} bold>{modelLabel(main?.model)}</Text>
            <Text color={DIM}> {effortBar(main?.effort)} {main?.effort ?? ''}</Text>
          </Text>
          <Text color={main?.status === 'running' ? OK : DIM}>{GLYPH[main?.status ?? 'idle']}</Text>
        </Box>
        <Text>
          {main?.steps ?? 0} passos · {main?.tools ?? 0} tools · {formatTokens(main?.tokensIn ?? 0)}↓ {formatTokens(main?.tokensOut ?? 0)}↑
        </Text>
        <Text wrap="truncate-end">
          <Text color={DIM}>contexto </Text>
          <Text color={(s.context?.percent ?? 0) >= 85 ? BAD : (s.context?.percent ?? 0) >= 65 ? WARN : OK}>{meter(s.context?.tokens, s.context?.window ?? 200_000, 20)}</Text>
          <Text>
            {' '}
            {s.context?.tokens === undefined ? '—' : `${s.context.percent ?? percentOf(s.context.tokens, s.context.window)}% · ${formatTokens(s.context.tokens)}/${formatTokens(s.context.window)}`}
          </Text>
          <Text color={DIM}>{s.context ? ` · pico ${formatTokens(s.context.peak)} · ${s.context.compactions.length} compact.` : ''}</Text>
        </Text>
        <Text color={DIM} wrap="truncate-end">▸ {main?.lastTool ?? 'nenhuma tool ainda'}</Text>
      </Box>

      <Box borderStyle="round" borderColor={advColor} flexDirection="column" paddingX={1}>
        <Text>
          <Text color={advColor} bold>advisor {s.advisorModel ? modelLabel(s.advisorModel) : ''}</Text>
          <Text color={DIM}>
            {' '}· {s.advisor.length} chamadas{last ? ` · última há ${formatDuration(now - last.at)}` : ' · fala só quando é chamado'}
          </Text>
        </Text>
        {s.advisor.length > 0 && <Text color={advColor}>{'◆'.repeat(Math.min(s.advisor.length, width - 6))}</Text>}
      </Box>

      <Text color={DIM} bold>SUBAGENTES · {agents.filter(row => row.status === 'running').length} rodando · {agents.length} no total</Text>
      {agents.length === 0 && <Text color={MUTE}>  nenhum subagente nesta sessão ainda</Text>}
      {agents.slice(0, 8).map(row => (
        <Text wrap="truncate-end">
          <Text color={row.status === 'running' ? OK : row.status === 'failed' ? BAD : DIM}> {GLYPH[row.status]} </Text>
          <Text color={agentColor(row)} bold>{pad(row.type, 16)}</Text>
          <Text color={agentColor(row)}>{pad(modelLabel(row.model), 11)}</Text>
          <Text>{pad(row.label, 28)}</Text>
          <Text color={DIM}> {row.tools} tools · {formatDuration((row.endedAt ?? now) - row.startedAt)}</Text>
          {row.ctxTokens !== undefined && <Text color={DIM}> · ctx {formatTokens(row.ctxTokens)} {percentOf(row.ctxTokens, contextWindowOf(s, row))}%</Text>}
        </Text>
      ))}
      <Box marginTop={1} flexDirection="column">
        <Text color={DIM} bold>INTERAÇÃO · principal ⇄ subagentes ⇄ wiki</Text>
        {agents.slice(0, 8).map(row => {
          const phase = phaseOf(s, row, now)
          const wiki = wikiActivity(s, row.id, now)
          const wire = phase.kind === 'working' && row.isBackground ? '─ ─ ─' : WIRE[phase.kind]
          const label =
            phase.kind === 'dispatch' ? `ordem${row.promptChars !== undefined ? ` ${formatTokens(row.promptChars)}` : ''}`
            : phase.kind === 'message' ? 'mensagem'
            : phase.kind === 'reply' ? `resposta${row.replyChars !== undefined ? ` ${formatTokens(row.replyChars)}` : ''}`
            : phase.kind === 'working' ? 'trabalhando'
            : phase.kind === 'replied' ? 'respondeu'
            : phase.kind === 'failed' ? 'falhou'
            : 'interrompido'
          return (
            <Text wrap="truncate-end">
              <Text color={agentColor(main)}>principal </Text>
              <Text color={phase.flow === 'up' ? agentColor(row) : phase.isBurst ? agentColor(main) : phase.kind === 'failed' ? BAD : MUTE} bold={phase.isBurst}>{wire}</Text>
              <Text color={agentColor(row)}> {pad(agentName(row, row.id), 24)}</Text>
              <Text color={phase.isBurst ? undefined : DIM}>{pad(label, 15)}</Text>
              {wiki.write ? <Text color={CATEGORY_COLOR.write} bold>══▶ wiki {wiki.slug}</Text>
                : wiki.read ? <Text color={CATEGORY_COLOR.read} bold>◀══ wiki {wiki.slug}</Text>
                : null}
            </Text>
          )
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={DIM} bold>LINHA DO TEMPO · {clock(t0)} → agora</Text>
        {lanes.map(item => (
          <Text wrap="truncate-end">
            <Text color={item.color}>{pad(item.name, 13)} </Text>
            <Text color={item.color}>{lane(item.marks, t0, now, laneW)}</Text>
          </Text>
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={CATEGORY_COLOR.read} bold>
          WIKI · {pages.filter(page => page.reads > 0).length} lidas · {pages.filter(page => page.writes > 0).length} escritas · {s.wikiSearches} buscas
        </Text>
        <Text wrap="truncate-end">
          <Text bold>Wiki: </Text>
          {s.declared === null ? (
            <Text color={WARN}>ainda não declarada</Text>
          ) : s.declared.length === 0 ? (
            <Text color={DIM}>none</Text>
          ) : (
            s.declared.map(slug => {
              const touched = (s.wiki[slug]?.reads ?? 0) + (s.wiki[slug]?.writes ?? 0) > 0
              return <Text color={touched ? OK : WARN}>{touched ? '✓' : '!'} {slug}  </Text>
            })
          )}
        </Text>
        {pages.length === 0 && <Text color={MUTE}>  nenhuma página tocada ainda</Text>}
        {pages.slice(0, 12).map(page => (
          <Text wrap="truncate-end">
            <Text color={page.writes > 0 ? CATEGORY_COLOR.write : CATEGORY_COLOR.read}>{page.writes > 0 ? ' ■ ' : ' ● '}</Text>
            <Text>{pad(page.slug, 30)}</Text>
            <Text color={CATEGORY_COLOR.read}>{'▮'.repeat(Math.min(page.reads, 8))}</Text>
            <Text color={CATEGORY_COLOR.write}>{'▮'.repeat(Math.min(page.writes, 8))}</Text>
            <Text color={MUTE}> há {formatDuration(now - page.lastAt)}</Text>
          </Text>
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={DIM} bold>ATIVIDADE</Text>
        {s.feed.slice(-8).reverse().map(event => (
          <Text wrap="truncate-end">
            <Text color={MUTE}>{clock(event.at)} </Text>
            <Text color={agentColor(s.agents[event.agentId])}>{pad(agentName(s.agents[event.agentId], event.agentId), 13)}</Text>
            <Text color={event.isError ? BAD : CATEGORY_COLOR[event.category]}> ● </Text>
            <Text color={event.isError ? BAD : undefined}>{event.text}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  )
}
