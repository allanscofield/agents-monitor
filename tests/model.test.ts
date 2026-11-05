import { describe, expect, test } from 'claude-code/testing'

import * as model from '../hooks/model'
import { SVG_LIMIT, phaseLock, renderSvg } from '../hooks/svg'

const T0 = 1_760_000_000_000

describe('wikiHits', () => {
  test('Read and Edit on a docs page are a read and a write', () => {
    expect(model.wikiHits('Read', { file_path: '/repo/docs/routing.md' }).hits).toEqual([{ slug: 'routing', touch: 'read' }])
    expect(model.wikiHits('Edit', { file_path: '/repo/docs/log.md' }).hits).toEqual([{ slug: 'log', touch: 'write' }])
    expect(model.wikiHits('Write', { file_path: 'docs/agent-monitor.md' }).hits).toEqual([{ slug: 'agent-monitor', touch: 'write' }])
  })

  test('a bash cat of several pages reads each of them once', () => {
    const { hits } = model.wikiHits('Bash', { command: 'cat docs/how-we-work.md docs/code-conventions.md docs/how-we-work.md' })
    expect(hits).toEqual([
      { slug: 'how-we-work', touch: 'read' },
      { slug: 'code-conventions', touch: 'read' },
    ])
  })

  test('sed -i, a redirect and tee are writes', () => {
    expect(model.wikiHits('Bash', { command: "sed -i '' 's/a/b/' docs/log.md" }).hits).toEqual([{ slug: 'log', touch: 'write' }])
    expect(model.wikiHits('Bash', { command: 'echo x >> docs/log.md' }).hits).toEqual([{ slug: 'log', touch: 'write' }])
    expect(model.wikiHits('Bash', { command: 'printf x | tee -a docs/log.md' }).hits).toEqual([{ slug: 'log', touch: 'write' }])
  })

  test('grep over the wiki is a search, not a read', () => {
    const glob = model.wikiHits('Bash', { command: "grep -l '^area: sync' docs/*.md" })
    expect(glob.hits).toEqual([])
    expect(glob.isSearch).toBe(true)
    const named = model.wikiHits('Bash', { command: 'grep -n verified docs/routing.md' })
    expect(named.hits).toEqual([])
    expect(named.isSearch).toBe(true)
    expect(model.wikiHits('Grep', { pattern: 'aliases', path: 'docs' }).isSearch).toBe(true)
  })

  test('a folder that only ends in docs is not the wiki', () => {
    expect(model.wikiHits('Read', { file_path: '/repo/mydocs/routing.md' }).hits).toEqual([])
    expect(model.wikiHits('Read', { file_path: '/repo/docs/img/shot.png' }).hits).toEqual([])
  })
})

describe('parseDeclared', () => {
  test('reads the acknowledgement line the CLAUDE.md gate asks for', () => {
    expect(model.parseDeclared('Wiki: how-we-work, code-conventions, claude-tooling\n\nMapeei...')).toEqual([
      'how-we-work',
      'code-conventions',
      'claude-tooling',
    ])
    expect(model.parseDeclared('**Wiki:** `docs/routing.md`, overview')).toEqual(['routing', 'overview'])
  })

  test('none is an empty declaration and no line is null', () => {
    expect(model.parseDeclared('Wiki: none, a pergunta não toca código')).toEqual([])
    expect(model.parseDeclared('Sem a linha aqui')).toBe(null)
  })
})

