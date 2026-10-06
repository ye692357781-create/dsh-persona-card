/**
 * 解开 DSH 的会话日志。
 *
 *   node tools/unzstd.mjs ~/.dsh/sessions/<工作区>/<会话>/session.v4.jsonl.zstd > /tmp/session.jsonl
 *
 * 为什么要单独写一个：
 *   会话日志是**一串独立 zstd 帧首尾相接**写出来的（每 flush 一次追加一帧），
 *   不是单个流。标准解压器（zstd CLI、node 的流式解码器）只吐第一帧就停，
 *   拿到的是"日志只有一行"这种假象 —— 我在这上面栽过一次。
 *
 *   正确的做法：扫出每一帧的魔数起点，一帧一帧解，再拼起来。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

export function unzstdFrames(buf) {
  const offsets = []
  let i = 0
  while (true) {
    const k = buf.indexOf(ZSTD_MAGIC, i)
    if (k < 0) break
    offsets.push(k)
    i = k + ZSTD_MAGIC.length
  }

  let out = ''
  let ok = 0
  let bad = 0
  for (const o of offsets) {
    try {
      out += zstdDecompressSync(buf.subarray(o)).toString('utf8')
      ok += 1
    } catch {
      bad += 1
    }
  }
  return { text: out, frames: offsets.length, ok, bad }
}

const file = process.argv[2]
if (!file) {
  console.error('用法：node tools/unzstd.mjs <session.v4.jsonl.zstd> [--out 文件]')
  process.exit(2)
}

const { text, frames, ok, bad } = unzstdFrames(readFileSync(file))

const outIdx = process.argv.indexOf('--out')
if (outIdx > 0 && process.argv[outIdx + 1]) {
  writeFileSync(process.argv[outIdx + 1], text)
  console.error(`  帧 ${frames}（成功 ${ok} / 失败 ${bad}）→ ${process.argv[outIdx + 1]}`)
} else {
  process.stderr.write(`  帧 ${frames}（成功 ${ok} / 失败 ${bad}）\n`)
  process.stdout.write(text)
}
