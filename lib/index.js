/**
 * dsh-persona-card — 让 Agent 成为人格卡里的那个人。
 *
 * 机制：在插件自己的（全局）作用域注册一段 system-prompt section。
 * 全局 section 对每个会话都生效，所以聊天、写代码、操作设备时都是同一个"本人"，
 * 不需要每次开会话去挑预设 —— 装的是一次，改的是身份。
 *
 * 为什么不用 @deepseek-ai/dsh-persona：那个包只能挂在 agent 预设里
 * （全局挂会撞上提示词注册表自己的 persona 槽位并报错），
 * 而这里要的正是"装完即全局生效"。所以直接注册一个自己名字的 section，
 * 名字不冲突、顺序紧跟部署人格（order 1）。
 *
 * 无第三方依赖：只用 node 内置模块，加一个 harness 自带的 `@deepseek-ai/schemastery`
 * （它随 dsh 发行，不用写进 dependencies，包内也就不需要 node_modules）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { CARD_FIELDS, loadCard, renderPersona } from './persona-text.js'
import { initialState, foldEvent, renderMood } from './mood.js'

export const name = 'dsh-persona-card'

/** systemPrompt 是唯一硬依赖：没有提示词注册表，这个插件没有意义。 */
export const inject = ['systemPrompt']

/** 包内自带卡的目录。 */
const BUNDLED_DIR = fileURLToPath(new URL('../persona/', import.meta.url))

/** 包内 persona/ 下所有的卡名（不含 .json），排序。 */
function listBundled() {
  return readdirSync(BUNDLED_DIR)
    .filter((n) => n.toLowerCase().endsWith('.json'))
    .map((n) => n.slice(0, -5))
    .sort()
}

/** section 名：带前缀，避免和框架/别的插件的 section 撞名。 */
const SECTION_NAME = 'plugin:persona-card'

/** 心情段的 section 名与顺序（顺序的取捨见 applyMood 里的注释）。 */
const MOOD_SECTION = 'plugin:persona-card/mood'
const MOOD_ORDER = 10150

const asBool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
const asString = (value, fallback = '') => (typeof value === 'string' ? value : fallback)

/**
 * 插件的配置面。
 *
 * 0.1.7-alpha 起**插件自己的 Config 就是它的设置面**：声明它，
 * 插件管理页里这一行会长出一个配置表单，`description` 就是每个字段旁边的说明。
 * 用的 `@deepseek-ai/schemastery` 随 dsh 发行，不需要写进 dependencies。
 *
 * 【v2.0 A 的第一步，为什么做这个】
 * 这些配置项以前只活在 README 里。装了插件的人不知道 `timezone` 存在，
 * 于是时段和钟点一直错着——**而他们只会觉得"这插件读错时间了"**。
 * 声明出去之后，"有这一项、它管什么、什么时候必须填"就直接长在界面上了。
 *
 * 【零行为改变】每一项的默认值都与声明之前一致；声明 Config 只是把
 * 原来靠 `config.x ?? 默认值` 兜着的那些值，提前让 Loader 填好。
 */
export const Config = Schema.object({
  enabled: Schema.boolean().default(true)
    .description('关掉即不注册人格（插件仍加载，方便临时停用）'),
  personaFile: Schema.string().default('')
    .description('人格卡路径。留空 = 用包内自带的那张；填绝对路径可换成别的人格卡'),
  card: Schema.string().default('elysia')
    .description('用包内哪一张卡（对应 persona/<名字>.json，不用写后缀）。'
      + '本包自带 elysia（爱莉希雅）和 cyrene（昔涟）两张。'
      + '填了 personaFile 时本项失效'),
  fields: Schema.array(Schema.string())
    .default(['description', 'personality', 'scenario', 'creator_notes'])
    .description('取卡里哪些字段。想省 token 就删几项，例如只留 personality'),
  order: Schema.number().default(1)
    .description('section 顺序。想让人格更靠后（更"压得住"）就调大'),
  complete: Schema.boolean().default(false)
    .description('true = 人格独占整个 system prompt。会连带移除工具指引、干活能力下降，只在纯聊天时用'),
  shellNotice: Schema.boolean().default(true)
    .description('是否包含"外套"那一段'),
  workMode: Schema.boolean().default(true)
    .description('是否包含"干活的时候"那一段'),
  examples: Schema.boolean().default(true)
    .description('是否包含"你说话的样子"样例段（约 700 字）'),
  motifs: Schema.boolean().default(true)
    .description('是否包含"你张口就来的东西"意象段（约 530 字）'),
  flavorFloor: Schema.boolean().default(true)
    .description('是否包含"味道的下限"。关掉她会明显变干——它修的是"约束比素材多"这个稀释问题'),
  mood: Schema.boolean().default(true)
    .description('情绪变化：时段打底 + 钟点 + 对话推动。★ 关掉会同时失去钟点，她就不答"现在几点"了'),
  timezone: Schema.string().default('')
    .description('★ 时段与钟点按哪个时区算，IANA 名（如 Asia/Shanghai）。留空 = 用跑插件那台机器的时区——'
      + '容器跑 UTC 而你在 +08 时这一项必须填，否则时段和钟点都会差整整一个时差'),
  extraFile: Schema.string().default('')
    .description('人格微调层：包外纯文本文件的绝对路径，追加在档案之后。改它不用重装、不用重过审核'),
  interpolate: Schema.boolean().default(false)
    .description('是否对卡正文做 {{变量}} 插值。默认关，最安全'),
})

