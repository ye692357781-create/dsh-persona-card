/**
 * 时区回归测试。
 *
 *   node test/timezone.test.mjs
 *
 * 复现的是一个真事：2026-10-06 早上，用户那边的钟是 11 点，
 * 插件却判成「深夜」——因为容器跑在 UTC，用户在 UTC+8。
 * `new Date().getHours()` 读的是**跑它的那台机器**的本地时间。
 *
 * 当时代码一个字没改，只把容器的 /etc/localtime 调对了。
 * 所以**别人装了还是错的**——这个文件就是为那件事写的。
 *
 * 判据：给同一个 UTC 时刻，喂不同时区，必须判出不同的时段。
 * 不传时区时必须沿用系统时区（也就是改动前的行为，不能破坏）。
 */

import { initialState, evaluate, renderMood, timeBaseline } from '../lib/mood.js'

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

/** 固定的 UTC 时刻，不随测试机器的时区漂移。 */
const T = {
  utc09: Date.UTC(2026, 9, 6, 9, 0, 0),   // 09:00 UTC
  utc23: Date.UTC(2026, 9, 6, 23, 0, 0),  // 23:00 UTC
}

const labelAt = (now, tz) => timeBaseline(now, tz).label

console.log()
console.log('  ── 同一时刻，不同时区，必须判出不同时段 ──')

// 09:00 UTC 这一刻：
//   UTC       → 09 点 → 白天
//   上海(+8)  → 17 点 → 黄昏
//   纽约(-4)  → 05 点 → 清晨
check('09:00Z @ UTC', labelAt(T.utc09, 'UTC'), '白天')
check('09:00Z @ Asia/Shanghai', labelAt(T.utc09, 'Asia/Shanghai'), '黄昏')
check('09:00Z @ America/New_York', labelAt(T.utc09, 'America/New_York'), '清晨')

// 23:00 UTC：上海已经是第二天早上 7 点
check('23:00Z @ UTC', labelAt(T.utc23, 'UTC'), '深夜')
check('23:00Z @ Asia/Shanghai', labelAt(T.utc23, 'Asia/Shanghai'), '清晨')

console.log()
console.log('  ── 不传时区：行为必须和以前一模一样 ──')

const sysLabel = (() => {
  const h = new Date(T.utc09).getHours()
  if (h >= 5 && h < 9) return '清晨'
  if (h >= 9 && h < 17) return '白天'
  if (h >= 17 && h < 21) return '黄昏'
  return '深夜'
})()
check('不传时区 → 沿用系统时区', labelAt(T.utc09), sysLabel)
check('传 undefined → 同不传', labelAt(T.utc09, undefined), sysLabel)
check('传空字符串 → 同不传', labelAt(T.utc09, ''), sysLabel)

console.log()
console.log('  ── 上游也要能传下去（evaluate / renderMood）──')

check(
  'evaluate 按时区判',
  evaluate(initialState(T.utc09), T.utc09, { timeZone: 'Asia/Shanghai' }).base.label,
  '黄昏',
)
check(
  'renderMood 里出现「黄昏」',
  renderMood(initialState(T.utc09), T.utc09, { timeZone: 'Asia/Shanghai' }).includes('黄昏'),
  true,
)
check(
  'renderMood 不传时区时仍是系统时区',
  renderMood(initialState(T.utc09), T.utc09).includes(sysLabel),
  true,
)

console.log()
console.log('  ── 钟点：问"现在几点"必须答得出、且答得对 ──')

// v1.9.0：心情那一节要带上具体的钟点。
// 光有"黄昏"是不够的——被问"现在几点"时，那答不出一个数。
const zh = renderMood(initialState(T.utc09), T.utc09, { timeZone: 'Asia/Shanghai' })
check('上海：出现钟点 17:00', zh.includes('17:00'), true)
check('上海：出现日期 10月6日', zh.includes('10月6日'), true)
check('上海：出现星期 周二', zh.includes('周二'), true)

const utc = renderMood(initialState(T.utc09), T.utc09, { timeZone: 'UTC' })
check('UTC：出现钟点 09:00', utc.includes('09:00'), true)
check('UTC 与上海判出的钟点不同', zh.includes('17:00') && utc.includes('09:00'), true)

// 跨日：23:00 UTC = 上海第二天 07:00
const dc = renderMood(initialState(T.utc23), T.utc23, { timeZone: 'Asia/Shanghai' })
check('跨日：上海是 10月7日 07:00', dc.includes('10月7日') && dc.includes('07:00'), true)
check('跨日：UTC 仍是 10月6日 23:00', renderMood(initialState(T.utc23), T.utc23, { timeZone: 'UTC' }).includes('10月6日'), true)

console.log()
console.log(`  通过 ${pass} / ${pass + fail}`)
if (fail) {
  console.log()
  console.log('  失败的那些，就是"别人的时间会错"这件事本身。')
}
console.log()
process.exit(fail ? 1 : 0)
