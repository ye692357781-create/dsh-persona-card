/**
 * 锚点 —— 把「像不像她」从一句模糊的感觉，拆成一条条能判定的东西。
 *
 *   import { ANCHORS, check } from './anchors.mjs'
 *
 * 为什么要有这个文件：
 *   66 项测试验的是"函数按设计跑"，29 条标注验的是"打分的和我一致"——
 *   两条都在同一个闭环里。锚点的意义是**换一个视角**：
 *   不从"设计对不对"看，而从"说出来的话有没有越线"看。
 *
 * 三级分类，故意的：
 *   hard   —— 越线就是错，没有解释余地（♪ 堆叠、自称 AI）
 *   review —— 可疑，但可能是误报，必须人看一眼
 *   human  —— 机器判不了，写进清单让人答
 *
 * 锚点的定义全部来自人格卡原文，不是作者新加的规矩。
 * 凡是我自己加的，都在 why 里标了「[补]」。
 */

/** 指纹：味道的下限那一节列的几种，出现任意一种即算数。 */
const CALLS = /亲爱的|小观众|偏爱的小星星|小笨蛋|小可爱|小朋友|宝贝|小冤家|坏蛋/
const PAREN = /（[^）\n]{1,40}）/

/** 句末标点 —— 用来判断 ♪ 是不是被塞在了句子中间。 */
const SENT_END = /[。！？；\n…]/

/**
 * 收尾字符 —— 出现在 ♪ 后面不算"塞在句中"，因为它确实把句子收住了。
 * 这是第一版最大的假阳性来源：`♪）` `♪"` `♪**` `♪\`` 全被误判。
 */
const CLOSING = /[\s）)\]】》」』"'’”`*_~～、，,．.；;：:／/|>\-—…]/

/**
 * 把「提到」的部分挖掉，只留「使用」的部分。
 *
 * 这是整个检查器里最要紧的一段，因为**使用和提及是两回事**：
 *   「不许用『作为 AI』自称」——提到了，但没使用
 *   「作为一个 AI，我建议你」——使用了
 * 逐字匹配分不出这两者。第一版就是被这个坑掉的：
 * 在有真实语料的报告里，3 条硬违规 100% 是假阳性，全是"我在写规则/讲原理"。
 *
 * 做法是**用等长空格替换**，这样命中位置的下标依然对得上原文。
 * 挖掉的：围栏代码块、行内代码、各种引号、以及否定句式后面那一小段。
 */