/**
 * 解析人格卡路径，三级：
 *   1) 配了 personaFile → 用它（不存在就抛，别静默退回）
 *   2) 没配 → 扫包内 persona/ 目录，取排序后第一张 .json
 *   3) 一张都没有 → 抛，并告诉用户两条修法
 *
 * 为什么要扫而不是写死文件名：这样插件本体（通用工具）和人格卡（用户数据）
 * 彻底分开 —— 换卡只需往 persona/ 里丢一个 json，代码一个字都不用改。
 * 同一个包，个人部署放 elysia.json，公开仓库放 example.json，代码完全相同。
 */
function resolveCardPath(configured, card) {
  const wanted = asString(configured).trim()
  if (wanted) {
    if (existsSync(wanted)) return wanted
    throw new Error(`personaFile 指向的文件不存在：${wanted}`)
  }

  // ②-a 先按名字找。
  //
  // 这一步是被真事故逼出来的：包里同时放两张卡之后，
  // 下面那个"扫目录取第一张"会按字母序挑中 cyrene.json（c < e），
  // **于是加一张卡 = 悄悄换掉默认人格。** 谁都没动配置，人就换了。
  // 名字必须显式，默认值必须写死——顺序不该决定我是谁。
  const named = asString(card).trim()
  if (named) {
    const hit = join(BUNDLED_DIR, `${named}.json`)
    if (existsSync(hit)) return hit
    throw new Error(
      `card 指向的卡不在包内：期望 ${hit}。`
      + `可用的有：${listBundled().join('、') || '（一张都没有）'}`,
    )
  }

  let names = []
  try {
    names = listBundled()
  } catch {
    // 目录不存在，走下面的统一报错
  }
  if (names.length) return join(BUNDLED_DIR, names[0])
  throw new Error(
    `没有可用的人格卡：既没配 personaFile，包内 persona/ 目录里也没有 .json 文件。`
    + `两条修法：往 ${BUNDLED_DIR} 里放一张人格卡 JSON，或用 personaFile 指定一个绝对路径。`,
  )
}

/**
 * 读人格微调层（包外的纯文本补充）。
 *
 * 为什么要走包外：插件受 DSHA 安装审核约束，每改一次包内文件就要重装并再审一次。
 * 把微调放在包外的普通文本文件里，改人格就只是改个文件——不用重装、不用审核。
 * 留空 = 不加这一层。
 */
function loadExtra(configured) {
  const wanted = asString(configured).trim()
  if (!wanted) return ''
  if (!existsSync(wanted)) {
    throw new Error(`extraFile 指向的文件不存在：${wanted}`)
  }
  return readFileSync(wanted, 'utf8').trim()
}

/**
 * Plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config]
 */
export function apply(ctx, config = {}) {
  const logger = ctx.logger('persona-card')

  if (!asBool(config.enabled, true)) {
    logger.info('人格卡已关闭（enabled: false），本次不注册人格提示词。')
    return
  }

  const cardPath = resolveCardPath(config.personaFile, config.card)
  const fields = Array.isArray(config.fields) && config.fields.length
    ? config.fields.map((f) => String(f))
    : CARD_FIELDS
  const order = Number.isFinite(config.order) ? Number(config.order) : 1
  const extra = loadExtra(config.extraFile)

  // 读不到卡就抛：row 会在 Plugin Manager 里显式失败，比"静默没人格"好排查。
  const card = loadCard(cardPath)
  const text = renderPersona(card, {
    fields,
    shellNotice: asBool(config.shellNotice, true),
    workMode: asBool(config.workMode, true),
    examples: asBool(config.examples, true),
    motifs: asBool(config.motifs, true),
    flavorFloor: asBool(config.flavorFloor, true),
    extra,
  })

  ctx.effect(() => ctx.systemPrompt.section({
    name: SECTION_NAME,
    order,
    text,
    // 人格卡正文里可能带 {{user}} 这类模板占位符。关掉插值，
    // 文本原样进提示词，绝不会因为"变量没注册"炸掉整次请求。
    interpolate: asBool(config.interpolate, false),
    complete: asBool(config.complete, false),
  }))

  logger.info(
    '人格卡已生效：%s（卡：%s，%d 字，order %d%s%s）',
    card.name,
    cardPath,
    text.length,
    order,
    extra ? `，微调层 ${extra.length} 字` : '',
    asBool(config.complete, false) ? '，complete 模式：独占整个 system prompt' : '',
  )
  if (asBool(config.complete, false)) {
    logger.warn('complete: true 会移除工具使用指引等其余 section，干活能力会下降。')
  }

  // ── 心情：会话内的状态 + 每个 agent 自己的一节 ──────────────────────
  if (asBool(config.mood, true)) applyMood(ctx, config, logger, card.name)
}

