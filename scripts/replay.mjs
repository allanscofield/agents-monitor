// Uso: WINDOW_MS=1800000 node replay.mjs <pasta do plugin> <sessão.jsonl> <saída.svg> [largura] [agora em ms]
// Reproduz um transcript do Claude Code nos mesmos reducers do plugin e grava o SVG do pane.
import fs from 'node:fs'
import path from 'node:path'

const [, , modDir, transcript, outSvg, widthArg, nowArg] = process.argv
const work = path.resolve(path.dirname(outSvg), 'src')
fs.mkdirSync(work, { recursive: true })
for (const name of ['model.ts', 'svg.ts', 'brand.ts']) {
  const src = fs.readFileSync(path.join(modDir, 'hooks', name), 'utf8').replace(/from '\.\/model'/g, "from './model.ts'").replace(/from '\.\/brand'/g, "from './brand.ts'")
  fs.writeFileSync(path.join(work, name), src)
}
const model = await import(path.join(work, 'model.ts'))
const { renderSvg } = await import(path.join(work, 'svg.ts'))

const lines = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const ts = o => Date.parse(o.timestamp)

function replay(rows, agentId, s) {
  const seen = new Set()
  for (const o of rows) {
    if (o.type !== 'assistant' && o.type !== 'user') continue
    const at = ts(o)
    const content = Array.isArray(o.message?.content) ? o.message.content : []
    if (o.type === 'assistant') {
      const id = o.message.id
      if (!seen.has(id)) {
        seen.add(id)
        const u = o.message.usage
        s = model.applyStep(s, {
          at,
          agentId,
          model: o.message.model,
          effort: agentId ? undefined : 'high',
          answer: content.filter(b => b.type === 'text').map(b => b.text).join('\n'),
          usage: u ? { model: o.message.model, ...u } : null,
          advisorCalls: [],
        })
      } else if (!agentId && s.declared === null) {
        const text = content.filter(b => b.type === 'text').map(b => b.text).join('\n')
        const declared = model.parseDeclared(text)
        if (declared !== null) s = { ...s, declared }
      }
      for (const b of content) {
        if (b.type === 'tool_use') s = model.applyToolStart(s, { at, agentId, tool: b.name, input: b.input })
        if (b.type === 'server_tool_use' && b.name === 'advisor') {
          s = { ...s, advisor: [...s.advisor, { at, endedAt: at + 25000, agentId: agentId ?? 'main' }],
            feed: [...s.feed, { at, agentId: agentId ?? 'main', category: 'advisor', text: 'advisor consultado' }] }
        }
      }
    } else {
      for (const b of content) {
        if (b.type === 'tool_result' && b.is_error) s = model.applyToolEnd(s, agentId, true)
      }
      const r = o.toolUseResult
      if (r && r.agentId && !agentId) {
        const call = rows.flatMap(x => (Array.isArray(x.message?.content) ? x.message.content : [])).find(b => b.type === 'tool_use' && b.id === content.find(c => c.type === 'tool_result')?.tool_use_id)
        if (!s.agents[r.agentId]) {
          s = model.applySpawn(s, { at, agentId: r.agentId, type: call?.input?.subagent_type ?? 'general-purpose', description: r.description ?? call?.input?.description ?? '', model: r.resolvedModel })
        }
      }
    }
  }
  return s
}

const main = lines(transcript)
const start = ts(main.find(o => o.timestamp))
let s = model.emptySnapshot(start, 'fable')
s = model.applyTurnStart(s, start)
s = replay(main, undefined, s)
const subDir = transcript.replace(/\.jsonl$/, '') + '/subagents'
if (fs.existsSync(subDir)) {
  for (const f of fs.readdirSync(subDir).filter(f => f.endsWith('.jsonl'))) {
    const id = f.replace(/^agent-/, '').replace(/\.jsonl$/, '')
    const meta = JSON.parse(fs.readFileSync(path.join(subDir, f.replace('.jsonl', '.meta.json')), 'utf8'))
    const rows = lines(path.join(subDir, f))
    const texts = (o, role) => (o.type === role ? (Array.isArray(o.message?.content) ? o.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n') : String(o.message?.content ?? '')) : '')
    const prompt = rows.map(o => texts(o, 'user')).find(Boolean)
    const answer = rows.map(o => texts(o, 'assistant')).filter(Boolean).pop()
    if (!s.agents[id]) s = model.applySpawn(s, { at: ts(rows[0]), agentId: id, type: meta.agentType, description: meta.description, prompt })
    else s.agents[id] = { ...s.agents[id], startedAt: ts(rows[0]) }
    s = replay(rows, id, s)
    const end = ts(rows[rows.length - 1])
    const now = nowArg ? Number(nowArg) : Date.now()
    if (now - end > 60000) s = model.applyTurnComplete(s, { at: end, agentId: id, reason: 'answer', answer })
  }
}
s.feed.sort((a, b) => a.at - b.at)
const now = nowArg ? Number(nowArg) : Math.max(...s.feed.map(e => e.at)) + 20000
const svg = renderSvg(s, { width: Number(widthArg || 900), now, windowMs: Number(process.env.WINDOW_MS || 0) })
fs.writeFileSync(outSvg, svg)
fs.writeFileSync(outSvg.replace(/\.svg$/, '.json'), JSON.stringify(s))
console.log(`svg ${svg.length} chars, agents ${Object.keys(s.agents).length}, wiki ${Object.keys(s.wiki).length}, advisor ${s.advisor.length}, declared ${JSON.stringify(s.declared)}`)
