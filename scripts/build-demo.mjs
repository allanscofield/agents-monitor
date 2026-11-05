// Uso: node scripts/build-demo.mjs [saída.html]
// Gera um HTML autocontido que roda os reducers e o renderSvg do plugin no navegador
// com um roteiro fictício de operações (demo/scenario.js), com play, pause e reset.
import fs from 'node:fs'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const out = path.resolve(process.argv[2] ?? path.join(root, 'demo', 'agent-monitor-demo.html'))

const ts = name => stripTypeScriptTypes(fs.readFileSync(path.join(root, 'hooks', `${name}.ts`), 'utf8'), { mode: 'strip' })
const sources = {
  brand: ts('brand'),
  model: ts('model'),
  svg: ts('svg'),
  scenario: fs.readFileSync(path.join(root, 'demo', 'scenario.js'), 'utf8'),
}
const embedded = JSON.stringify(sources).replace(/<\//g, '<\\/')

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agents Monitor demo</title>
<style>
  :root { color-scheme: dark; --bg: #07070A; --ink: #F4F4F5; --muted: #A1A1AA; --line: rgba(255,255,255,.1); --chip: rgba(255,255,255,.06); }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 13px/1.4 'SF Pro Text', system-ui, -apple-system, sans-serif; }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 24px; background: rgba(7,7,10,.86); backdrop-filter: blur(14px); border-bottom: 1px solid var(--line); }
  button { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px; border-radius: 17px; border: 1px solid var(--line); background: var(--chip); color: var(--ink); font: inherit; font-weight: 600; cursor: pointer; }
  button:hover { background: rgba(255,255,255,.1); }
  button:focus-visible, input:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  button.primary { background: var(--ink); color: #0B0B0B; border-color: transparent; min-width: 104px; justify-content: center; }
  button.primary:hover { background: #fff; }
  .speed { display: inline-flex; border: 1px solid var(--line); border-radius: 17px; overflow: hidden; }
  .speed button { border: 0; border-radius: 0; height: 32px; padding: 0 11px; background: transparent; color: var(--muted); }
  .speed button[aria-pressed="true"] { background: rgba(255,255,255,.12); color: var(--ink); }
  .track { flex: 1 1 220px; display: flex; align-items: center; gap: 10px; min-width: 200px; }
  input[type=range] { flex: 1; accent-color: #F4F4F5; }
  .time { font: 12px 'SF Mono', ui-monospace, Menlo, monospace; color: var(--muted); font-variant-numeric: tabular-nums; min-width: 92px; text-align: right; }
  label.loop { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); cursor: pointer; }
  .stage { display: flex; justify-content: center; padding: 16px 0 40px; }
  .stage svg { max-width: 100%; height: auto; }
  .hint { color: var(--muted); font-size: 12px; }
  @media (max-width: 640px) { .bar { padding: 10px 16px; } .hint { display: none; } }
</style>
</head>
<body>
<div class="bar">
  <button id="play" class="primary" aria-label="Play"></button>
  <button id="reset" aria-label="Reset"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9"/><path d="M2.5 2.5v3h3"/></svg>Reset</button>
  <div class="speed" role="group" aria-label="Velocidade">
    <button data-speed="1" aria-pressed="true">1×</button><button data-speed="2" aria-pressed="false">2×</button><button data-speed="4" aria-pressed="false">4×</button>
  </div>
  <label class="loop"><input id="loop" type="checkbox" checked> repetir</label>
  <div class="track">
    <input id="seek" type="range" min="0" max="1000" value="0" aria-label="Posição da simulação">
    <span id="time" class="time">0:00 / 1:06</span>
  </div>
  <span class="hint">espaço: play/pause · R: reset</span>
</div>
<div id="stage" class="stage"></div>
<script type="module">
const SOURCES = ${embedded}
const urls = {}
for (const name of ['brand', 'model', 'svg', 'scenario']) {
  let code = SOURCES[name]
  for (const [dep, url] of Object.entries(urls)) code = code.replaceAll("'./" + dep + "'", "'" + url + "'")
  urls[name] = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
}
const m = await import(urls.model)
const { renderSvg } = await import(urls.svg)
const sc = await import(urls.scenario)

const T0 = new Date().setHours(14, 0, 0, 0)
const events = sc.scenario(m)
const END = sc.DURATION_MS
const stage = document.getElementById('stage')
const playBtn = document.getElementById('play')
const seek = document.getElementById('seek')
const time = document.getElementById('time')
const loop = document.getElementById('loop')

const PLAY = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 1.2v9.6L10.6 6z" fill="currentColor"/></svg>Play'
const PAUSE = '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1.5" width="2.8" height="9" rx=".8" fill="currentColor"/><rect x="7.2" y="1.5" width="2.8" height="9" rx=".8" fill="currentColor"/></svg>Pause'

let s, sim, next, animClock = 0, playing = false, speed = 1, lastFrame = 0, lastRender = 0, dirty = true

const fmt = ms => { const t = Math.floor(ms / 1000); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0') }

function advanceTo(t) {
  sim = Math.min(t, END)
  while (next < events.length && events[next].t <= sim) {
    s = events[next].run(s, T0 + events[next].t)
    next += 1
    dirty = true
  }
}

function reset(to = 0) {
  s = m.emptySnapshot(T0, sc.ADVISOR_MODEL)
  sim = 0
  next = 0
  dirty = true
  advanceTo(to)
  render()
}

function render() {
  const width = Math.min(1240, Math.max(360, stage.clientWidth - 32))
  stage.innerHTML = renderSvg(s, { width, now: T0 + sim, windowMs: 0, clockMs: animClock })
  const svg = stage.querySelector('svg')
  svg.pauseAnimations()
  svg.setCurrentTime(0)
  if (playing) svg.unpauseAnimations()
  seek.value = String(Math.round((sim / END) * 1000))
  time.textContent = fmt(sim) + ' / ' + fmt(END)
  dirty = false
  lastRender = performance.now()
}

function setPlaying(value) {
  playing = value
  playBtn.innerHTML = playing ? PAUSE : PLAY
  playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play')
  const svg = stage.querySelector('svg')
  if (svg && playing) svg.unpauseAnimations()
  else if (s) render()
}

function frame(ts) {
  if (playing) {
    animClock += ts - lastFrame
    advanceTo(sim + (ts - lastFrame) * speed)
    if (sim >= END) {
      if (loop.checked) reset()
      else setPlaying(false)
    }
    if (dirty || ts - lastRender > 1000) render()
  }
  lastFrame = ts
  requestAnimationFrame(frame)
}

playBtn.addEventListener('click', () => {
  if (!playing && sim >= END) reset()
  setPlaying(!playing)
})
document.getElementById('reset').addEventListener('click', () => { setPlaying(false); reset() })
seek.addEventListener('input', () => reset((Number(seek.value) / 1000) * END))
for (const b of document.querySelectorAll('[data-speed]')) {
  b.addEventListener('click', () => {
    speed = Number(b.dataset.speed)
    for (const o of document.querySelectorAll('[data-speed]')) o.setAttribute('aria-pressed', String(o === b))
  })
}
document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return
  if (e.code === 'Space') { e.preventDefault(); playBtn.click() }
  if (e.key === 'r' || e.key === 'R') document.getElementById('reset').click()
})
let resizeTimer
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120) })

setPlaying(false)
reset()
requestAnimationFrame(ts => { lastFrame = ts; requestAnimationFrame(frame) })
</script>
</body>
</html>
`
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, html)
console.log(out, `${Math.round(html.length / 1024)} KB`)
