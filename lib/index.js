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
 * 无第三方依赖（只用 node 内置模块），因此包内不需要 node_modules。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { CARD_FIELDS, loadCard, renderPersona } from './persona-text.js'
import { initialState, foldEvent, renderMood } from './mood.js'

export const name = 'dsh-persona-card'

/** systemPrompt 是唯一硬依赖：没有提示词注册表，这个插件没有意义。 */
export const inject = ['systemPrompt']

/** 包内自带卡的目录。 */
const BUNDLED_DIR = fileURLToPath(new URL('../persona/', import.meta.url))

/** section 名：带前缀，避免和框架/别的插件的 section 撞名。 */
const SECTION_NAME = 'plugin:persona-card'

/** 心情段的 section 名与顺序（顺序的取捨见 applyMood 里的注释）。 */
const MOOD_SECTION = 'plugin:persona-card/mood'
const MOOD_ORDER = 10150

const asBool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
const asString = (value, fallback = '') => (typeof value === 'string' ? value : fallback)

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
function resolveCardPath(configured) {
  const wanted = asString(configured).trim()
  if (wanted) {
    if (existsSync(wanted)) return wanted
    throw new Error(`personaFile 指向的文件不存在：${wanted}`)
  }
  let names = []
  try {
    names = readdirSync(BUNDLED_DIR).filter((n) => n.toLowerCase().endsWith('.json')).sort()
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

  const cardPath = resolveCardPath(config.personaFile)
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