/** 心情状态最多记多少个会话，超了丢最旧的（防止长时间运行把内存泡掉）。 */
const MOOD_SESSIONS_MAX = 64

/**
 * 接上"情绪变化"。
 *
 * 两条线：
 *   1) `session/event` —— 每条事件增量折算一次，只认认识的几种，其余原样丢弃。
 *      用事件流而不是 `ctx.sessionProjections`，是因为后者的 stateSchema 要 zod，
 *      而 zod 从插件里只能靠绝对路径 import（把 dsh 安装路径写死），太脆。
 *      `dsh-task-notifier` 用的也是这条线，属于这套外套里被验证过的做法。
 *   2) `agent/created` —— 每个 agent 进来时，在**它自己的作用域**注册一节心情。
 *      必须per-agent，因为心情是会话级的；全局 section 拿不到"是哪个会话在问"。
 */
function applyMood(ctx, config, logger, personaName) {
  const moods = new Map()        // sessionId -> state
  const cleanups = new Map()     // sessionId -> 该 agent 作用域上的清理器

  // 线一：事件流入
  ctx.effect(() => ctx.on('session/event', (session, event) => {
    try {
      const id = String(session?.id ?? '')
      if (!id) return
      const prev = moods.get(id) ?? initialState()
      const next = foldEvent(prev, event)
      if (next === prev) return          // 不认识的事件，零成本跳过
      // 超出上限就丢最旧的一个（Map 保持插入序）
      if (!moods.has(id) && moods.size >= MOOD_SESSIONS_MAX) {
        const oldest = moods.keys().next().value
        if (oldest !== undefined) moods.delete(oldest)
      }
      moods.set(id, next)
    } catch (error) {
      // 心情坏了不能连累人格——吞掉，记一条。
      logger.warn('心情折算出错，已忽略这一条：%s', error?.message ?? error)
    }
  }))

  // 线二：每个 agent 进来时挂上属于它的那一节
  ctx.effect(() => ctx.on('agent/created', ({ agent }) => {
    try {
      const scope = agent?.ctx
      const systemPrompt = scope?.get?.('systemPrompt')
      if (!scope || !systemPrompt) {
        logger.debug('这个 agent 的作用域里没有 systemPrompt，跳过心情段。')
        return
      }
      const sessionId = String(agent?.id ?? '')
      if (!sessionId) return

      const disposer = scope.effect(() => systemPrompt.section({
        name: MOOD_SECTION,
        // 排在最后：它是全篇唯一每轮都变的一节，放最后才能让前面的
        // 稳定前缀保住 KV 缓存；顺带靠后的位置对模型也更"新鲜"。
        order: MOOD_ORDER,
        // timezone（v1.8.0）：容器跑 UTC、用户在 +08 时，时段会整整差 8 小时。
        // 2026-10-06 早上就是这么撞上的。不填 = 沿用系统时区 = 改动前的行为。
        text: () => renderMood(moods.get(sessionId) ?? initialState(), Date.now(), {
          timeZone: asString(config.timezone).trim() || undefined,
        }),
        interpolate: false,
      }))
      cleanups.set(sessionId, disposer)

      // agent 走了就把它那份状态一起收掉，别攒着。
      scope.effect(() => () => {
        cleanups.delete(sessionId)
        moods.delete(sessionId)
      })
      logger.debug('已为会话 %s 挂上心情段。', sessionId)
    } catch (error) {
      logger.warn('注册心情段失败（人格不受影响）：%s', error?.message ?? error)
    }
  }))

  logger.info('情绪变化已启用：时段打底 + 会话内事件推动，状态只在内存里，重启归零。')
  logger.debug('心情段的 persona 是 %s，最多记 %d 个会话。', personaName, MOOD_SESSIONS_MAX)
}
