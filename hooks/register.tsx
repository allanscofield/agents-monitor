import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot } from '../types'
import * as model from './model'
import { renderSvg } from './svg'
import { terminalView } from './terminal'

const PANE = 'agents-monitor'
const snapshot = atom({ plugin: 'agents-monitor', key: 'snapshot' } as const, null)
const tick = atom({ plugin: 'agents-monitor', key: 'tick' } as const, 0)
const windowMs = atom({ plugin: 'agents-monitor', key: 'windowMs' } as const, 30 * 60_000)

const WINDOWS: [string, number][] = [
  ['15 min', 15 * 60_000],
  ['30 min', 30 * 60_000],
  ['1 h', 60 * 60_000],
  ['sessão', 0],
]

type Dollar = Pick<EngineInterface, 'state' | 'clock'>

async function apply($: Dollar, fn: (s: Snapshot, now: number) => Snapshot) {
  const now = await $.clock.now()
  await update($, snapshot, current => fn(current ?? model.emptySnapshot(now), now))
}

let breakdownAt = 0

async function readContext($: EngineInterface, isDetailed: boolean) {
  const now = await $.clock.now()
  const wantsBreakdown = isDetailed && now - breakdownAt > 10_000
  if (wantsBreakdown) breakdownAt = now
  const { context } = await $.session.usage(wantsBreakdown ? { breakdown: 'summary' } : undefined)
  const breakdown = context.breakdown
  await apply($, s =>
    model.applyContext(s, {
      at: now,
      tokens: context.tokens,
      window: context.window,
      percent: context.percent,
      compactAt: breakdown ? (breakdown.isAutoCompactEnabled ? (breakdown.autoCompactThreshold ?? breakdown.rawMaxTokens) : undefined) : undefined,
      categories: breakdown?.categories.map(row => ({ name: row.name, tokens: row.tokens, kind: row.kind })),
    }),
  )
}

async function backfill($: EngineInterface) {
  const messages = await $.session.messages()
  const main = {
    assistantTexts: messages.filter(m => m.role === 'assistant').map(m => m.text),
    toolUses: messages.flatMap(m => m.toolUses.map(use => ({ tool: use.tool, input: use.input, isError: use.isError }))),
  }
  const agents: model.HistoryAgent[] = []
  for (const info of await $.agent.list()) {
    const rows = await $.session.messages({ agentId: info.id })
    agents.push({
      id: info.id,
      type: info.type,
      description: info.description,
      status: info.status,
      parentId: info.parentId,
      toolUses: Array.isArray(rows)
        ? rows.flatMap(m => m.toolUses.map(use => ({ tool: use.tool, input: use.input, isError: use.isError })))
        : [],
    })
  }
  await update($, snapshot, current => (current && !current.isBackfilled ? model.applyHistory(current, main, agents) : current))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'agents-monitor',
        description: 'Abre o painel ao vivo dos agentes, do advisor e da wiki',
      })
      const settings = (await $.settings.read()) as Record<string, unknown>
      const advisorModel = typeof settings.advisorModel === 'string' ? settings.advisorModel : undefined
      const startedAt = (await $.session.usage()).startedAt
      const current = await read($, snapshot)
      if (current === null) {
        await update($, snapshot, () => model.emptySnapshot(startedAt, advisorModel))
        void backfill($).catch(error => $.ui.log(`agents-monitor: ${String(error)}`))
        void readContext($, true).catch(() => {})
      } else {
        await update($, snapshot, s => (s ? { ...model.migrate(s), advisorModel, startedAt } : s))
      }
      $.clock.every(4000, () => {
        void Promise.all([read($, snapshot), $.clock.now()]).then(([s, now]) =>
          s && model.needsTick(s, now) ? update($, tick, n => (n ?? 0) + 1) : undefined,
        )
      })
      if ((await $.store.get('isOpen')) === true) void $.ui.open({ id: PANE, title: 'Agentes' })
    } catch (error) {
      $.ui.log(`agents-monitor: ${String(error)}`)
    }
    return next(e)
  })

  on('command.run', { command: 'agents-monitor' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agentes' })
    await $.store.set('isOpen', true)
    return { text: 'Painel de agentes aberto. Ele volta sozinho nas próximas sessões até você fechar.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await $.store.set('isOpen', false)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as model.ToolInput
    const recorded = apply($, (s, now) => model.applyToolStart(s, { at: now, agentId: e.agentId, tool: String(e.tool), input })).catch(() => {})
    const result = await next(e)
    await recorded
    if (result.isError) {
      try {
        await apply($, s => model.applyToolEnd(s, e.agentId, true))
      } catch {}
    }
    return result
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const agentId = result.agentId
    if (agentId) {
      try {
        await apply($, (s, now) =>
          model.applySpawn(s, {
            at: now,
            agentId,
            type: e.subagentType,
            description: e.description,
            model: result.model,
            parentId: e.parentAgentId,
            isBackground: e.background,
            name: result.teammateId ?? e.name,
            prompt: e.prompt,
          }),
        )
      } catch {}
    }
    return result
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    try {
      await apply($, (s, now) => model.applyTurnStart(s, now))
    } catch {}
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    try {
      await apply($, (s, now) =>
        model.applyStep(s, {
          at: now,
          agentId: e.agentId,
          model: e.model,
          effort: e.effort === undefined ? undefined : String(e.effort),
          answer: result.answer,
          usage: result.usage,
          advisorCalls: (result.serverToolUses ?? [])
            .filter(use => use.name === 'advisor')
            .map(use => ({ startedAt: use.startedAt, endedAt: use.endedAt })),
        }),
      )
      if (!e.agentId) await readContext($, false)
    } catch {}
    return result
  })

  on('turn.complete', async ($, e, next) => {
    try {
      await apply($, (s, now) => model.applyTurnComplete(s, { at: now, agentId: e.agentId, reason: e.reason, answer: e.answer }))
      if (!e.agentId) await readContext($, true)
    } catch {}
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    try {
      await readContext($, true)
    } catch {}
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const current = await read($, snapshot)
    await read($, tick)
    const now = await $.clock.now()
    const span = await read($, windowMs)
    const s = current ? model.migrate(current) : model.emptySnapshot(now)
    if (e.surface === 'terminal') {
      return terminalView($.ui.resolve(e), s, now, e.props.bodyColumns)
    }
    if (e.surface === 'mobile') {
      const { Box, Svg } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Svg source={renderSvg(s, { width: 420, now, windowMs: span })} alt="Monitor de agentes" />
        </Box>
      )
    }
    const { Box, Button, Svg } = $.ui.resolve(e)
    const width = Math.max(340, Math.round(e.props.bodyColumns * 7.8))
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          {WINDOWS.map(([label, ms]) => (
            <Button
              key={`window-${ms}`}
              label={label}
              variant={ms === span ? 'primary' : 'secondary'}
              onPress={() => update($, windowMs, () => ms)}
            />
          ))}
        </Box>
        <Svg source={renderSvg(s, { width, now, windowMs: span })} alt="Monitor de agentes: interação entre a sessão principal, os subagentes, o advisor e a wiki" />
      </Box>
    )
  })
}
