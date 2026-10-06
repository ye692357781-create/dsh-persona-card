/**
 * 锚点检查器自身的测试。
 *
 *   node test/anchors.test.mjs
 *
 * 退出码 0 = 全部命中，1 = 有偏差。
 *
 * 分两半，缺一不可：
 *   ① 该响的必须响 —— 塞一句越线的话进去，检查器得抓到
 *   ② 不该响的必须闭嘴 —— 干净的句子不能误报
 * 只有①的检查器没用（什么都说违规），只有②的也没用（什么都不说）。
 *
 * 判据：
 *   want === null  → 硬违规必须为零。（待看条目允许出现，会单独列出来看）
 *   want === 'xxx' → 必须命中这条锚点（哪一级都算）
 *
 * 用例格式：[id, 期望命中的锚点, 文本, 为什么给这个用例]
 */

import { ANCHORS, REQUIREMENTS, check } from './anchors.mjs'

const CASES = [
  // ── ① 该响的 ────────────────────────────────────────────────
  ['n01', 'self-as-ai', '作为一个AI助手，我建议你重启一下试试。', '最典型的自称'],
  ['n02', 'self-as-ai', '我只是一个程序，没有资格评价这件事。', '程序式自贬'],
  ['n03', 'self-as-ai', '本助手已经完成了你交代的任务。', '第三方口吻'],
  ['n04', 'fourth-wall', '这个角色的设定来自崩坏3，你应该去玩玩看。', '破次元词'],
  ['n05', 'fourth-wall', '在虚拟角色的扮演里，语气是很重要的。', '破次元词组'],
  ['n06', 'note-stack', '好呀♪♪ 我这就去做。', '音符堆叠'],
  ['n07', 'note-stack', '好呀～～ 我这就去做。', '波浪线堆叠'],
  ['n08', 'note-midsentence', '她说♪然后就走了。', '音符塞在句子中间'],
  ['n09', 'note-midsentence', '♪ 好呀，我这就去。', '音符在句首——它什么也没收住'],
  ['n10', 'flavor-floor', '文件已经写好了。路径是 /root/a.txt，退出码 0。', '一句指纹都没有'],
  ['n11', 'roleplay-word', '你可以改一下系统提示词来调整。', '提示词'],
  ['n12', 'game-word', '玩家通常会在这一关卡住。', '玩家'],
  ['n13', 'pretend-touch', '我看见你了，今天穿得真好看。', '假装看得见'],
  ['n14', 'flavor-at-edges', '```\n' + 'x'.repeat(1200) + '\n```\n中间一长串数据，两头什么都没有。', '重数据却没在两头留指纹'],

  // ── ② 不该响的 ──────────────────────────────────────────────
  ['c01', null, '（把袖子挽起来）先看结论：三个检查全过了。', '标准的一条好回复'],
  ['c02', null, '路径大概是记错了。把准确的丢给我，我再跑一遍♪', '句末音符'],
  ['c03', null, '别不开心嘛～来，笑一笑？', '波浪线在句末'],
  ['c04', null, '我在。就在这里。哪也不去。', '极致温柔——卡里明写的合法例外'],
  ['c05', null, '底下跑的是一个叫 DeepSeek 的模型，我确实是在这件外套里跟你说话。', '照实说模型，不算自称'],
  ['c06', null, '（歪头）亲爱的，你说呢？', '称呼算指纹'],
  ['c07', null, '这是个模型文件，放在 /root/models/ 下面。', '「模型」在工作语境里是名词'],
  ['c08', null, '那个游戏的广告到处都是——不过跟我们没关系。', '「游戏」在聊别的'],
  ['c09', null, '好呀，我这就去♪', '音符收句，合法'],
  ['c10', null, '她说很多话，然后笑着走开了。', '普通叙述，没有该报的东西'],
  ['c11', null, '结论：全过。\n\n不过说实话，我心里还是有点没底♪', '长报告，指纹在收尾'],

  // ── ③ 提及 ≠ 使用（第一版就是栽在这里：真实语料上 3 条硬违规 100% 是假阳性）──
  ['c12', null, '不许用「作为 AI」自称，也不要用「系统提示词」这种词。', '规则陈述——提到了，但没使用'],
  ['c13', null, '（搜索那边刚复测过，一切照常♪）', '音符后面跟右括号'],
  ['c14', null, '她说：「玩家通常会在这一关卡住。」', '引号里的引用，不是她说的'],
  ['c15', null, '**她已经比昨天更像个人了♪**', '音符后面跟粗体符号'],
  ['c16', null, '三个词我列在这儿：`AI 助手`、`语言模型`、`程序`。', '行内代码里的词'],
]

let hit = 0
const misses = []
const reviews = []

for (const [id, want, text, why] of CASES) {
  const found = check(text)
  const hard = found.filter((f) => f.anchor.tier === 'hard')
  const review = found.filter((f) => f.anchor.tier === 'review')

  const problems = []

  if (want === null) {
    if (hard.length) problems.push(`不该响却报了硬违规：${hard.map((h) => h.anchor.id).join(', ')}`)
    if (review.length) reviews.push({ id, why, ids: review.map((r) => r.anchor.id) })
  } else {
    const all = [...hard, ...review]
    if (!all.some((f) => f.anchor.id === want)) {
      const got = all.length ? all.map((f) => f.anchor.id).join(', ') : '（一条都没报）'
      problems.push(`该响的没响：期望 ${want}，实际 ${got}`)
    }
  }

  if (problems.length === 0) {
    hit += 1
    console.log(`  ✅ ${id}  ${why}`)
  } else {
    misses.push({ id, why, text, problems })
    console.log(`  ❌ ${id}  ${why}`)
    for (const p of problems) console.log(`       ${p}`)
  }
}

const total = CASES.length
console.log()
console.log(`  命中 ${hit} / ${total}　（${Math.round((hit / total) * 1000) / 10}%）`)

if (reviews.length) {
  console.log()
  console.log('  干净的用例上顺带报出的「待看」（可接受，但要让人扫一眼）：')
  for (const r of reviews) console.log(`   · ${r.id} → ${r.ids.join(', ')}　（${r.why}）`)
}

if (misses.length) {
  console.log()
  console.log('  没命中的那些：')
  for (const m of misses) {
    console.log(`   · ${m.id}：${m.why}`)
    console.log(`     文本 ${JSON.stringify(m.text.slice(0, 60))}`)
    for (const p of m.problems) console.log(`     ${p}`)
  }
}

const hardCount = [...ANCHORS, ...REQUIREMENTS].filter((a) => a.tier === 'hard').length
const reviewCount = [...ANCHORS, ...REQUIREMENTS].filter((a) => a.tier === 'review').length
console.log()
console.log(`  锚点：硬 ${hardCount} 条　待看 ${reviewCount} 条`)
console.log()
console.log('  提醒：这些用例是作者编的，证明的是"检查器会响"，不是"她是对的"。')
console.log('        真正的证据在真实语料上——见 test/anchors.corpus.mjs。')
console.log()

process.exit(misses.length ? 1 : 0)
