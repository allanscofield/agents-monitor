import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane' as const,
  requestId: 'agents-monitor',
  props: {
    title: 'Agentes',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
}

const T0 = 1_760_000_000_000

test('wiki pages a tool call opens show up in the pane', async ($, on) => {
  mock.clock(on, { now: T0 })
  on('tool.call', () => ({ result: 'ok' }))
  await $.tool.call({ tool: 'Bash', command: 'cat docs/routing.md docs/overview.md', description: 'Ler a wiki' })
  await $.tool.call({ tool: 'Bash', command: 'echo x >> docs/log.md', description: 'Registrar' })
  const ui = await $.ui.mount({ plugin: 'agents-monitor', surface: 'desktop', ...PANE })
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('routing')
  expect(source).toContain('overview')
  expect(source).toContain('editada')
  expect(source).toContain('2 lidas · 1 editada')
  await ui.unmount()
})

test('the pane draws an Svg on desktop and text on the terminal', async ($, on) => {
  mock.clock(on, { now: T0 })
  on('tool.call', () => ({ result: 'ok' }))
  await $.tool.call({ tool: 'Bash', command: 'cat docs/routing.md', description: 'Ler a wiki' })

  const desktop = await $.ui.mount({ plugin: 'agents-monitor', surface: 'desktop', ...PANE })
  const svg = await desktop.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('Interação')
  expect(String(svg?.props.source)).toContain('routing')
  expect(await desktop.findAll({ type: 'Button' })).toHaveLength(4)
  expect((await desktop.find({ key: 'window-1800000' }))?.props.variant).toBe('primary')
  await desktop.press({ key: 'window-0' })
  expect((await desktop.find({ key: 'window-0' }))?.props.variant).toBe('primary')
  expect((await desktop.find({ key: 'window-1800000' }))?.props.variant).toBe('secondary')
  await desktop.unmount()

  const terminal = await $.ui.mount({ plugin: 'agents-monitor', surface: 'terminal', ...PANE })
  expect(await terminal.find({ type: 'Text', text: /MONITOR DE AGENTES/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /routing/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /INTERAÇÃO/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /contexto/ })).toBeDefined()
  await terminal.unmount()
})

test('the command opens the pane and remembers it for the next session', async ($, on) => {
  mock.clock(on, { now: T0 })
  const writes: unknown[] = []
  on('store.set', (_$, e) => {
    writes.push(e)
    return { value: undefined } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  await $.command.run({ command: 'agents-monitor' } as never)
  expect(writes).toContainEqual({ key: 'isOpen', value: true })
})

test('the desktop Svg is an image, so its height follows the drawing and not a fixed frame', async ($, on) => {
  mock.clock(on, { now: T0 })
  const ui = await $.ui.mount({ plugin: 'agents-monitor', surface: 'desktop', ...PANE })
  const svg = await ui.find({ type: 'Svg' })
  expect(svg?.props.isInteractive).toBeUndefined()
  expect(svg?.props.height).toBeUndefined()
  await ui.unmount()
})
