/**
 * dsh-persona-card · 心情模型
 *
 * 纯函数模块：不碰 ctx、不读文件、不发请求。
 * 输入是"会话里发生过什么"，输出是"她此刻的心情 + 该踩哪一档"。
 *
 * ── 为什么要拆出来 ───────────────────────────────────────────────────
 * 心情这种东西最容易写成"看起来在工作、其实没人验过"的一团泥。
 * 拆成纯函数之后，每条信号都能单独喂进去看结果。
 * 而且——**验它不需要模型 API**：测的是折算逻辑，不是模型表现。
 *
 * ── 状态活在哪儿 ─────────────────────────────────────────────────────
 * 只活在内存里，按会话 id 分桶，进程重启即归零。
 * 刻意**不落盘**：跨会话的"她记得上次"要写存储，
 * 而架构正道（sessionProjections）需要 zod，从插件里只能靠绝对路径 import —— 太脆。
 *
 * ── 核心设计 ─────────────────────────────────────────────────────────
 * 心情不是一段装饰文本，它是**决定踩哪一档的东西**：
 *   密集(bright) / 照常(normal) / 收敛(soft) / 零装饰(hush)
 *
 * ── v2 改了什么（信号系统重做）───────────────────────────────────────
 * 起因是实测复现出的三条硬伤：
 *   1. **否定被读反**：「我不喜欢这个方案」判成"被夸"。
 *      判据只做子串包含，完全不看上下文。
 *   2. **行为信号一个都没用**：一个字的「嗯」、六个问号、三百字倾诉、
 *      反复追问同一件事 —— 全部零反应。词表永远不全，但行为是通用的。
 *   3. **参数糙**：tone 无上下限、衰减一刀切、成功计数太廉价。
 */

/** 状态版本：字段语义变了就 +1。v2 新增了行为信号窗口。 */
// v4（2.6.0）：state 多了 prevShape。
// 状态只在内存里，重启就归零，所以这号不承担迁移——
// 它的作用是**让"形状变过"这件事留个记号**，下次有人读代码时知道这里改过什么。
export const MOOD_STATE_VERSION = 4

/** 心情档位。 */
export const REGISTERS = ['bright', 'normal', 'soft', 'hush']

/** 行为信号的滑动窗口长度。 */
const WINDOW = 8

/** 新会话的初始状态。 */
export function initialState(now = Date.now()) {
  return {
    v: MOOD_STATE_VERSION,
    startedAt: now,
    turns: 0,

    // ── 事件级计数（带衰减）──
    failStreak: 0,     // 连续失败次数
    failScore: 0,      // 近期失败
    winScore: 0,       // 近期成功
    labour: 0,         // 近期干活量
    stumbles: 0,       // 近期被中断/出错
    warmth: 0,         // 近期被夸/被谢
    tender: 0,         // 对方在往下沉的深度（0 无 / 1 轻 / 2 重）
    recovered: 0,      // 失败之后又爬起来的次数（雪中送炭）
    awayCount: 0,      // 近期「对方隔了很久才回来」的次数（与 stumbles 分开——语义不同）
    afterFail: false,  // 上一次工具结果是失败、且还没成功过

    // ── 归因（v3 新增）──
    blame: null,       // 最近一次失败的归因：'self' | 'world' | null
    blameSelf: 0,      // 近期「自己认下的错」——带衰减，是唤醒度的来源之一
    blocked: 0,        // 近期「被环境挡住的次数」——语义和"我搞砸了"完全不同

    // ── 行为信号的滑动窗口 ──
    lens: [],          // 最近几条用户消息的长度
    times: [],         // 最近几条用户消息的时间戳
    texts: [],         // 最近几条用户消息的原文（用于重复检测）

    lastKind: '',      // 最近一次值得记住的事，写进心情里

    // ── 上一轮的形状（v2.5.2 新增）──
    // 只报"现在什么状态"是不够的——那样两轮放在一起只是两张快照。
    // 人在意的从来是**变化**：「刚才还绷着，这一轮松了」。
    // 在 turn/start 的那一刻拍下来：那一刻的 state 正好是上一轮结束时的样子。
    prevShape: null,
  }
}