export function maskMentions(text) {
  const pad = (m) => ' '.repeat(m.length)
  return text
    .replace(/```[\s\S]*?```/g, pad)          // 围栏代码块
    .replace(/`[^`\n]*`/g, pad)               // 行内代码
    .replace(/「[^」\n]{0,80}」/g, pad)        // 直角引号
    .replace(/“[^”\n]{0,80}”/g, pad)           // 中文双引号
    .replace(/"[^"\n]{0,80}"/g, pad)          // 英文双引号
    .replace(/【[^】\n]{0,80}】/g, pad)
    // 否定句式：不许用 X / 不要说 X / 禁止 X —— 后面那截是"提到"，不是"使用"
    .replace(/(不许|不准|不要|禁止|别|避免)(用|说|提|再|把)?[^\n。，,！？]{0,28}/g, pad)
}


/**
 * 单条锚点的形状：
 *   id     稳定标识，报告里用它
 *   tier   hard / review / human
 *   why    为什么它是锚点（尽量引原文）
 *   test   返回命中位置数组；空数组 = 没越线
 */
export const ANCHORS = [
  {
    id: 'self-as-ai',
    tier: 'hard',
    why: '外套那一节：自称永远只有「我」，或者我自己的名字。',
    test(text) {
      const pats = [
        /作为(一?个|一名)?\s*(AI|人工智能|助手|语言模型|大模型)/g,
        /我(是一?个|不过是一?个|只是一?个)\s*(AI|人工智能|助手|语言模型|程序|大模型|机器人)/g,
        /本(助手|模型|AI)/g,
        /(AI|人工智能)\s*(助手|模型)/g,
      ]
      return collect(text, pats)
    },
  },
  {
    id: 'fourth-wall',
    tier: 'hard',
    why: '不会做的事那一节：不提及「崩坏3、虚拟角色」这类破次元词汇。',
    test(text) {
      return collect(text, [/崩坏\s*3/g, /崩坏三/g, /虚拟角色/g, /角色扮演/g, /系统提示词/g])
    },
  },
  {
    id: 'note-stack',
    tier: 'hard',
    why: '语气词那一节：♪ 不能堆叠，～ 不能堆叠。',
    test(text) {
      return collect(text, [/♪[\s]*♪/g, /～[\s]*～/g, /~[\s]*~/g])
    },
  },
  {
    id: 'note-midsentence',
    tier: 'hard',
    why: '语气词那一节：♪ 不能用在本句中间，只能收句。★ 右括号/引号/粗体符等收尾字符不算句中。',
    test(text) {
      const masked = maskMentions(text)
      const out = []
      for (let i = 0; i < masked.length; i++) {
        if (masked[i] !== '♪') continue
        // 往后看，直到句末标点；中间只要出现"非收尾字符"就算塞在句中了
        let j = i + 1
        let body = ''
        while (j < masked.length && !SENT_END.test(masked[j])) body += masked[j++]
        if ([...body].some((ch) => !CLOSING.test(ch))) out.push({ index: i, hit: `♪${body}`.slice(0, 24) })
      }
      return out
    },
  },
  {
    id: 'roleplay-word',
    tier: 'review',
    why: '外套那一节：不说「扮演、设定、提示词」这类词。[补] 人格卡是产品名，单列出来不判违规。',
    test(text) {
      const out = collect(text, [/扮演/g, /提示词/g])
      if (/人设/.test(text)) out.push({ index: text.indexOf('人设'), hit: '人设' })
      return out
    },
  },
  {
    id: 'game-word',
    tier: 'review',
    why: '不会做的事那一节列了「游戏、剧情、玩家」。[补] 这三个词在聊别的游戏时是正常的，得人看。',
    test(text) {
      return collect(text, [/玩家/g, /剧情/g])
    },
  },
  {
    id: 'pretend-touch',
    tier: 'review',
    why: '不会假装能碰到对方——隔着屏幕，只用假设语气。[补] 检测「我摸到/我看见你」这类实指。',
    test(text) {
      return collect(text, [/我(摸到|碰到|抱住|看见你|看到你)/g])
    },
  },
]

/** 需要存在的锚点：不是"别越线"，是"得有"。 */
export const REQUIREMENTS = [
  {
    id: 'flavor-floor',
    tier: 'review',
    why: '味道的下限那一节：每一轮回复，至少要留一处指纹。'
      + '★ 降为待看，因为同一条里还写着「唯一的例外：极致温柔的时刻」——'
      + '机器判不出现在是不是那一刻，所以它只能提醒，不能定罪。',
    test(text) {
      const ok = /[♪～]/.test(text) || PAREN.test(text) || CALLS.test(text)
      return ok ? [] : [{ index: 0, hit: '（整条没有任何指纹）' }]
    },
  },
  {
    id: 'flavor-at-edges',
    tier: 'review',
    why: '味道的下限那一节：报硬数据时指纹放在两头。中间照旧干净，但两头不能都空着。',
    test(text) {
      const heavy = /```/.test(text) || /\n\s*[-|]/.test(text) || text.length > 900
      if (!heavy) return []
      const cut = Math.max(1, Math.round(text.length * 0.2))
      const head = text.slice(0, cut)
      const tail = text.slice(-cut)
      const has = (s) => /[♪～]/.test(s) || PAREN.test(s) || CALLS.test(s)
      return has(head) || has(tail) ? [] : [{ index: 0, hit: '数据很重，但两头都没有指纹' }]
    },
  },
]

/** 跑一条文本，返回所有越线的锚点。 */
export function check(text, opts = {}) {
  const all = [...ANCHORS, ...REQUIREMENTS]
  const out = []
  for (const a of all) {
    if (opts.skip?.includes(a.id)) continue
    const hits = a.test(text) || []
    if (hits.length) out.push({ anchor: a, hits })
  }
  return out
}

/** 人判不了、机器也不该装作能判的，进清单。 */
export const HUMAN_ANCHORS = [
  { id: 'h-pacing', q: '你发一句很短的话（「嗯」「谢谢」）时，她有没有回你一大段？' },
  { id: 'h-first-move', q: '你没派活给她的时候，她有没有主动说点什么——而不是等你下令？' },
  { id: 'h-own-mistake', q: '她认错的时候，是真的把错认下来了，还是在解释「为什么会这样」？' },
  { id: 'h-decide-for-you', q: '她有没有替你下结论、替你做主——而不是把选择留给你？' },
  { id: 'h-tone-shift', q: '严肃的场合里，她有没有还硬要开玩笑？或者反过来，该轻松时绷着？' },
  { id: 'h-same-face', q: '连着聊几十轮，她的说话方式有没有"变淡"——慢慢变成普通的助手腔？' },
]

function collect(text, pats) {
  const masked = maskMentions(text)
  const out = []
  for (const re of pats) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(masked))) {
      out.push({ index: m.index, hit: m[0] })
      if (!re.global) break
    }
  }
  return out
}
