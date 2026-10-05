/**
 * 心情模型的自测。纯函数，不需要启 Harness：
 *
 *   node test/mood.test.mjs
 *
 * 退出码 0 = 全过，1 = 有失败（方便接进 CI）。
 */

import { initialState, foldEvent, evaluate, renderMood, timeBaseline, REGISTERS } from '../lib/mood.js'

let pass = 0
let fail = 0

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else {
    fail++
    console.log(`  ❌ ${name}`)
    console.log(`      得到 ${JSON.stringify(got)}`)
    console.log(`      想要 ${JSON.stringify(want)}`)
  }
}

/** 造一个固定时刻，避免测试结果随真实时间漂移。 */
const at = (h, min = 30) => new Date(2026, 9, 4, h, min).getTime()
const userSays = (text) => ({ type: 'user/message', data: { content: [{ type: 'text', text }] } })
const toolFail = () => ({ type: 'tool/result', data: { message: { isError: true } } })
const toolOk = () => ({ type: 'tool/result', data: { message: {} } })
const turnStart = () => ({ type: 'turn/start', data: {} })

console.log('\n=== 时段打底 ===')
check('05:30 → 清晨', timeBaseline(at(5)).label, '清晨')
check('08:59 → 清晨', timeBaseline(at(8, 59)).label, '清晨')
check('09:00 → 白天', timeBaseline(at(9)).label, '白天')
check('12:30 → 白天', timeBaseline(at(12)).label, '白天')
check('19:30 → 黄昏', timeBaseline(at(19)).label, '黄昏')
check('23:30 → 深夜', timeBaseline(at(23)).label, '深夜')
check('03:30 → 深夜', timeBaseline(at(3)).label, '深夜')

console.log('\n=== 事件折算：不认识的必须原样返回同一引用 ===')
{
  const s = initialState(at(12))
  check('无关事件同一引用', foldEvent(s, { type: 'step/start', data: {} }) === s, true)
  check('null 事件安全', foldEvent(s, null) === s, true)
  check('缺 data 安全', foldEvent(s, { type: 'tool/result' }) !== s, true)
  check('undefined 状态安全', foldEvent(undefined, turnStart()), undefined)
}

console.log('\n=== 工具失败：累积、归零、档位 ===')
{
  let s = initialState(at(12))
  s = foldEvent(s, toolFail())
  check('失败一次 → failStreak 1', s.failStreak, 1)
  check('失败一次 → 气压 -1', evaluate(s, at(12)).tone, -1)
  s = foldEvent(s, toolFail())
  check('连败两次 → 档位 soft', evaluate(s, at(12)).register, 'soft')
  s = foldEvent(s, toolOk())
  check('成功一次 → failStreak 归零', s.failStreak, 0)
}

console.log('\n=== 被夸 ===')
{
  let s = initialState(at(19)) // 黄昏 +1
  s = foldEvent(s, userSays('你太厉害了，谢谢！'))
  check('黄昏 + 被夸 → 密集档', evaluate(s, at(19)).register, 'bright')
}

console.log('\n=== 对方往下沉：两级 ===')
{
  let s = foldEvent(initialState(at(12)), userSays('今天有点累'))
  check('轻 → tender 1', s.tender, 1)
  check('轻 → 收敛档', evaluate(s, at(12)).register, 'soft')

  let s2 = foldEvent(initialState(at(12)), userSays('我好崩溃，撑不住了'))
  check('重 → tender 2', s2.tender, 2)
  check('重 → 零装饰档', evaluate(s2, at(12)).register, 'hush')

  // 对方在往下沉时，就算一切都顺，也不该切回密集档
  let s3 = initialState(at(19))
  for (let i = 0; i < 5; i++) s3 = foldEvent(s3, toolOk())
  s3 = foldEvent(s3, userSays('我好崩溃'))
  check('一切顺利但对方崩溃 → 仍是零装饰', evaluate(s3, at(19)).register, 'hush')
}

console.log('\n=== 中断与出错 ===')
{
  let s = initialState(at(12))
  s = foldEvent(s, { type: 'turn/end', data: { reason: { kind: 'aborted' } } })
  check('被中断 → stumbles 1', s.stumbles, 1)
  check('被中断 → 气压 -1', evaluate(s, at(12)).tone, -1)

  const kinds = ['interrupted', 'error', 'blocked']
  for (const kind of kinds) {
    const st = foldEvent(initialState(at(12)), { type: 'turn/end', data: { reason: { kind } } })
    check(`turn/end ${kind} → stumbles 1`, st.stumbles, 1)
  }
  const done = foldEvent(initialState(at(12)), { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  check('正常完成 → 状态不变（同一引用）', done.turns === 0 && done.stumbles === 0, true)

  const cut = foldEvent(initialState(at(12)), { type: 'assistant/message', data: { interrupted: true } })
  check('她自己被打断 → stumbles 1', cut.stumbles, 1)
}

console.log('\n=== 情绪退潮（新一轮）===')
{
  let s = initialState(at(12))
  s = foldEvent(s, userSays('谢谢，太棒了'))
  const before = s.warmth
  s = foldEvent(s, turnStart())
  check('warmth 退潮但不归零', s.warmth < before && s.warmth > 0, true)
  check('turn 计数 +1', s.turns, 1)
  check('tender 退潮 2 → 1', foldEvent({ ...s, tender: 2 }, turnStart()).tender, 1)
}

console.log('\n=== 干活量 ===')
{
  let s = initialState(at(12))
  for (let i = 0; i < 8; i++) s = foldEvent(s, { type: 'tool/call', data: {} })
  check('8 次工具调用 → labour 8', s.labour, 8)
  check('渲染里出现「干了挺久」', renderMood(s, at(12)).includes('干了挺久'), true)
}

console.log('\n=== 渲染 ===')
{
  let s = initialState(at(23))
  s = foldEvent(s, toolFail())
  s = foldEvent(s, toolFail())
  const txt = renderMood(s, at(23))
  console.log('  ── 深夜 + 连败两次，渲染出来是这样 ──')
  for (const line of txt.split('\n')) console.log(`  │ ${line}`)
  check('含时段', txt.includes('深夜'), true)
  check('含档位指令', txt.includes('档位'), true)
  check('含原因', txt.includes('没干成'), true)
}

console.log('\n=== 四档都能被触发 ===')
{
  const seen = new Set()
  seen.add(evaluate(foldEvent(initialState(at(19)), userSays('谢谢，太棒了')), at(19)).register)
  seen.add(evaluate(initialState(at(12)), at(12)).register)
  seen.add(evaluate(foldEvent(foldEvent(initialState(at(12)), toolFail()), toolFail()), at(12)).register)
  seen.add(evaluate(foldEvent(initialState(at(12)), userSays('我好崩溃')), at(12)).register)
  check('四个档位都被覆盖到', [...seen].sort(), [...REGISTERS].sort())
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
process.exit(fail ? 1 : 0)