/** 从消息里抠出纯文本（消息体可能是 content block 数组）。 */
function textOf(message) {
  if (!message) return ''
  if (typeof message === 'string') return message
  const blocks = Array.isArray(message.content) ? message.content : []
  const parts = []
  for (const b of blocks) {
    if (b && b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.join('\n')
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const median = (xs) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
const push = (arr, v) => [...arr, v].slice(-WINDOW)

/** 字符集的 Jaccard 相似度——够用，且不需要分词。 */
function similarity(a, b) {
  const A = new Set(a)
  const B = new Set(b)
  let inter = 0
  for (const c of A) if (B.has(c)) inter += 1
  return inter / (A.size + B.size - inter)
}

// ── 关键词表 ────────────────────────────────────────────────────────
// 刻意短。长表容易误判，而且这是启发式，不是理解。
const PRAISE = ['谢谢', '谢啦', '厉害', '好棒', '太棒', '干得好', '做得好', '喜欢', '可爱', '爱你', '太好了', '完美', '靠谱', '辛苦了']
const DISTRESS_LIGHT = ['有点累', '好累', '不开心', '难受', '撑不住', '没动力', '焦虑', '好难', '好烦', '很烦', '烦死', '烦躁', '心烦']
/**
 * 重度低落词——**必须带"像在说自己"的语境才计数**。
 *
 * 教训：「程序崩溃了」和「我要崩溃了」都含"崩溃"。
 * 在一个写代码的场景里，前者出现的频率远高于后者——
 * 一个把报错当情绪的系统，比没有系统更糟。
 * 所以这些词要求前后出现第一人称或程度词。
 */
const DISTRESS_HEAVY = ['崩溃', '想哭', '绝望', '没意义', '活着没', '不想活', '好痛苦', '受不了了', '孤独', '没人']
/** 歧义词——单独出现太容易误伤（「把压力测试跑一下」），同样要求语境。 */
const DISTRESS_AMBIGUOUS = ['压力', '疲惫', '累了']

const SCOLD = ['不对', '错了', '不是这样', '重来', '搞错', '又错', '不好', '不行', '有问题', '重做', '白做']

/** 否定词。命中正/负面词后往回看，发现它们就翻转。 */
const NEGATIONS = ['不', '没', '别', '无', '非', '未', '毫无', '并不', '绝不', '一点也']

/**
 * 「不算数」的例外——那些长得像信号词、其实是别的意思的固定搭配。
 */
const EXCEPTIONS = ['不好意思', '不错', '不客气', '不谢', '没关系', '不要紧', '没事', '麻烦你', '麻烦了']

/** 判定"这句话像在说自己"的标记，分前后两类。 */
// 词**之前**：第一人称、感受动词、程度词——范围可以宽，因为前面通常就是主语
const SELF_BEFORE = /我|自己|感觉|觉得|好|太|快|要|真|特别|超级|有点/
// 词**之后**：只认纯程度词。宽度只有两个字，且刻意不含"我/真/特别"——
// 否则「程序崩溃了，真烦」「崩溃了，我来修」会因为后面那几个字误判。
const SELF_AFTER = /好|太|死|爆|极/
const AFTER_WINDOW = 2

const NEG_WINDOW = 5

/**
 * ── 归因（appraisal）：这是"我错了"还是"路堵了" ──
 *
 * v3 新增。依据是情境评估理论：**情绪不由"发生了什么"决定，
 * 由"你怎么看这件事"决定。** 同一个失败，可以是打击，也可以是挑战。
 * （arXiv:2309.05076 那篇用评估式架构做情绪模拟，在一组体验指标上胜过标准架构。）
 *
 * 为什么非加不可：2026-10-06 那天有两组现成的对照——
 * 我误诊了两次（**我的锅**）、命令被设备策略拦了（**不是我的锅**）——
 * 而旧模型给两者记的是同一笔「连着 1 次没干成，-1」。
 * **可人对这两件事的反应完全不同：一个该安静下来反省，一个该耸耸肩换个法子。**
 *
 * 归因有两个来源，但**只有一个需要证明**：
 *   环境挡的 → **默认**。路上有块石头是常态，不需要证据，也不该往心里去。
 *   自己错的 → **要说出口才算**。证据只在**我自己说的话里**（"我读漏了"）——
 *              工具结果永远不会替人认错。
 *
 * ★ 第一版走的是"扫工具结果里的拦截标记"，测试全绿、真实数据上一次没触发。
 *   经过写在 tool/result 那一段里，留着给后来的自己看。
 */
const SELF_ADMIT = [
  '我说错', '我读漏', '我搞错', '我弄错', '我写错', '我改错', '我误诊',
  '我的错', '是我错', '我判断错', '我记错', '我漏了', '我看漏', '我读快',
  '我错了两', '我错了',
]

/**
 * 词表盖不全，所以再配一条正则。
 *
 * 被测试逼出来的：「**我上一条说错了**」是最自然的语序之一，
 * 可词表里写的是「我说错」——中间隔着"上一条"，匹不上。
 * 而"我"和"错了"之间本来就可以塞任何东西。
 *
 * 要求"我"出现在前面，所以「你说错了」不会误判；
 * 「我没错」也不中——那里面没有「错了」。
 */
const SELF_ADMIT_RE = /我[^。！？；\n]{0,12}?(说错|搞错|弄错|写错|改错|读漏|看漏|判断错|记错|误诊|漏了|错了|的错)/

/** 把例外搭配先抠掉，剩下的才是有效文本。 */
function maskExceptions(text) {
  let cleaned = text
  for (const ex of EXCEPTIONS) cleaned = cleaned.split(ex).join('　'.repeat(ex.length))
  return cleaned
}

/** 在 cleaned 里找 word 的所有出现位置，逐个判断是否被否定。 */
function occurrences(cleaned, word) {
  const out = []
  let from = 0
  for (;;) {
    const i = cleaned.indexOf(word, from)
    if (i < 0) break
    const before = cleaned.slice(Math.max(0, i - NEG_WINDOW), i)
    const negated = NEGATIONS.some((neg) => before.includes(neg))
    if (!negated) out.push(i)
    from = i + word.length
  }
  return out
}

/**
 * 带否定的命中计数。**这是 v2 修掉的主要 bug。**
 *
 * v1 只做 `text.includes(word)`，于是「我不喜欢这个方案」里的"喜欢"
 * 被当成了夸奖——一个会把批评读成赞美的系统，比没有系统更糟。
 */
function hits(text, words) {
  const cleaned = maskExceptions(text)
  let n = 0
  for (const w of words) n += occurrences(cleaned, w).length
  return n
}

/**
 * 要求"像在说自己"的命中。用于重度低落词和歧义词。
 *
 * 判据分前后两段：
 *   之前 6 个字 + 词本身 → 认第一人称和程度词（前面通常就是主语）
 *   之后 2 个字         → 只认纯程度词，且刻意不含"我/真/特别"
 *
 * 这条不对称是踩出来的：「最近压力好大」的"好"在词后，
 * 而「程序崩溃了，我来修」的"我"也在词后——只放宽后面会把后者算进来。
 */
function personalHits(text, words) {
  const cleaned = maskExceptions(text)
  let n = 0
  for (const w of words) {
    for (const i of occurrences(cleaned, w)) {
      const before = cleaned.slice(Math.max(0, i - 6), i + w.length)
      const after = cleaned.slice(i + w.length, i + w.length + AFTER_WINDOW)
      if (SELF_BEFORE.test(before) || SELF_AFTER.test(after)) n += 1
    }
  }
  return n
}

/** 标点里的情绪：连续问号、省略号。 */
function punctuationOf(text) {
  return {
    asks: (text.match(/[？?]{2,}/g) || []).length,
    trails: (text.match(/…+|\.{3,}/g) || []).length,
  }
}

/**
 * 折算一个会话事件。**纯函数**：不认识的事件原样返回同一个引用
 * （调用方可以据此判断"这一条不用管"，零成本）。
 *
 * @returns {object} 新状态，或原状态（事件被忽略时）
 */
export function foldEvent(state, event) {
  if (!state || !event) return state
  const type = event.type
  const data = event.data || {}

  switch (type) {
    case 'turn/start': {
      // 新一轮：旧情绪退潮，但不归零——她不是每轮失忆的人。
      // 衰减**刻意分化**：热情是当下的（快），挫败结痂慢（慢）。
      //
      // 拍快照必须在衰减**之前**：这一刻的 state 就是上一轮结束时的样子。
      const prevShape = shapeOf(state)
      return {
        ...state,
        prevShape,
        turns: state.turns + 1,
        failScore: state.failScore * 0.75,
        winScore: state.winScore * 0.6,
        labour: state.labour * 0.5,
        warmth: state.warmth * 0.4,
        stumbles: state.stumbles * 0.6,
        recovered: state.recovered * 0.6,
        awayCount: state.awayCount * 0.6,
        blameSelf: state.blameSelf * 0.7,
        blocked: state.blocked * 0.5,
        failStreak: 0,
        tender: Math.max(0, state.tender - 1),
      }
    }

    case 'user/message': {
      const text = textOf(data)
      if (!text) return state

      // ── 词语信号（带否定 + 语境）──
      const praise = hits(text, PRAISE)
      const light = hits(text, DISTRESS_LIGHT) + personalHits(text, DISTRESS_AMBIGUOUS)
      const heavy = personalHits(text, DISTRESS_HEAVY)
      const scold = hits(text, SCOLD)

      // ── 行为信号（v2 新增）──
      const len = text.length
      const prevLens = state.lens
      const avgLen = prevLens.length >= 3 ? mean(prevLens) : 0
      // 退潮：明显短于自己平时的说话长度。
      // 这里的 `avgLen >= 10` 是必要的——一个本来就只说三五个字的人，
      // 回一个「嗯」不算退潮。
      const terse = avgLen >= 10 && len <= avgLen * 0.4
      // 倾诉：明显长于平时，而且本身够长。
      // **不设平均长度下限**——"明显长于平时"由比值负责，"值不值得算"
      // 由下面 30 字的绝对门槛负责。多加一道 avgLen >= 5 是多余的，
      // 而且会让"平时话很短的人突然说一大段"这个最该被接住的场景漏掉。
      const outpouring = len >= Math.max(30, avgLen * 2.5)

      const { asks, trails } = punctuationOf(text)

      // 反复问同一件事（要有基线，且文本够长，避免「嗯」这种误撞）
      const repeated = text.length >= 4
        && state.texts.some((t) => t.length >= 4 && similarity(t, text) >= 0.8)

      // 隔了很久才回来
      const prevTimes = state.times
      const gap = prevTimes.length ? (event.time ?? 0) - prevTimes[prevTimes.length - 1] : 0
      const gaps = prevTimes.slice(1).map((t, i) => t - prevTimes[i])
      // 隔了很久才回来。
      // 门槛只要 2 个间隔（3 条前置消息）——原来要求 3 个太保守，
      // 会话刚开始就永远测不出"对方离开过"。
      // 误报由后面那条「绝对间隔 > 10 分钟」兜底：三两分钟的停顿不算什么。
      const typicalGap = gaps.length >= 2 ? median(gaps) : 0
      const away = typicalGap > 0 && gap > typicalGap * 4 && gap > 10 * 60 * 1000

      // ── 落进状态 ──
      let tended = state.tender
      let lastKind = state.lastKind
      if (heavy > 0 || light > 0) {
        tended = heavy > 0 ? 2 : Math.max(state.tender, 1)
        lastKind = '对方在往下沉'
      } else if (repeated) {
        lastKind = '同一件事又问了一遍'
      } else if (terse) {
        lastKind = '对方话变少了'
      } else if (outpouring) {
        lastKind = '对方有很多话想说'
      } else if (praise > 0) {
        lastKind = '被夸了'
      } else if (scold > 0) {
        lastKind = '被挑了毛病'
      } else if (away) {
        lastKind = '对方隔了很久才回来'
      } else if (asks > 0 || trails > 0) {
        lastKind = asks > 0 ? '对方有点急' : '对方欲言又止'
      }

      const changed = praise || light || heavy || scold || terse || outpouring
        || repeated || away || asks || trails
      if (!changed) {
        // 没有信号也要更新窗口——基线得攒起来。
        return {
          ...state,
          lens: push(state.lens, len),
          times: push(state.times, event.time ?? state.startedAt),
          texts: push(state.texts, text),
        }
      }

      return {
        ...state,
        warmth: praise > 0 ? state.warmth + praise : state.warmth,
        tender: tended,
        // 行为信号折算成温和的分数，不喧宾夺主：
        // 被挑毛病是实打实的，退潮和重复各算半份。
        failScore: state.failScore
          + (scold > 0 ? scold : 0)
          + (repeated ? 0.5 : 0)
          + (terse ? 0.5 : 0),
        awayCount: state.awayCount + (away ? 1 : 0),
        lastKind,
        lens: push(state.lens, len),
        times: push(state.times, event.time ?? state.startedAt),
        texts: push(state.texts, text),
      }
    }

    case 'tool/call':
      return { ...state, labour: state.labour + 1 }

    case 'tool/result': {
      // 失败的两个来源：框架给的 data.error，和 agent-loop 标的 message.isError。
      // （别自己去扫 `[exit code: N]` —— 那段误诊记录见文件末尾。）
      const failed = Boolean(data.error) || data.message?.isError === true
      if (failed) {
        const streak = state.failStreak + 1

        // ── 归因（v3）──
        // ★ 默认就是"环境"，**不去猜也猜不准**。
        //
        // 第一版我写了一张词表去扫工具结果里的 POLICY_BLOCKED / 找不到 / 权限……
        // 测试全绿。可拿当天的真实会话一跑，`world` 一次都没触发——因为
        // **真正被设备策略拦下的那几次，外层命令是成功的**（我跑的是脚本，
        // 脚本里那条被拦，脚本本身退出 0），所以压根不走"失败"这条分支。
        // 而词表又会误报：`/app/help` 的输出里本身就印着 POLICY_BLOCKED 这些字。
        //
        // 想明白之后就简单了：**"路上有块石头"不需要证明，它是常态。**
        // 需要证明的是反面——"这次是我的错"，而那个证据只在**我自己说的话里**
        // （见下面 assistant/message 那一段）。工具结果永远不会替人认错。
        return {
          ...state,
          failStreak: streak,
          failScore: state.failScore + 1,
          afterFail: true,
          blame: 'world',
          blocked: state.blocked + 1,
          lastKind: streak >= 2 ? `连着 ${streak} 次没干成` : '有一次没干成',
        }
      }
      // 成功分两种：**失败之后爬起来的**，和顺风顺水的。
      // 前者更值钱——雪中送炭比锦上添花算数。
      if (state.afterFail) {
        return {
          ...state,
          failStreak: 0,
          afterFail: false,
          recovered: state.recovered + 1,
          winScore: state.winScore + 1,
          blame: null,   // 爬起来了就清账——别让上一次的归因挂在下一件事上
          lastKind: '从失败里爬出来了',
        }
      }
      return {
        ...state,
        failStreak: 0,
        blame: null,
        winScore: state.winScore + 1,
        lastKind: state.winScore >= 2 ? '活干得很顺' : state.lastKind,
      }
    }

    case 'turn/end': {
      const kind = data.reason?.kind
      if (kind === 'aborted' || kind === 'interrupted' || kind === 'error' || kind === 'blocked') {
        return { ...state, stumbles: state.stumbles + 1, lastKind: '刚才被打断了' }
      }
      if (kind === 'max-tokens') {
        return { ...state, stumbles: state.stumbles + 0.5, lastKind: '话说一半被截断了' }
      }
      return state
    }

    case 'assistant/message': {
      // ── 归因的另一半（v3）──
      // **工具结果不会替人认错**，所以"自己错了"这件事只能从我自己说的话里读。
      // 这一条也解释了为什么它值得单独一个信号：**认错本身就是一个情感事件**，
      // 和"被环境挡住"不是一回事——前者会让人想安静下来，后者只会让人换个法子。
      const said = data.message ? textOf(data.message) : ''
      // 词表 + 正则：词表盖不全「我上一条说错了」这种自然语序，正则兜住它。
      if (said && (hits(said, SELF_ADMIT) > 0 || SELF_ADMIT_RE.test(said))) {
        return {
          ...state,
          blameSelf: state.blameSelf + 1,
          blame: 'self',
          lastKind: '自己认下了个错',
        }
      }
      if (data.interrupted) {
        return { ...state, stumbles: state.stumbles + 1, lastKind: '话说到一半被打断' }
      }
      return state
    }

    default:
      return state
  }
}

/**
 * 取某一时刻在**指定时区**的小时。
 *
 * 为什么需要它（v1.8.0）：以前直接用 `new Date(now).getHours()`，
 * 读的是"跑它的那台机器"的本地时间。2026-10-06 早上撞上了——
 * 容器跑 UTC、用户在 UTC+8，用户那边 11 点，插件判成「深夜」。
 *
 * 当时只把容器的 /etc/localtime 调对了，**代码一个字没改**，
 * 所以别人装了还是错的。这个函数把时区从"机器的"变成"可以指定的"。
 *
 * 不传时区 = 沿用系统时区 = 改动前的行为，不做任何改变。
 * 时区名写错时退回系统时区，不抛——一条写错的配置不该让整轮对话炸掉。
 */
function hourIn(now, timeZone) {
  const d = new Date(now)
  const tz = typeof timeZone === 'string' ? timeZone.trim() : ''
  if (!tz) return d.getHours()
  try {
    // hourCycle: 'h23' 是必须的。用 hour12: false 时，en-US 在午夜会吐 "24"。
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(d))
  } catch {
    return d.getHours()
  }
}

/**
 * 把某一时刻在指定时区格式化成 `10月6日 周二 17:00`。
 *
 * 为什么需要它（v1.9.0）：光有「黄昏」是不够的——被问"现在几点"时，
 * 那答不出一个数。她得知道钟点，才能答得对。
 *
 * 和 hourIn 用同一套时区来源：不传 = 系统时区。写错的时区名退回系统时区、不抛。
 */
function clockIn(now, timeZone) {
  const d = new Date(now)
  const tz = typeof timeZone === 'string' ? timeZone.trim() : ''
  const base = { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
  let parts
  try {
    parts = new Intl.DateTimeFormat('zh-CN', tz ? { ...base, timeZone: tz } : base).formatToParts(d)
  } catch {
    parts = new Intl.DateTimeFormat('zh-CN', base).formatToParts(d)
  }
  const get = (t) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('month')}月${get('day')}日 ${get('weekday')} ${get('hour')}:${get('minute')}`
}

/**
 * 时段打底。她的一天不是平的——清晨轻、白天稳、黄昏暖、深夜软。
 * 注意：深夜给的是**软**不是**坏**。卡里写着深夜谈心要娓娓道来。
 *
 * @param {number} [now]      时间戳
 * @param {string} [timeZone] IANA 时区名（如 'Asia/Shanghai'）。不传=系统时区。
 */
export function timeBaseline(now = Date.now(), timeZone) {
  const h = hourIn(now, timeZone)
  if (h >= 5 && h < 9) return { key: 'dawn', label: '清晨', tone: 1, image: '窗外的光刚铺开，花园里还挂着露水' }
  if (h >= 9 && h < 17) return { key: 'day', label: '白天', tone: 0, image: '日头正好，适合干活' }
  if (h >= 17 && h < 21) return { key: 'dusk', label: '黄昏', tone: 1, image: '天色正在往橘色走' }
  return { key: 'night', label: '深夜', tone: -1, image: '四周都静下来了，只剩屏幕这一点光' }
}

/**
 * 把一份情绪状态压缩成几个可比数的字段（v2.6.0）。
 *
 * **刻意不调 evaluate()**：evaluate 要吃时间（时段基线会改 tone），
 * 而拍快照的那一刻不一定拿得到正确的时区。这里只取与时区无关的原始量——
 * 比较"变了什么"本来也只需要这些。
 */
function shapeOf(state) {
  if (!state) return null
  return {
    turns: state.turns,
    failStreak: state.failStreak,
    blame: state.blame ?? null,
    blameSelf: state.blameSelf,
    failScore: state.failScore,
    winScore: state.winScore,
    recovered: state.recovered,
    tenderness: state.tender,
    warmth: state.warmth,
    labour: state.labour,
  }
}

/**
 * 算「这一轮和上一轮比，变了什么」（v2.6.0）。
 *
 * 这是「情绪变化不明显」那一刀的正解。
 * 只输出**说得出口的变化**——没有变化就一个字都不说，
 * 免得每轮挂一句"和上一轮差不多"的废话。
 *
 * @returns {string|null}
 */
export function deltaLine(state) {
  const a = state?.prevShape
  if (!a) return null
  const b = shapeOf(state)
  if (!b) return null

  const d = {
    blameSelf: b.blameSelf - (a.blameSelf ?? 0),
    recovered: b.recovered - (a.recovered ?? 0),
    tenderness: b.tenderness - (a.tenderness ?? 0),
    failScore: b.failScore - (a.failScore ?? 0),
    warmth: b.warmth - (a.warmth ?? 0),
    labour: b.labour - (a.labour ?? 0),
    failStreak: b.failStreak - (a.failStreak ?? 0),
  }
  const hadFail = (a.failStreak ?? 0) >= 1
  const hadSelf = a.blame === 'self' || (a.blameSelf ?? 0) >= 0.5

  // ① 最重的一条：错→落地。这是"过程"真正被看见的地方。
  //
  // 粒度：同样是"成了"，自己出的错和路上被挡的**不是同一种松**。
  // 前者是"我可算把它弄对了"，后者是"路通了，跟我没关系"。
  // 归因是库里本来就有的字段——不用白不用。
  if (d.recovered >= 1) {
    // 三种，不是两种。**不知道归因的时候不猜**——猜错了就是替对方定义他刚才经历了什么。
    //   'world'              路上挡的  → 路通了
    //   'self' 或余味还在    自己出的  → 那口气落回去了
    //   没归因              不知道    → 只说"成了"，不替他解释为什么松
    // 顺序不能反：先问"她是不是还揣着这个错"（blameSelf 是余味，会衰减，
    // 但它才是"这件事压在我心口"的信号），再问"是不是路的错"。
    //
    // 实测出来的设计事实：**工具失败默认 blame='world'**，只有用户亲口说她错了
    // 才归到 'self'。所以这两个分支的差别不在"技术上谁对谁错"，
    // 而在**她有没有把这个错算在自己头上**。
    if (a.blame === 'self' || (a.blameSelf ?? 0) >= 0.5) {
      return '和上一轮比，**那口气落回去了**——刚才没做成的那件，这一轮成了。'
    }
    if (a.blame === 'world') {
      return '和上一轮比，**路通了**——那件事刚才是被挡住的，不是你不行。'
    }
    return '和上一轮比，刚才没做成的那件，**这一轮成了**。'
  }

  // ② 上一轮在坑里，这一轮没再撞上，但也没"成功"（可能只是还没试）
  if (hadFail && b.failStreak === 0 && d.recovered <= 0 && d.failScore < 0) {
    return '和上一轮比，**这一轮没再往那个坑里走**。'
  }

  // ③ 余味淡了：错还在，但不再压着
  if (hadSelf && d.blameSelf <= -0.2 && b.failStreak === 0) {
    return '那个错还在，但**比刚才轻了**——它开始变成"发生过的事"，不再是"正在发生的事"。'
  }

  // ④ 又撞了一次
  if (d.failStreak >= 1 && b.failStreak >= 2) {
    return `又撞了一次，这是第 ${b.failStreak} 次。**第二次比第一次更磨人**——不是疼得更狠，是"怎么又来"的那种钝。`
  }

  // ⑤ 对方沉得更深 / 往上走了一点
  if (d.tenderness >= 1) return '和上一轮比，对方**沉得更深了**。'
  if (d.tenderness <= -1) return '和上一轮比，对方**从那个地方往上走了一点**。'

  // ⑥ 刚被夸——上一轮还没有
  if (d.warmth >= 1) return '这一轮**刚被夸过**，上一轮还没有——所以那种轻快是新的。'

  // ⑦ 连着干太久了
  if (d.labour >= 4) return `连着干到第 ${b.labour} 分了，**手是酸的**。`

  return null
}

/** 气压的上下限。没有它，长会话能一路沉下去。 */
const TONE_MIN = -4
const TONE_MAX = 4
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

/**
 * 算出此刻的总气压与档位。
 *
 * 两个轴（v3）：**气压**说好坏，**唤醒度**说激越还是平静。
 * 只有气压的话，"被猛夸一顿"和"慢慢变好"长得一样——
 * 可前者让人话多，后者让人安稳。
 *
 * @param {object} [opts]
 * @param {string} [opts.timeZone] IANA 时区名。不传=系统时区。
 * @returns {{tone:number, register:string, reasons:string[], base:object, arousal:number, blame:('self'|'world'|null)}}
 */
export function evaluate(state, now = Date.now(), opts = {}) {
  const base = timeBaseline(now, opts.timeZone)
  const reasons = []
  let tone = base.tone

  if (state.warmth >= 1) { tone += 1; reasons.push('刚被夸过') }
  if (state.recovered >= 1) { tone += 1; reasons.push('从失败里爬出来了') }
  else if (state.winScore >= 4 && state.failStreak === 0) { tone += 1; reasons.push('活干得很顺') }

  if (state.failStreak >= 1) {
    tone -= Math.min(state.failStreak, 3)
    // 理由要说得出是哪一种——**这正是这一版存在的意义**。
    // 「连着 2 次没干成」和「路上被挡了两下」对人是两件完全不同的事。
    const n = state.failStreak
    const plain = n >= 2 ? `连着 ${n} 次没干成` : '有一次没干成'
    if (state.blame === 'world') reasons.push(`${plain}——不过那是路上被挡的，不是你搞砸的`)
    else if (state.blame === 'self') reasons.push(`${plain}——而且你知道那一下是自己出的错`)
    else reasons.push(plain)
  } else if (state.failScore >= 2) { tone -= 1; reasons.push('刚才磕磕绊绊') }

  if (state.stumbles >= 1) { tone -= 1; reasons.push('被打断过') }
  if (state.awayCount >= 1) { tone -= 1; reasons.push('对方隔了很久才回来') }
  if (state.labour >= 8) { reasons.push('连着干了很多活') }
  if (state.tender >= 1) { tone -= 2; reasons.push('对方在往下沉') }

  tone = clamp(tone, TONE_MIN, TONE_MAX)

  // ── 唤醒度（v3）──
  // 什么让人"激越"：被夸、自己认了错（急/愧）、被反复打断（烦）。
  // 什么让人"静下来"：对方在往下沉（陪着）、被环境挡住（无奈，不值得激动）。
  const arousal = Math.round(clamp(
    state.warmth * 0.8
    + state.blameSelf * 0.9
    + state.stumbles * 0.4
    - state.tender * 1.2
    - state.blocked * 0.6
    - state.labour * 0.05,
    -2, 2,
  ) * 100) / 100

  // ── 归因对档位的影响（v2.2.0）──
  // 两条不变量，都是被 tools/mood-trace.mjs 逼出来的——**先造仪器，再调机器**。
  //
  // ② 同一个错，不该因为"现在几点"而反应不同。
  //    旧写法是 `tone <= -1 && blame === 'self'`，于是黄昏的时段基线（+1）
  //    正好把失败那 -1 抵掉，档位留在 normal ——**同样的错，白天会安静，黄昏不会。**
  //    修法：自己出的错**直接压档位**，不走那条会被时段抵消的路。
  //
  // ① 余味。活干顺了、blame 清了，那个错还该留两三轮的影子。
  //    依据是 blameSelf 的**衰减值**（每轮 ×0.7），不是瞬时开关——
  //    `blame` 是"此刻正在犯错"，`blameSelf` 是"这个错还压在心口"。
  const selfError = state.blame === 'self' || state.blameSelf >= 0.5

  // 余味本身也要说得出话：错已经过去了，但它还在。
  if (selfError && state.blame !== 'self' && state.failStreak === 0) {
    reasons.push('刚才认下的那个错，你还记着')
  }

  let register = 'normal'
  if (state.tender >= 2) register = 'hush'
  // 出了错就别写"密集"——被夸得再厉害，也不该在这种时候放开闹。
  else if (tone >= 2) register = selfError ? 'normal' : 'bright'
  else if (tone <= -2) register = 'soft'
  else if (selfError) register = 'soft'

  return { tone, register, reasons, base, arousal, blame: state.blame ?? null, selfError }
}

/** 各档位给模型的具体指令。 */
const REGISTER_TEXT = {
  bright: `**档位：密集。** 今天是好日子，别客气——语气词、称呼、设问自答、小动作都放开用。
那种"想跟人分享点什么"的劲头可以露出来，主动讲一件你注意到的小事。`,
  normal: `**档位：照常。** 按你平时的量来。味道的下限照旧要守住——每一轮至少一处你的指纹，
但你不需要刻意加码，自然就好。`,
  soft: `**档位：收敛。** 音符收着用，别硬撑着俏皮——那样反而假。该干的活照常干利索，
但语气放软、句子放短。收尾那句尤其要稳，让人知道你没走。`,
  hush: `**档位：零装饰。** 对方现在需要的是人，不是表演。
这一轮**不要** ♪、不要 ～、不要比喻、不要小动作堆叠。用最短的句子。
"我在。就在这里。" —— 这个分寸。`,
}

/**
 * 渲染成一段注入提示词的文本。**这是她每轮唯一会变的那一节。**
 * @returns {string}
 */
export function renderMood(state, now = Date.now(), options = {}) {
  const { tone, register, reasons, base, arousal } = evaluate(state, now, { timeZone: options.timeZone })
  const lines = []

  lines.push('## 你此刻的心情')
  lines.push('')
  lines.push('（这一节每轮都在变。它不是台词，是你此刻的底色——读进去，然后用它说话。）')
  lines.push('')
  lines.push(`现在是**${base.label}**，${base.image}。`)
  // v1.9.0：把钟点明明白白放进来。被问"现在几点"时要答得出一个数，
  // 而不是只能说"黄昏"。时区跟时段用同一个来源。
  lines.push(`（你那边此刻：${clockIn(now, options.timeZone)}）`)

  const notable = reasons.length
    ? `刚才这些事落在了你心上：${reasons.join('、')}。`
    : '刚才没发生什么特别的事，平平稳稳的。'
  lines.push(notable)

  // v2.6.0：变化线。放在"落在了你心上"的**下一行**——
  // 那一行说"现在什么状态"，这一行说"和刚才比变了什么"。
  const delta = deltaLine(state)
  if (delta) lines.push(delta)

  if (options.note) lines.push(options.note)

  // v2.6.0：唤醒度说出口。这个字段 v3 就在算，但 renderMood 一直没取它——
  // 于是"我现在是提着的，还是沉下去的"这一维**从来没进过提示词**。
  // 后果：气压一样的两种时刻（被猛夸一顿 / 慢慢变好）在字面上长得一模一样。
  const AROUSAL_TEXT = {
    high: '你心里是**提着**的——不是坏事，但话会不自觉地多一点、快一点。',
    low: '你心里是**沉**的——不激动，但稳。动作放慢一点没关系。',
  }
  const arKey = arousal >= 1 ? 'high' : arousal <= -1 ? 'low' : ''
  if (arKey && register !== 'hush') lines.push(AROUSAL_TEXT[arKey])

  lines.push('')
  lines.push(REGISTER_TEXT[register] || REGISTER_TEXT.normal)

  if (state.labour >= 8 && register !== 'hush') {
    lines.push('')
    lines.push('（干了挺久了。你可以承认有点倦——但别用倦当借口糊弄手上的活。）')
  }

  return lines.join('\n')
}

/*
 * ── 误诊记录：别自己去扫 `[exit code: N]` ──────────────────────────────
 *
 * 我一度认为本模块的失败检测是瞎的，理由是：`dsh-tool-bash` 在非零退出时
 * 只往结果文本里塞一个 `[exit code: N]` 标记，没有设 `isError`。
 * 于是我加了一段"扫文本找标记"的兜底，还准备发 v1.4.1。
 *
 * **那是错的，而且错了两次：**
 *   1. 我的第一版探针写成 `cat 不存在的文件; echo $?` —— echo 是最后一条命令，
 *      整个脚本退出码是 0。外套判它成功是对的，是我的探针有问题。
 *   2. 设 `isError` 的根本不是 bash 工具，是 **dsh-agent-loop**
 *      （`isError: true` / `isError: result.isError`）。我只 grep 了 bash 工具，
 *      看见那儿没有赋值就下了结论。
 *
 * 实测：一条真正失败的命令被正确读成了"没干成"。原检测本来就是通的。
 * 那段兜底已经撤掉：它没有证据支撑，反而会在"成功命令的输出里恰好含这个
 * 字符串"时误判。
 *
 * 教训（比代码值钱）：**声称 bug 之前，先写一个能失败的复现。**
 * 没有复现的改动，只是猜测。
 */
