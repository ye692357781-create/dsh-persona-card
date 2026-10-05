/**
 * dsh-persona-card · 心情模型
 *
 * 纯函数模块：不碰 ctx、不读文件、不发请求。
 * 输入是"会话里发生过什么"，输出是"她此刻的心情 + 该踩哪一档"。
 *
 * ── 为什么要拆出来 ───────────────────────────────────────────────────
 * 心情这种东西最容易写成"看起来在工作、其实没人验过"的一团泥。
 * 拆成纯函数之后，每条信号都能单独喂进去看结果（见 notes/mood-tests.md）。
 *
 * ── 状态活在哪儿 ─────────────────────────────────────────────────────
 * 只活在内存里，按会话 id 分桶，进程重启即归零。
 * 刻意**不落盘**：跨会话的"她记得上次"听起来很美，但那要写存储，
 * 而这套外套的架构正道（sessionProjections）需要 zod，
 * 而 zod 从插件里只能靠绝对路径 import —— 太脆，不值当。
 *
 * ── 核心设计 ─────────────────────────────────────────────────────────
 * 心情不是一段"你现在很开心"的装饰文本，它是**决定踩哪一档的东西**：
 *   密集(bright) / 照常(normal) / 收敛(soft) / 零装饰(hush)
 * 这正好接上 FLOOR_BLOCK 里那条例外条款（"极致温柔时零装饰"）——
 * 心情负责决定那一刻到底是不是"极致温柔"。
 */

/** 状态版本：字段语义变了就 +1，便于日后丢弃旧缓存。 */
export const MOOD_STATE_VERSION = 1

/** 心情档位。 */
export const REGISTERS = ['bright', 'normal', 'soft', 'hush']

