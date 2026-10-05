/**
 * 信号系统的打分器。
 *
 *   node test/signals.test.mjs
 *
 * 退出码 0 = 全部命中，1 = 有偏差。
 *
 * 测的是**折算逻辑**（纯函数），不碰模型、不花 token。
 * 这正是"改进信号"这件事最幸运的地方：它不需要模型 API 就能验。
 */

import { initialState, foldEvent, evaluate } from '../lib/mood.js'
import { CASES, SIGNAL_KEYS } from './signals.cases.mjs'

/** 把标注集里的简写事件展开成真正的事件对象。 */
function buildEvents(def) {
  const start = new Date(2026, 9, 4, def.at, 0, 0).getTime()
  let t = start
  const out = []
  for (const e of def.events || []) {
    const [kind, text, mins] = e
    t += (mins ?? 1) * 60 * 1000
    if (kind === 'u') out.push({ type: 'user/message', time: t, data: { content: [{ type: 'text', text }] } })
    else if (kind === 'ok') out.push({ type: 'tool/result', time: t, data: { message: { content: [] } } })
    else if (kind === 'fail') out.push({ type: 'tool/result', time: t, data: { message: { isError: true, content: [] } } })
    else if (kind === 'turn') out.push({ type: 'turn/start', time: t, data: {} })
    else if (kind === 'cut') out.push({ type: 'turn/end', time: t, data: { reason: { kind: 'aborted' } } })
    else throw new Error(`不认识的事件写法：${JSON.stringify(e)}`)
  }
  return { start, events: out, end: t }
}

const show = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : JSON.stringify(v))

let hit = 0
const misses = []

for (const def of CASES) {
  const { start, events, end } = buildEvents(def)
  let state = initialState(start)
  for (const ev of events) state = foldEvent(state, ev)
  const now = events.length ? end : start
  const got = evaluate(state, now)

  const problems = []

  if (def.expect !== undefined && got.register !== def.expect) {
    problems.push(`档位：期望 ${def.expect}，得到 ${got.register}`)
  }
  if (def.tone !== undefined && got.tone !== def.tone) {
    problems.push(`气压：期望 ${def.tone}，得到 ${got.tone}`)
  }
  if (def.reason !== undefined && !got.reasons.some((r) => r.includes(def.reason))) {
    problems.push(`理由：期望含「${def.reason}」，得到 ${JSON.stringify(got.reasons)}`)
  }
  for (const [k, want] of Object.entries(def.signals || {})) {
    if (!SIGNAL_KEYS.includes(k)) problems.push(`标注写了个不认识的字段：${k}`)
    else if (state[k] !== want) problems.push(`${k}：期望 ${show(want)}，得到 ${show(state[k])}`)
  }

  if (problems.length === 0) {
    hit += 1
    console.log(`  ✅ ${def.id.padEnd(12)} ${def.why}`)
  } else {
    misses.push({ def, problems, got, state })
    console.log(`  ❌ ${def.id.padEnd(12)} ${def.why}`)
    for (const p of problems) console.log(`       ${p}`)
  }
}

const total = CASES.length
const rate = Math.round((hit / total) * 1000) / 10

console.log()
console.log(`  命中 ${hit} / ${total}　（${rate}%）`)

if (misses.length) {
  console.log()
  console.log('  没命中的那些，看这里：')
  for (const m of misses) {
    console.log(`   · ${m.def.id}：${m.def.why}`)
    console.log(`     事件 ${JSON.stringify(m.def.events)}`)
    console.log(`     理由 ${JSON.stringify(m.got.reasons)}　档位 ${m.got.register}`)
  }
}

console.log()
console.log('  提醒：标注是作者定的，不是真理。它能防回归、能暴露自相矛盾，')
console.log('        但不能证明"更像人"——能定义对错的只有人。')
console.log()

process.exit(misses.length ? 1 : 0)
