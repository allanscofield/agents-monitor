const D = '/repo/docs/'
const APP = '/repo/app/'

const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-4-5-20251001'
const FABLE = 'claude-fable-5-1'

export function scenario(m) {
  const events = []
  const at = (t, run) => events.push({ t: t * 1000, run })
  const usage = (model, k) => ({ model, input_tokens: 400 * k, output_tokens: 180 * k, cache_read_input_tokens: 9000 * k, cache_creation_input_tokens: 600 * k })
  const step = (t, agentId, model, k, answer = '', advisor = false) =>
    at(t, (s, now) => m.applyStep(s, { at: now, agentId, model, effort: agentId ? 'medium' : 'high', answer, usage: usage(model, k), advisorCalls: advisor ? [{ startedAt: now, endedAt: now + 9000 }] : [] }))
  const tool = (t, agentId, name, input, fails = false) =>
    at(t, (s, now) => {
      const next = m.applyToolStart(s, { at: now, agentId, tool: name, input })
      return fails ? m.applyToolEnd(next, agentId, true) : next
    })
  const spawn = (t, agentId, type, description, model, prompt, isBackground = false) =>
    at(t, (s, now) => m.applySpawn(s, { at: now, agentId, type, description, model, prompt, isBackground }))
  const done = (t, agentId, answer) => at(t, (s, now) => m.applyTurnComplete(s, { at: now, agentId, reason: 'answer', answer }))
  const context = (t, tokens) =>
    at(t, (s, now) =>
      m.applyContext(s, {
        at: now,
        tokens,
        window: 1_000_000,
        percent: Math.round((tokens / 1_000_000) * 100),
        compactAt: 920_000,
        categories: [
          { name: 'System prompt', tokens: 18_000, kind: 'used' },
          { name: 'Tools', tokens: 26_000, kind: 'used' },
          { name: 'Memory files', tokens: 14_000, kind: 'used' },
          { name: 'Messages', tokens: Math.max(0, tokens - 58_000), kind: 'used' },
          { name: 'Free space', tokens: 1_000_000 - tokens - 45_000, kind: 'free' },
          { name: 'Autocompact buffer', tokens: 45_000, kind: 'buffer' },
        ],
      }),
    )

  at(0, (s, now) => m.applyTurnStart(s, now))
  step(0.6, undefined, OPUS, 2, 'Wiki: collaboration, architecture, structure')
  context(0.8, 92_000)
  tool(1.4, undefined, 'Read', { file_path: D + 'collaboration.md' })
  tool(2.6, undefined, 'Read', { file_path: D + 'architecture.md' })
  tool(3.8, undefined, 'Read', { file_path: D + 'structure.md' })
  step(4.6, undefined, OPUS, 3)
  context(4.8, 148_000)

  spawn(6, 'explorer', 'explorer', 'mapear o módulo Player', SONNET, 'Mapeie as camadas do módulo Player: View, ViewModel, Interactor e quem consome cada uma. '.repeat(14))
  spawn(7, 'finder', 'Explore', 'achar usos de PlayerView', HAIKU, 'Liste todos os arquivos que instanciam PlayerView. '.repeat(6))
  step(7.5, 'explorer', SONNET, 1)
  step(8, 'finder', HAIKU, 1)
  tool(8.5, 'explorer', 'Read', { file_path: D + 'player.md' })
  tool(9.2, 'finder', 'Grep', { pattern: 'PlayerView(', path: APP })
  tool(10.5, 'explorer', 'Glob', { pattern: 'app/Player/**/*.swift' })
  tool(11.4, 'finder', 'Grep', { pattern: 'PlayerViewModel', path: APP })
  step(12, 'explorer', SONNET, 2)
  tool(12.8, 'explorer', 'Read', { file_path: APP + 'Player/PlayerView.swift' })
  tool(14, 'explorer', 'Read', { file_path: D + 'swiftui-pattern.md' })
  tool(14.5, 'finder', 'Read', { file_path: APP + 'Home/HomeView.swift' })
  step(15.5, 'finder', HAIKU, 2)
  done(17, 'finder', 'Encontrei 6 arquivos que instanciam PlayerView: HomeView, LiveView, ShortzFeed, TrailerCard, KidsPlayer e DownloadsPlayer.')
  tool(17.5, 'explorer', 'Read', { file_path: APP + 'Player/PlayerViewModel.swift' })
  step(18.5, 'explorer', SONNET, 3)
  tool(19.5, 'explorer', 'Read', { file_path: APP + 'Player/PlayerInteractor.swift' })
  done(22, 'explorer', 'Player segue View → ViewModel → Interactor. O ViewModel tem 3 dependências e o Interactor é stateless. '.repeat(9))

  step(23, undefined, OPUS, 4, '', true)
  context(23.2, 236_000)
  tool(24, undefined, 'Read', { file_path: D + 'analytics.md' })
  tool(25.2, undefined, 'Edit', { file_path: APP + 'Player/PlayerViewModel.swift', old_string: 'a\nb', new_string: 'a\nb\nc\nd' })
  tool(26.5, undefined, 'Edit', { file_path: APP + 'Player/PlayerAnalytics.swift', old_string: 'a', new_string: 'a\nb\nc' })
  step(27.5, undefined, OPUS, 4)
  context(27.7, 284_000)

  spawn(29, 'verifier', 'verifier', 'build iOS + tvOS', HAIKU, 'Rode o build de iOS e tvOS e reporte só as falhas com arquivo e linha. '.repeat(4))
  spawn(30, 'writer', 'writer', 'ingest na wiki', SONNET, 'Documente a nova camada de analytics do Player na wiki e registre no log. '.repeat(10))
  step(30.5, 'verifier', HAIKU, 1)
  step(31, 'writer', SONNET, 1)
  tool(31.5, 'verifier', 'Read', { file_path: D + 'setup.md' })
  tool(32.5, 'writer', 'Read', { file_path: D + 'analytics.md' })
  tool(33.5, 'verifier', 'Bash', { description: 'xcodebuild iOS', command: 'xcodebuild -scheme App build' })
  tool(34.5, 'writer', 'Read', { file_path: D + 'analytics-event-model.md' })
  step(36, 'writer', SONNET, 2)
  tool(37, 'writer', 'Edit', { file_path: D + 'analytics.md', old_string: 'a', new_string: 'a\nb\nc' })
  tool(39, 'verifier', 'Bash', { description: 'xcodebuild tvOS', command: 'xcodebuild -scheme AppTV build' }, true)
  step(40, 'verifier', HAIKU, 2)
  tool(40.5, 'writer', 'Edit', { file_path: D + 'player.md', old_string: 'a', new_string: 'a\nb' })
  tool(42, 'writer', 'Bash', { description: 'registrar no log', command: "echo '- player analytics' >> docs/log.md" })
  done(43, 'verifier', 'tvOS falhou: PlayerAnalytics.swift:42 usa UIScreen, indisponível no tvOS.')
  step(44, 'writer', SONNET, 3)

  step(44.5, undefined, OPUS, 3)
  tool(45, undefined, 'SendMessage', { to: 'writer', message: 'Inclua também a regra do tvOS na página do player. '.repeat(3) })
  tool(46.5, undefined, 'Edit', { file_path: APP + 'Player/PlayerAnalytics.swift', old_string: 'UIScreen', new_string: 'Screen' })
  tool(47.5, 'writer', 'Edit', { file_path: D + 'player.md', old_string: 'b', new_string: 'b\nc' })
  context(48, 331_000)
  tool(49, undefined, 'Bash', { description: 'xcodebuild tvOS', command: 'xcodebuild -scheme AppTV build' })
  step(51, 'writer', SONNET, 2)
  done(53, 'writer', 'Wiki atualizada: analytics.md, player.md e log.md. '.repeat(5))
  step(54, undefined, OPUS, 3, '', true)
  tool(55.5, undefined, 'Bash', { description: 'rodar testes do ViewModel', command: 'xcodebuild test -only-testing PlayerViewModelTests' })
  step(58, undefined, OPUS, 2)
  context(58.2, 362_000)
  at(60, (s, now) => m.applyTurnComplete(s, { at: now, reason: 'answer', answer: 'Pronto.' }))

  return events.sort((a, b) => a.t - b.t)
}

export const DURATION_MS = 66_000
export const ADVISOR_MODEL = FABLE
