/**
 * 在**真实对话**上跑锚点检查。
 *
 *   # 会话日志是 zstd 多帧拼的，先用 tools/unzstd.mjs 解出来
 *   node tools/unzstd.mjs ~/.dsh/sessions/xxx/session.v4.jsonl.zstd > /tmp/session.jsonl
 *   node test/anchors.corpus.mjs /tmp/session.jsonl
 *
 * 这个文件和 anchors.test.mjs 的分工：
 *   anchors.test.mjs   —— 证明检查器会响（用例是作者编的）
 *   anchors.corpus.mjs —— 看她在真实的几百轮里有没有越线（文本是她真说过的）
 *
 * 判的单位是「一轮」而不是「一句」：卡里写的是"每一轮回复至少要留一处指纹"，
 * 而流式输出会把一条回复切成很多条 message。按句判会满屏假阳性。
 */

import { readFileSync } from 'node:fs'
import { check } from './anchors.mjs'

const file = process.argv[2]
if (!file) {
  console.error('用法：node test/anchors.corpus.mjs <已解压的 session.jsonl>')
  process.exit(2)
}

/* ── 读日志，按轮把 assistant 的文本拼起来 ───────────────────── */

const turns = []
let cur = null

for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue
  let e
  try { e = JSON.parse(line) } catch { continue }

  if (e.type === 'turn/start') {
    cur = { turn: e.data?.turn ?? turns.length + 1, parts: [] }
    turns.push(cur)
    continue
  }
  if (e.type === 'assistant/message' && cur) {
    for (const c of e.data?.message?.content || []) {
      if (c?.type === 'text' && c.text) cur.parts.push(c.text)
    }
  }
}

const replies = turns
  .map((t) => ({ turn: t.turn, text: t.parts.join('\n').trim() }))
  .filter((t) => t.text.length > 0)

/* ── 跑检查 ──────────────────────────────────────────────────── */

const byAnchor = new Map()
const clean = []
let withHard = 0

for (const r of replies) {
  const found = check(r.text)
  const hard = found.filter((f) => f.anchor.tier === 'hard')
  const review = found.filter((f) => f.anchor.tier === 'review')

  if (hard.length) withHard += 1
  if (!found.length) clean.push(r)

  for (const f of found) {
    if (!byAnchor.has(f.anchor.id)) byAnchor.set(f.anchor.id, { anchor: f.anchor, rows: [] })
    byAnchor.get(f.anchor.id).rows.push({ turn: r.turn, hits: f.hits, text: r.text })
  }
}

/* ── 出报告 ──────────────────────────────────────────────────── */

const totalChars = replies.reduce((n, r) => n + r.text.length, 0)

console.log()
console.log('  ═══ 真实语料上的锚点检查 ═══')
console.log()
console.log(`  语料：${file}`)
console.log(`  轮数：${replies.length} 轮　总字数：${totalChars.toLocaleString()}`)
console.log(`  完全干净：${clean.length} 轮　（${Math.round((clean.length / replies.length) * 100)}%）`)
console.log(`  至少一条硬违规：${withHard} 轮`)
console.log()

if (!byAnchor.size) {
  console.log('  一条都没报。')
} else {
  console.log('  按锚点分组：')
  const sorted = [...byAnchor.values()].sort((a, b) => b.rows.length - a.rows.length)
  for (const { anchor, rows } of sorted) {
    const tag = anchor.tier === 'hard' ? '硬' : '待看'
    console.log(`   · [${tag}] ${anchor.id}　命中 ${rows.length} 轮`)
    console.log(`         ${anchor.why.slice(0, 78)}`)
  }
}

console.log()
console.log('  ── 逐条明细（前 20 条）──')
console.log()
let shown = 0
for (const { anchor, rows } of [...byAnchor.values()].sort((a, b) => b.rows.length - a.rows.length)) {
  for (const row of rows) {
    if (shown++ >= 20) break
    const around = []
    for (const h of row.hits.slice(0, 2)) {
      const i = typeof h.index === 'number' ? h.index : 0
      around.push(row.text.slice(Math.max(0, i - 26), i + 26).replace(/\n/g, '⏎'))
    }
    console.log(`   · 第 ${row.turn} 轮　[${anchor.id}]　命中「${row.hits[0]?.hit ?? '?'}」`)
    for (const a of around) console.log(`       …${a}…`)
  }
  if (shown >= 20) break
}
if (shown >= 20) console.log(`   （还有更多，未列完）`)

console.log()
console.log('  提醒：命中 ≠ 违规。')
console.log('        硬级的抽查几条就能定性；待看级每一条都得人看一眼再算数。')
console.log('        这个脚本只负责把可疑的地方**指出来**，不负责判它。')
console.log()
