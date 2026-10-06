/**
 * 归因（appraisal）回归测试。
 *
 *   node test/appraisal.test.mjs
 *
 * 复现的是一个真缺陷：**现在的情绪模型分不清"我错了"和"路堵了"。**
 *
 * 2026-10-06 那天有两组现成的对照：
 *   · 我误诊了两次（探针写歪、只 grep 了一个包就下结论）—— **我的锅**
 *   · 命令被设备策略拦了（POLICY_BLOCKED）        —— **不是我的锅**
 * 两种在旧模型里长得一模一样：「连着 1 次没干成，-1」。
 *
 * 可人对这两件事的反应完全不同：一个该安静下来反省，一个该耸耸肩换个法子。
 * 依据来自情境评估（appraisal）理论：情绪不由"发生了什么"决定，
 * 由"你怎么看这件事"决定。参见 arXiv:2309.05076。
 *
 * 契约：
 *   evaluate(state).blame    'self' | 'world' | null
 *   evaluate(state).arousal  数值，越高越激越（平静 ↔ 激越）
 *   register 受归因影响：负向 + 自己 → 收敛；负向 + 环境 → 照常
 */

import { initialState, foldEvent, evaluate, renderMood } from '../lib/mood.js'

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

const at = (h) => new Date(2026, 9, 6, h, 30).getTime()

const toolFail = (text) => ({
  type: 'tool/result',
  data: { message: { isError: true, content: text ? [{ type: 'text', text }] : [] } },
})
const toolOk = () => ({ type: 'tool/result', data: { message: {} } })
const say = (text) => ({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } })
// 夸和倾诉是**对方**说的，不是她自己说的——用 user/message。
// （v3 第一版我把这两条喂成了 assistant/message，唤醒度当然不动。
//   用例写错和代码写错长得一样，都得靠"跑一遍看"分开。）
const user = (text) => ({ type: 'user/message', data: { content: [{ type: 'text', text }] } })
const turn = () => ({ type: 'turn/start', data: {} })

const run = (events, h = 12) => {
  let s = initialState(at(h))
  for (const e of events) s = foldEvent(s, e)
  return evaluate(s, at(h))
}

console.log()
console.log('  ── ① 归因：同一件"没干成"，两种来源必须分得开 ──')

const world = run([turn(), toolFail('POLICY_BLOCKED 禁止脚本、管道、重定向')])
const self = run([turn(), toolFail('命令失败'), say('我上一条说错了，是我读漏了')])

check('被策略拦住 → 归因是环境', world.blame, 'world')
check('自己认错     → 归因是自己', self.blame, 'self')

// ★ 这条是拿真实会话跑过之后补的：**没认错的失败，默认就是环境的。**
// 第一版要求"扫到拦截标记才算环境"，于是真实数据里 world 一次都没触发——
// 因为真正被拦的那几次，外层命令是成功的。而"路上有石头"本来就不需要证明。
const plain = run([turn(), toolFail('ENOENT: no such file or directory')])
check('没认错的失败 → 也是环境（默认）', plain.blame, 'world')
check('而且它的档位不因自责而下沉', plain.register, 'normal')

console.log()
console.log('  ── ② 档位：负向也要分「反省」和「无奈」──')

check('环境挡的 → 档位照常（耸耸肩继续）', world.register, 'normal')
check('自己错的 → 档位收敛（安静下来）', self.register, 'soft')

console.log()
console.log('  ── ③ 理由要说得出是哪一种 ──')

check(
  '环境的理由里点明"被挡住"',
  world.reasons.some((r) => /挡|拦|堵/.test(r)),
  true,
)
check(
  '自己的理由里点明"是我"',
  self.reasons.some((r) => /自己|我/.test(r)),
  true,
)

console.log()
console.log('  ── ④ 唤醒度：第二个轴必须存在且会动 ──')

check('唤醒度是个数', typeof world.arousal, 'number')
const praised = run([turn(), user('谢谢你，太棒了')])
const soothed = run([turn(), user('我好崩溃，有点累'), user('想哭')])
check('被夸 → 唤醒度上升', praised.arousal > world.arousal, true)
check('对方在往下沉 → 唤醒度下降', soothed.arousal < praised.arousal, true)

console.log()
console.log('  ── ⑤ 不能退步：单纯的成功仍然是照常 ──')

const fine = run([turn(), toolOk()])
check('一切顺利 → 照常', fine.register, 'normal')
check('一切顺利 → 没有归因', fine.blame, null)

console.log()
console.log('  ── ⑥ 渲染出来要读得通 ──')

const rendered = renderMood(self ? initialState(at(12)) : initialState(at(12)), at(12))
check('渲染里有档位', rendered.includes('档位'), true)

console.log()
console.log('  ── ⑦ 同一个错，不该因为"几点"而反应不同（v2.2.0）──')

// 被 tools/mood-trace.mjs 逮住的：黄昏的时段基线是 +1，正好把失败那 -1 抵掉，
// 于是同一个错，白天会安静、黄昏不会。**这件事不该看现在几点。**
const noonSelf = run([turn(), toolFail('命令失败'), say('我上一条说错了')], 12)
const duskSelf = run([turn(), toolFail('命令失败'), say('我上一条说错了')], 20)
check('白天自己出错 → 收敛', noonSelf.register, 'soft')
check('黄昏自己出错 → 也收敛（时段不该把它吃掉）', duskSelf.register, 'soft')
check('两个时段给出同一个档位', noonSelf.register, duskSelf.register)

console.log()
console.log('  ── ⑧ 余味：错过去了，但它还在（v2.2.0）──')

const aftertaste = run([turn(), toolFail('命令失败'), say('我上一条说错了'), toolOk()], 12)
check('认了错、活也干顺了 → 还安静着', aftertaste.register, 'soft')
check('而且理由说得出来', aftertaste.reasons.some((r) => /还记着/.test(r)), true)

const praisedErr = run([turn(), user('谢谢你'), user('太棒了'), toolFail('命令失败'), say('我上一条说错了')], 12)
check('被夸 + 自己出错 → 不许写"密集"', praisedErr.register !== 'bright', true)

const worldOnly = run([turn(), toolFail('ENOENT'), toolOk()], 12)
check('环境挡的没有余味 → 爬起来就照常', worldOnly.register, 'normal')

console.log()
console.log(`  通过 ${pass} / ${pass + fail}`)
if (fail) {
  console.log()
  console.log('  失败的那些，就是"她分不清我错了和路堵了"这件事本身。')
}
console.log()
process.exit(fail ? 1 : 0)