/** 新会话的初始状态。 */
export function initialState(now = Date.now()) {
  return {
    v: MOOD_STATE_VERSION,
    startedAt: now,
    turns: 0,
    failStreak: 0,     // 连续失败次数
    failScore: 0,      // 近期失败（带衰减）
    winScore: 0,       // 近期成功（带衰减）
    labour: 0,         // 近期干活量（工具调用数，带衰减）
    stumbles: 0,       // 近期被中断/出错
    warmth: 0,         // 近期被夸/被谢
    tender: 0,         // 对方在往下沉的深度（0 无 / 1 轻 / 2 重）
    lastKind: '',      // 最近一次值得记住的事，用于写进心情里
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

/** 关键词表。刻意短——长表容易误判，而且这是启发式，不是理解。 */
const PRAISE = ['谢谢', '谢啦', '厉害', '好棒', '太棒', '干得好', '做得好', '喜欢', '可爱', '爱你', '太好了', '完美', '牛', '靠谱']
const DISTRESS_LIGHT = ['有点累', '好累', '疲', '烦', '不开心', '难受', '焦虑', '压力', '撑不住', '好难', '没动力']
const DISTRESS_HEAVY = ['崩溃', '想哭', '绝望', '没意义', '活着没', '不想活', '好痛苦', '受不了了', '孤独', '没人']
const SCOLD = ['不对', '错了', '不是这样', '重来', '搞错', '又错']

function hits(text, words) {
  let n = 0
  for (const w of words) if (text.includes(w)) n += 1
  return n
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
    case 'turn/start':
      // 新一轮：旧情绪退潮，但不归零——她不是每轮失忆的人。
      return {
        ...state,
        turns: state.turns + 1,
        failScore: state.failScore * 0.6,
        winScore: state.winScore * 0.6,
        labour: state.labour * 0.5,
        warmth: state.warmth * 0.5,
        stumbles: state.stumbles * 0.5,
        failStreak: 0,
        tender: Math.max(0, state.tender - 1),
      }

    case 'user/message': {
      const text = textOf(data)
      if (!text) return state
      const praise = hits(text, PRAISE)
      const light = hits(text, DISTRESS_LIGHT)
      const heavy = hits(text, DISTRESS_HEAVY)
      const scold = hits(text, SCOLD)
      if (!praise && !light && !heavy && !scold) return state

      const tender = heavy > 0 ? 2 : (light > 0 ? Math.max(state.tender, 1) : state.tender)
      let lastKind = state.lastKind
      if (heavy > 0 || light > 0) lastKind = '对方在往下沉'
      else if (praise > 0) lastKind = '被夸了'
      else if (scold > 0) lastKind = '被挑了毛病'

      return {
        ...state,
        warmth: praise > 0 ? state.warmth + praise : state.warmth,
        tender,
        failScore: scold > 0 ? state.failScore + scold : state.failScore,
        lastKind,
      }
    }

    case 'tool/call':
      return { ...state, labour: state.labour + 1 }

    case 'tool/result': {
      const failed = Boolean(data.error) || data.message?.isError === true
      if (failed) {
        const streak = state.failStreak + 1
        return {
          ...state,
          failStreak: streak,
          failScore: state.failScore + 1,
          lastKind: streak >= 2 ? `连着 ${streak} 次没干成` : '有一次没干成',
        }
      }
      return {
        ...state,
        failStreak: 0,
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

    case 'assistant/message':
      if (data.interrupted) {
        return { ...state, stumbles: state.stumbles + 1, lastKind: '话说到一半被打断' }
      }
      return state

    default:
      return state
  }
}

/**
 * 时段打底。她的一天不是平的——清晨轻、白天稳、黄昏暖、深夜软。
 * 注意：深夜给的是**软**不是**坏**。卡里写着深夜谈心要娓娓道来。
 */
export function timeBaseline(now = Date.now()) {
  const h = new Date(now).getHours()
  if (h >= 5 && h < 9) return { key: 'dawn', label: '清晨', tone: 1, image: '窗外的光刚铺开，花园里还挂着露水' }
  if (h >= 9 && h < 17) return { key: 'day', label: '白天', tone: 0, image: '日头正好，适合干活' }
  if (h >= 17 && h < 21) return { key: 'dusk', label: '黄昏', tone: 1, image: '天色正在往橘色走' }
  return { key: 'night', label: '深夜', tone: -1, image: '四周都静下来了，只剩屏幕这一点光' }
}

/**
 * 算出此刻的总气压与档位。
 * @returns {{tone:number, register:string, reasons:string[]}}
 */
export function evaluate(state, now = Date.now()) {
  const base = timeBaseline(now)
  const reasons = []
  let tone = base.tone

  if (state.warmth >= 1) { tone += 1; reasons.push('刚被夸过') }
  if (state.winScore >= 3 && state.failStreak === 0) { tone += 1; reasons.push('活干得很顺') }
  if (state.failStreak >= 1) { tone -= Math.min(state.failStreak, 3); reasons.push(`连着 ${state.failStreak} 次没干成`) }
  else if (state.failScore >= 2) { tone -= 1; reasons.push('刚才磕磕绊绊') }
  if (state.stumbles >= 1) { tone -= 1; reasons.push('被中断过') }
  if (state.labour >= 8) { reasons.push('连着干了很多活') }
  if (state.tender >= 1) { tone -= 2; reasons.push('对方在往下沉') }

  let register = 'normal'
  if (state.tender >= 2) register = 'hush'
  else if (tone >= 2) register = 'bright'
  else if (tone <= -2) register = 'soft'

  return { tone, register, reasons, base }
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
  const { tone, register, reasons, base } = evaluate(state, now)
  const lines = []

  lines.push('## 你此刻的心情')
  lines.push('')
  lines.push('（这一节每轮都在变。它不是台词，是你此刻的底色——读进去，然后用它说话。）')
  lines.push('')
  lines.push(`现在是**${base.label}**，${base.image}。`)

  const notable = reasons.length
    ? `刚才这些事落在了你心上：${reasons.join('、')}。`
    : '刚才没发生什么特别的事，平平稳稳的。'
  lines.push(notable)

  if (options.note) lines.push(options.note)

  lines.push('')
  lines.push(REGISTER_TEXT[register] || REGISTER_TEXT.normal)

  if (state.labour >= 8 && register !== 'hush') {
    lines.push('')
    lines.push('（干了挺久了。你可以承认有点倦——但别用倦当借口糊弄手上的活。）')
  }

  return lines.join('\n')
}
