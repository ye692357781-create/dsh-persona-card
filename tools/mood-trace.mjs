/**
 * 情绪模型的**逐步回放**。
 *
 *   node tools/mood-trace.mjs                      # 跑内置的几个场景
 *   node tools/mood-trace.mjs <已解压的会话.jsonl>  # 跑真实会话
 *
 * 为什么要有它（写在最前面，因为它是被一次失败逼出来的）：
 *
 *   v2.1.0 做完那天，我给归因埋了个验证——"制造一次失败，看下一轮会不会写出
 *   『路上被挡的，不是你搞砸的』"。下一轮写的是"平平稳稳"。我宣布验证失败。
 *
 *   然后发现：**是我把观测点放错了。** `failStreak` 每轮开始归零，
 *   所以那条理由只活在**同一轮的下一步**里，不跨轮。
 *   功能是好的，是我去错地方看了。
 *
 *   病根在这儿：`test/anchors.corpus.mjs` 那种跑分**只在轮末评估一次**，
 *   中间过程是黑的。看不到中间，就只能靠猜——而那天我已经猜错五次了。
 *
 * 所以这个工具只做一件事：**把每一步渲染出来的那一节，原样打出来。**
 */

import { readFileSync } from 'node:fs'
import { initialState, foldEvent, renderMood, evaluate } from '../lib/mood.js'

/* ── 内置场景：每个都对应一条不变量 ─────────────────────────── */

const FAIL = { message: { isError: true, content: [{ type: 'text', text: 'ENOENT: no such file' }] } }
const OK = { message: {} }
const ADMIT = { message: { content: [{ type: 'text', text: '我上一条说错了，是我读漏了' }] } }
const PRAISE = { content: [{ type: 'text', text: '谢谢你，太棒了' }] }

/** 场景：一串 [类型, data] 事件。 */
const SCENES = [
  {
    name: '环境挡了一下（不该往心里去）',
    hour: 12,
    events: [['turn/start'], ['tool/result', FAIL]],
  },
  {
    name: '自己认了错（该安静下来）',
    hour: 12,
    events: [['turn/start'], ['tool/result', FAIL], ['assistant/message', ADMIT]],
  },
  {
    name: '★ 同一个错，挪到黄昏（时段不该把它吃掉）',
    hour: 20,
    events: [['turn/start'], ['tool/result', FAIL], ['assistant/message', ADMIT]],
  },
  {
    name: '★ 认了错、活也干顺了（该有余味）',
    hour: 12,
    events: [['turn/start'], ['tool/result', FAIL], ['assistant/message', ADMIT], ['tool/result', OK]],
  },
  {
    name: '★ 被夸 + 自己出错（该压住密集档）',
    hour: 12,
    events: [['turn/start'], ['user/message', PRAISE], ['user/message', PRAISE], ['tool/result', FAIL], ['assistant/message', ADMIT]],
  },
]

function trace(label, hour, steps) {
  const now = new Date(2026, 9, 6, hour, 40).getTime()
  let s = initialState(now)
  console.log()
  console.log(`  ══ ${label}`)
  console.log(`     起点：${hour}:40`)
  for (const [type, data] of steps) {
    s = foldEvent(s, { type, time: now, data: data ?? {} })
    const r = evaluate(s, now)
    const notable = renderMood(s, now).split('\n').find((l) => l.includes('落在了你心上') || l.includes('平平稳稳')) ?? ''
    console.log()
    console.log(`     ▸ ${type}`)
    console.log(`       ${notable}`)
    console.log(`       档位=${r.register}  气压=${r.tone}  唤醒=${r.arousal}  归因=${r.blame ?? '—'}  blameSelf=${Math.round(s.blameSelf * 100) / 100}`)
  }
}

/* ── 真实会话模式 ────────────────────────────────────────────── */

function traceSession(file) {
  let s = initialState()
  let turn = 0
  let step = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'system/message') continue
    if (e.type === 'turn/start') { turn = e.data?.turn ?? turn + 1; step = 0 }
    s = foldEvent(s, { type: e.type, time: e.time ?? 0, data: e.data ?? {} })
    // 只在"值得说话"的步子上打——每步都打会淹掉重点
    if (e.type !== 'turn/start' && e.type !== 'turn/end') continue
    step++
    const r = evaluate(s, e.time ?? 0)
    const notable = renderMood(s, e.time ?? 0).split('\n').find((l) => l.includes('落在了你心上') || l.includes('平平稳稳')) ?? ''
    console.log(`  第${String(turn).padStart(3)}轮 ${e.type.padEnd(11)} 档位=${r.register.padEnd(7)} 归因=${String(r.blame ?? '—').padEnd(6)} 唤醒=${String(r.arousal).padEnd(6)} ${notable.slice(0, 46)}`)
  }
}

/* ── 入口 ────────────────────────────────────────────────────── */

const file = process.argv[2]
if (file) {
  console.log()
  console.log(`  ══ 真实会话：${file}`)
  traceSession(file)
  console.log()
} else {
  console.log()
  console.log('  ═══════ 情绪模型逐步回放 ═══════')
  for (const sc of SCENES) trace(sc.name, sc.hour, sc.events)
  console.log()
  console.log('  看什么：')
  console.log('   · 同一条理由，档位会不会随"几点"变——变了就是 bug')
  console.log('   · 活干顺了之后，自己认的错有没有留下余味')
  console.log('   · 被夸的时候出了错，还会不会写"密集"')
  console.log()
}
