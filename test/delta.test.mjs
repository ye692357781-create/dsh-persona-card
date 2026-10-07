/**
 * 变化线（v2.5.2）。
 *
 * 这一版存在的理由只有一句话：
 * **只报"现在什么状态"的两轮，放在一起只是两张快照。**
 * 人在意的是变化——「刚才还绷着，这一轮松了」。
 */
import { initialState, foldEvent, renderMood, deltaLine } from '../lib/mood.js'

let pass = 0, fail = 0
const check = (name, got, want) => {
  const ok = got === want
  if (ok) { pass++ } else { fail++; console.log(`  ✖ ${name}\n      实际 ${JSON.stringify(got)}\n      期望 ${JSON.stringify(want)}`) }
}

const at = (h, m = 0) => new Date(2026, 9, 7, h, m, 0).getTime()
const user = (t) => ({ type: 'user/message', data: { content: [{ type: 'text', text: t }] } })
const bad  = () => ({ type: 'tool/result', data: { message: { isError: true } } })
const good = () => ({ type: 'tool/result', data: { message: {} } })
const ts   = () => ({ type: 'turn/start', data: {} })

// ── ① 第一轮没有 prevShape，不该硬编一句变化 ──────────────
let s = foldEvent(initialState(at(12)), ts())
check('第一轮没有上一轮可比较', deltaLine(s), null)

// ── ② 核心场景：上一轮没做成，这一轮成了 ────────────────────
s = foldEvent(s, bad())
const 旧 = renderMood(s, at(12))
s = foldEvent(s, ts())          // ← 快照在这里拍
s = foldEvent(s, good())
// 工具失败默认归因是 'world'（实测），所以这条走的是"路通了"。
check('错→落地：说出了路通了', deltaLine(s),
  '和上一轮比，**路通了**——那件事刚才是被挡住的，不是你不行。')

const 新 = renderMood(s, at(12))
check('渲染里带上了变化线', 新.includes('路通了'), true)
check('变化线排在"落在了你心上"的下一行', (() => {
  const L = 新.split('\n').filter((x) => x.trim())
  const i = L.findIndex((x) => x.includes('落在了你心上') || x.includes('平平稳稳'))
  return L[i + 1] === deltaLine(s)
})(), true)

// ── ③ 变化线不该把老锚点挤掉（mood-trace 靠它定位）────────────
check('「落在了你心上」那行还在', 新.includes('落在了你心上'), true)
check('时段那行还在', 新.includes('白天'), true)

// ── ④ 真的没变的时候，一个字都不说 ────────────────────────
let q = foldEvent(initialState(at(12)), ts())
q = foldEvent(q, ts())
q = foldEvent(q, ts())
check('风平浪静时不硬凑一句', deltaLine(q), null)

// ── ⑤ 前两轮必须长得不一样（这就是"变化"本身）───────────────
console.log(`\n  ── 对比：第一轮 vs 第二轮 ──`)
console.log('  第一轮 →', 旧.split('\n').filter((x) => x.includes('落在了你心上')).join(''))
console.log('  第二轮 →', 新.split('\n').filter((x) => x.includes('落在了你心上') || x.includes('那口气')).join('\n           '))

console.log(`\n  ${fail === 0 ? '✅' : '❌'} 变化线：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