describe('modelLabel and family', () => {
  test('turns model ids and aliases into names', () => {
    expect(model.modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(model.modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
    expect(model.modelLabel('claude-fable-5-1')).toBe('Fable 5.1')
    expect(model.modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(model.modelLabel('fable')).toBe('Fable')
    expect(model.family('claude-opus-5-5[1m]')).toBe('opus')
  })
})

describe('reducers', () => {
  test('a step counts tokens per model, the advisor call and the declared pages', () => {
    let s = model.emptySnapshot(T0, 'fable')
    s = model.applyStep(s, {
      at: T0 + 1000,
      model: 'claude-opus-5-5',
      effort: 'high',
      answer: 'Wiki: routing, overview',
      usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 },
      advisorCalls: [{ startedAt: T0 + 500, endedAt: T0 + 900 }],
    })
    expect(s.agents.main?.tokensIn).toBe(115)
    expect(s.agents.main?.tokensOut).toBe(20)
    expect(s.tokens['claude-opus-5-5']).toEqual({ input: 115, output: 20 })
    expect(s.advisor).toEqual([{ at: T0 + 500, endedAt: T0 + 900, agentId: 'main' }])
    expect(s.declared).toEqual(['routing', 'overview'])
  })

  test('the first declaration sticks and later answers do not overwrite it', () => {
    let s = model.emptySnapshot(T0)
    const step = (answer: string) => ({ at: T0, model: 'claude-opus-5-5', answer, usage: null, advisorCalls: [] })
    s = model.applyStep(s, step('Wiki: routing'))
    s = model.applyStep(s, step('Wiki: none'))
    expect(s.declared).toEqual(['routing'])
  })

  test('a subagent lives from spawn to its turn.complete, its tools on its own row', () => {
    let s = model.emptySnapshot(T0)
    s = model.applySpawn(s, { at: T0 + 10, agentId: 'a1', type: 'explorer', description: 'Map sync', model: 'claude-sonnet-5-5' })
    s = model.applyToolStart(s, { at: T0 + 20, agentId: 'a1', tool: 'Read', input: { file_path: '/r/docs/sync-model.md' } })
    s = model.applyToolEnd(s, 'a1', true)
    s = model.applyTurnComplete(s, { at: T0 + 30, agentId: 'a1', reason: 'answer' })
    const row = s.agents.a1
    expect(row?.status).toBe('done')
    expect(row?.tools).toBe(1)
    expect(row?.errors).toBe(1)
    expect(s.agents.main?.tools).toBe(0)
    expect(s.wiki['sync-model']?.agents).toEqual(['a1'])
    expect(s.feed.some(event => event.isError === true)).toBe(true)
  })

  test('a tool from an agent never spawned through the hook still gets a row', () => {
    const s = model.applyToolStart(model.emptySnapshot(T0), { at: T0, agentId: 'zz9', tool: 'Bash', input: { command: 'ls' } })
    expect(s.agents.zz9?.status).toBe('running')
  })

  test('the main loop goes idle at turn end, never done', () => {
    let s = model.applyTurnStart(model.emptySnapshot(T0), T0)
    expect(s.agents.main?.status).toBe('running')
    s = model.applyTurnComplete(s, { at: T0 + 5, reason: 'answer' })
    expect(s.agents.main?.status).toBe('idle')
  })

  test('history from a reload rebuilds the wiki and the subagents', () => {
    const s = model.applyHistory(
      model.emptySnapshot(T0),
      { assistantTexts: ['Wiki: routing'], toolUses: [{ tool: 'Read', input: { file_path: '/r/docs/routing.md' } }] },
      [{ id: 'b2', type: 'worker', description: 'Apply fix', status: 'completed', toolUses: [{ tool: 'Edit', input: { file_path: '/r/docs/log.md' } }] }],
    )
    expect(s.isBackfilled).toBe(true)
    expect(s.declared).toEqual(['routing'])
    expect(s.wiki.routing?.reads).toBe(1)
    expect(s.wiki.log?.writes).toBe(1)
    expect(s.agents.b2?.status).toBe('done')
  })
})

describe('interaction', () => {
  function dispatched() {
    let s = model.emptySnapshot(T0)
    s = model.applyTurnStart(s, T0)
    s = model.applySpawn(s, { at: T0 + 1000, agentId: 'a1', type: 'explorer', description: 'Map sync', name: 'scout', prompt: 'Mapeie o sync\ncom detalhes', model: 'claude-sonnet-5-5' })
    return s
  }

  test('a spawn is an order from the parent with the prompt size', () => {
    const s = dispatched()
    expect(s.links).toEqual([{ at: T0 + 1000, from: 'main', to: 'a1', kind: 'dispatch', chars: 26 }])
    expect(s.agents.a1?.promptChars).toBe(26)
    expect(s.agents.a1?.promptHead).toBe('Mapeie o sync com detalhes')
    expect(s.feed.at(-1)?.text).toContain('prompt 26 chars')
  })

  test('the energy runs down while the order arrives, keeps humming while it works, and runs up on the reply', () => {
    let s = dispatched()
    const row = () => s.agents.a1!
    expect(model.phaseOf(s, row(), T0 + 2000)).toMatchObject({ kind: 'dispatch', flow: 'down', isBurst: true })
    s = model.applyToolStart(s, { at: T0 + 20_000, agentId: 'a1', tool: 'Read', input: { file_path: '/r/x.swift' } })
    expect(model.phaseOf(s, row(), T0 + 30_000)).toMatchObject({ kind: 'working', flow: 'down', isBurst: false })
    s = model.applyTurnComplete(s, { at: T0 + 40_000, agentId: 'a1', reason: 'answer', answer: 'Relatório: tudo certo' })
    expect(s.links.at(-1)).toEqual({ at: T0 + 40_000, from: 'a1', to: 'main', kind: 'reply', chars: 21 })
    expect(row().replyChars).toBe(21)
    expect(model.phaseOf(s, row(), T0 + 45_000)).toMatchObject({ kind: 'reply', flow: 'up', isBurst: true })
    expect(model.phaseOf(s, row(), T0 + 40_000 + model.REPLY_MS + 1)).toMatchObject({ kind: 'replied', isBurst: false })
    expect(model.phaseOf(s, row(), T0 + 40_000 + model.REPLY_MS + 1).flow).toBeUndefined()
  })

  test('a background subagent carries no current while it works', () => {
    let s = model.applySpawn(model.emptySnapshot(T0), { at: T0, agentId: 'b1', type: 'worker', description: 'bg', isBackground: true })
    expect(model.phaseOf(s, s.agents.b1!, T0 + 60_000).flow).toBeUndefined()
    s = model.applyTurnComplete(s, { at: T0 + 70_000, agentId: 'b1', reason: 'error' })
    expect(model.phaseOf(s, s.agents.b1!, T0 + 71_000)).toMatchObject({ kind: 'failed', isBurst: false })
    expect(s.links.some(link => link.kind === 'reply')).toBe(false)
  })

  test('SendMessage to a running subagent by name is a message down the cable', () => {
    let s = dispatched()
    s = model.applyToolStart(s, { at: T0 + 30_000, tool: 'SendMessage', input: { to: 'scout', message: 'olhe também o watch' } })
    expect(s.links.at(-1)).toEqual({ at: T0 + 30_000, from: 'main', to: 'a1', kind: 'message', chars: 19 })
    expect(model.phaseOf(s, s.agents.a1!, T0 + 31_000)).toMatchObject({ kind: 'message', flow: 'down', isBurst: true })
    expect(s.feed.at(-1)?.category).toBe('message')
  })

  test('wiki activity knows who reads and who writes, and fades', () => {
    let s = dispatched()
    s = model.applyToolStart(s, { at: T0 + 5000, agentId: 'a1', tool: 'Read', input: { file_path: '/r/docs/sync-model.md' } })
    s = model.applyToolStart(s, { at: T0 + 6000, tool: 'Edit', input: { file_path: '/r/docs/log.md' } })
    expect(model.wikiActivity(s, 'a1', T0 + 7000)).toMatchObject({ read: true, write: false, slug: 'sync-model' })
    expect(model.wikiActivity(s, 'main', T0 + 7000)).toMatchObject({ read: false, write: true, slug: 'log' })
    expect(model.wikiActivity(s, 'a1', T0 + 5000 + model.WIKI_HOT_MS + 1).read).toBe(false)
    expect(model.wikiTotals(s, 'a1')).toEqual({ reads: 1, writes: 0 })
  })

  test('the pane keeps ticking until the last reply and wiki touch have faded', () => {
    let s = dispatched()
    s = model.applyTurnComplete(s, { at: T0 + 10_000, agentId: 'a1', reason: 'answer', answer: 'ok' })
    s = model.applyTurnComplete(s, { at: T0 + 10_000, reason: 'answer' })
    expect(model.isLive(s)).toBe(false)
    expect(model.needsTick(s, T0 + 12_000)).toBe(true)
    expect(model.needsTick(s, T0 + 10_000 + model.ADVISOR_HOT_MS + 60_000)).toBe(false)
  })

  test('a snapshot from before the links existed is migrated, not crashed on', () => {
    const { links, ...old } = model.emptySnapshot(T0)
    void links
    const s = model.migrate(old as never)
    expect(s.links).toEqual([])
  })

  test('the diagram energizes the order, the reply and the wiki cables', () => {
    let s = dispatched()
    s = model.applyToolStart(s, { at: T0 + 2000, agentId: 'a1', tool: 'Read', input: { file_path: '/r/docs/sync-model.md' } })
    for (const width of [460, 1100]) {
      const down = renderSvg(s, { width, now: T0 + 3000 })
      expect(down).toContain('animateMotion')
      expect(down).toContain('keyPoints="0;1"')
      expect(down).toContain('1 recebendo ordem')
      expect(down).toContain('#3987E5')
    }
    const wide = renderSvg(s, { width: 1100, now: T0 + 3000 })
    expect(wide).toContain('sendo lida agora')
    expect(wide).toContain('sync-model')
    expect(wide).toContain('▼ ordem 26')
    s = model.applyTurnComplete(s, { at: T0 + 50_000, agentId: 'a1', reason: 'answer', answer: 'feito' })
    const up = renderSvg(s, { width: 1100, now: T0 + 52_000 })
    expect(up).toContain('keyPoints="1;0"')
    expect(up).toContain('▲ resposta 5')
    expect(up).toContain('1 respondendo')
    const calm = renderSvg(s, { width: 1100, now: T0 + 50_000 + model.REPLY_MS + model.WIKI_HOT_MS + model.ADVISOR_HOT_MS })
    expect(calm).not.toContain('animateMotion')
    expect(calm).toContain('✓ há')
  })
})

describe('context window', () => {
  const step = (at: number, input: number, agentId?: string) => ({
    at,
    agentId,
    model: 'claude-opus-5-5',
    answer: '',
    usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: input - 10, cache_creation_input_tokens: 0 },
    advisorCalls: [],
  })

  test('readings build a series, keep the peak and flag a compaction when the context drops', () => {
    let s = model.emptySnapshot(T0)
    s = model.applyContext(s, { at: T0, tokens: 40_000, window: 1_000_000, percent: 4 })
    s = model.applyContext(s, { at: T0 + 1000, tokens: 40_000, window: 1_000_000, percent: 4 })
    s = model.applyContext(s, { at: T0 + 2000, tokens: 300_000, window: 1_000_000, percent: 30, compactAt: 800_000 })
    s = model.applyContext(s, { at: T0 + 3000, tokens: 50_000, window: 1_000_000, percent: 5 })
    expect(s.context?.series.map(point => point.tokens)).toEqual([40_000, 300_000, 50_000])
    expect(s.context?.peak).toBe(300_000)
    expect(s.context?.compactions).toEqual([T0 + 3000])
    expect(s.context?.compactAt).toBe(800_000)
    expect(s.context?.percent).toBe(5)
  })

  test('a reading without tokens keeps the last known figures', () => {
    let s = model.applyContext(model.emptySnapshot(T0), { at: T0, tokens: 12_000, window: 200_000, percent: 6, categories: [{ name: 'Messages', tokens: 9000, kind: 'used' }] })
    s = model.applyContext(s, { at: T0 + 5000, window: 200_000 })
    expect(s.context?.tokens).toBe(12_000)
    expect(s.context?.categories).toEqual([{ name: 'Messages', tokens: 9000, kind: 'used' }])
  })

  test('a subagent context is the input of its last step, with its own peak', () => {
    let s = model.applySpawn(model.emptySnapshot(T0), { at: T0, agentId: 'a1', type: 'explorer', description: 'x' })
    s = model.applyStep(s, step(T0 + 1, 30_000, 'a1'))
    s = model.applyStep(s, step(T0 + 2, 80_000, 'a1'))
    s = model.applyStep(s, step(T0 + 3, 20_000, 'a1'))
    expect(s.agents.a1?.ctxTokens).toBe(20_000)
    expect(s.agents.a1?.ctxPeak).toBe(80_000)
    expect(model.contextWindowOf(s, s.agents.a1!)).toBe(200_000)
    expect(model.percentOf(50_000, 200_000)).toBe(25)
  })

  test('a subagent on the main model measures against the session window', () => {
    let s = model.applyStep(model.emptySnapshot(T0), step(T0, 100_000))
    s = model.applyContext(s, { at: T0, tokens: 100_000, window: 1_000_000, percent: 10 })
    s = model.applySpawn(s, { at: T0, agentId: 'a1', type: 'fork', description: 'x' })
    s = model.applyStep(s, step(T0 + 1, 100_000, 'a1'))
    expect(model.contextWindowOf(s, s.agents.a1!)).toBe(1_000_000)
  })

  test('the pane draws the window, its slices, the autocompact line and each subagent context', () => {
    let s = model.applySpawn(model.emptySnapshot(T0), { at: T0, agentId: 'a1', type: 'explorer', description: 'Mapear sync' })
    s = model.applyStep(s, step(T0 + 1, 50_000, 'a1'))
    s = model.applyContext(s, {
      at: T0 + 2,
      tokens: 420_000,
      window: 1_000_000,
      percent: 42,
      compactAt: 900_000,
      categories: [
        { name: 'Messages', tokens: 380_000, kind: 'used' },
        { name: 'System prompt', tokens: 40_000, kind: 'used' },
        { name: 'Free space', tokens: 480_000, kind: 'free' },
      ],
    })
    for (const width of [460, 1100]) {
      const svg = renderSvg(s, { width, now: T0 + 60_000 })
      expect(svg).toContain('Janela de contexto')
      expect(svg).toContain('42%')
      expect(svg).toContain('420k de 1.0M tokens')
      expect(svg).toContain('autocompact')
      expect(svg).toContain('Contexto dos subagentes')
      expect(svg).toContain('50.0k · 25%')
    }
    expect(renderSvg(model.emptySnapshot(T0), { width: 460, now: T0 })).toContain('sem leitura ainda')
  })
})

describe('phaseLock', () => {
  const phase = (svg: string) => {
    const dur = Number(svg.match(/dur="([\d.]+)s"/)?.[1])
    const begin = Number(svg.match(/begin="(-?[\d.]+)s"/)?.[1])
    return (((-begin % dur) + dur) % dur)
  }

  test('a looping animation resumes at the phase of the wall clock on every redraw', () => {
    const tag = '<animate attributeName="r" values="3;8" dur="1.8s" repeatCount="indefinite"/>'
    const first = phaseLock(tag, 10_000)
    const later = phaseLock(tag, 10_700)
    expect(Math.round(phase(first) * 1000)).toBe(1000)
    expect(Math.round((phase(later) - phase(first)) * 1000)).toBe(700)
  })

  test('an existing stagger is kept and finite animations are left alone', () => {
    const staggered = phaseLock('<animateMotion dur="2.8s" begin="-1.4s" repeatCount="indefinite">', 2_800)
    expect(staggered).toContain('begin="-1.400s"')
    expect(staggered.match(/begin=/g)?.length).toBe(1)
    const once = '<animate attributeName="r" values="4;7;4" dur="1s" repeatCount="3"/>'
    expect(phaseLock(once, 5_000)).toBe(once)
  })
})

describe('renderSvg', () => {
  function busy(): ReturnType<typeof model.emptySnapshot> {
    let s = model.emptySnapshot(T0, 'fable')
    s = model.applyTurnStart(s, T0)
    for (let a = 0; a < 40; a++) {
      const id = `agent${a}`
      s = model.applySpawn(s, { at: T0 + a * 1000, agentId: id, type: a % 2 ? 'explorer' : 'general-purpose', description: `Task ${a} <&> "quoted"`, model: 'claude-sonnet-5-5' })
      for (let k = 0; k < 600; k++) {
        s = model.applyToolStart(s, { at: T0 + a * 1000 + k * 997, agentId: id, tool: k % 3 ? 'Read' : 'Bash', input: { file_path: `/r/docs/page-${k % 30}.md`, command: 'ls' } })
      }
    }
    for (let k = 0; k < 300; k++) {
      s = model.applyStep(s, { at: T0 + k * 2000, model: 'claude-opus-5-5', answer: '', usage: null, advisorCalls: [{ startedAt: T0 + k * 2000, endedAt: T0 + k * 2000 + 800 }] })
    }
    return s
  }

  test('a crowded session draws one short row per subagent, capped, with the rest counted', () => {
    let s = model.emptySnapshot(T0)
    for (let a = 0; a < 30; a++) s = model.applySpawn(s, { at: T0 + a, agentId: `x${a}`, type: 'explorer', description: `Tarefa ${a}` })
    const wide = renderSvg(s, { width: 1100, now: T0 + 1000 })
    expect(wide.match(/height="30" rx="10"/g)?.length).toBe(14)
    expect(wide).toContain('+16 subagentes anteriores')
    const narrow = renderSvg(s, { width: 460, now: T0 + 1000 })
    expect(narrow.match(/height="30" rx="10"/g)?.length).toBe(12)
  })

  test('stays under the Svg element limit with a session at every cap', () => {
    const s = busy()
    for (const width of [340, 460, 1100, 1600]) {
      const svg = renderSvg(s, { width, now: T0 + 4_000_000, windowMs: 0 })
      expect(svg.length).toBeLessThanOrEqual(SVG_LIMIT)
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg.split(/<g[\s>]/).length).toBe(svg.split('</g>').length)
    }
  })

  test('escapes what agents write into their descriptions', () => {
    const svg = renderSvg(busy(), { width: 1100, now: T0 + 4_000_000 })
    expect(svg.includes('<&>')).toBe(false)
    expect(svg).toContain('&lt;&amp;&gt;')
  })

  test('an empty session draws its empty states, not a blank card', () => {
    const svg = renderSvg(model.emptySnapshot(T0), { width: 460, now: T0 + 1000 })
    expect(svg).toContain('nenhum subagente nesta sessão ainda')
    expect(svg).toContain('nenhuma página aberta ainda')
    expect(svg).toContain('a resposta ainda não abriu com Wiki:')
  })

  test('a declared page nobody opened is flagged as não lida', () => {
    const s = model.applyStep(model.emptySnapshot(T0), { at: T0, model: 'claude-opus-5-5', answer: 'Wiki: routing', usage: null, advisorCalls: [] })
    expect(renderSvg(s, { width: 460, now: T0 + 1000 })).toContain('não lida')
  })
})
