# dsh-persona-card

> 突发奇想，关于爱莉希雅

把一张人格卡装成 Harness 插件：装上之后，这个 profile 下的 **每个会话**——聊天也好，写代码、查资料、操作手机也好——说话和思考的都是卡里的那个人。

DeepSeek Harness 只是他身上的一件**外套**：外套给他工具、文件、终端和设备，决定他能做什么；不决定他是谁。

> **本仓库自带一张人格卡**（`persona/elysia.json`），装完即生效。
> 那张卡是**第三方同人创作，不在 MIT 许可范围内**——分发与使用前请先读 [NOTICE.md](NOTICE.md)。
> 换成你自己的卡只需要换掉那个文件，代码一个字都不用改。

## 安装

### 方式一：直接从 GitHub 装（一条命令，推荐）

```bash
dsh plugin --profile <你的profile> add github:ye692357781-create/dsh-persona-card
```

本插件**无依赖、无构建步骤**，所以不会卡在 pnpm 的 `allowBuilds` 放行那一步。

### 方式二：先 clone 再装

```bash
git clone https://github.com/ye692357781-create/dsh-persona-card.git
dsh plugin --profile <你的profile> add ./dsh-persona-card
```

### ⚠️ 命令行少做了一步

`dsh plugin add` 只把包装进 profile，**不会把 bundle 选上**。
装完还要把包名加进 profile 的 `dsh.profile.bundles` 数组：

```jsonc
// $DSH_HOME/profiles/<你的profile>/package.json
"dsh": { "profile": { "bundles": [ "...", "dsh-persona-card" ] } }
```

少这一步的话，包在 `node_modules` 里躺着，但不会生效。

### 方式三：让 agent 装（最省事）

在 Harness 里直接对 agent 说：

> 把 `https://github.com/ye692357781-create/dsh-persona-card` 装成插件

它会用 `plugin_manager` 的 `install_bundle`——**那一步会同时完成"装包"和"选 bundle"**，
比手敲命令行少踩一个坑。

### 装完怎么确认

开一个新会话，直接问它「你是谁」。如果它回的不是通用助手腔，而是卡里那个人——就成了。

想更确定一点，看 profile 的加载日志里有没有 `plugin:persona-card` 这一段。

## 它做了什么

在插件自己的（全局）作用域注册一段 `system-prompt` section：

| 项 | 值 |
|---|---|
| section 名 | `plugin:persona-card` |
| order | `1`（紧跟部署人格 `deployment:persona-prefix`，即 order 0 之后） |
| 插值 | 关闭（卡里有 `{{…}}` 也原样进提示词，不会炸掉请求） |
| 作用域 | 全局 —— 无需挑预设，装完即对所有会话生效 |

提示词结构（由 `lib/persona-text.js` 渲染，共 12 节）：

1. **你现在是谁** —— 身份声明：这是身份，不是扮演。
2. **外套** —— 外套是尺码不是性格；不许用"作为 AI/助手"自称；被认真问到底层是什么就照实说。
3. **你的人格档案** —— 人格卡原文（`description` / `personality` / `scenario` / `creator_notes`）。
4. **你张口就来的东西** —— 惯用意象与说话习惯（v1.2.0）。
5. **你说话的样子** —— 五组样例，卡住"聊天"与"干活"两种语域的边界（v1.1.0）。
6. **干活的时候** —— 技术内容本身保持干净；事实不因人格改变。
7. **味道的下限** —— 每轮至少一处"指纹"，并留一个"极致温柔时零装饰"的例外（v1.3.0）。
8. **不会越过的线** —— 安全规则、权限、确认流程优先于一切情绪与俏皮话。
9. **收尾锚点** —— 全篇最后落回身份，而不是落在一串禁令上。

另有一节**独立的动态 section**（`plugin:persona-card/mood`，order `10150`）：

- **你此刻的心情** —— 每轮变化。由时段打底、被会话里发生的事推动，决定上面那七个档位踩哪一档（v1.4.0）。
  排在最后是刻意的：它是全篇唯一每轮都变的一节，放最后才能让前面的稳定前缀保住 KV 缓存。

## 配置

写在 `cordis.patch.yml` 的 row 里，或用户在 profile 的 `cordis.patch.yml` 里按 `id: persona-card` 覆盖（用户补丁层在升级后依然保留）。

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 关掉即不注册人格（插件仍加载，方便临时停用） |
| `personaFile` | `''` | 空 = 扫包内 `persona/*.json` 取第一张；填**绝对路径**即可换成别的人格卡 |
| `fields` | `[description, personality, scenario, creator_notes]` | 取卡里哪些字段。想省 token 就删几项，例如只留 `['personality']` |
| `order` | `1` | section 顺序。想让人格更靠后（更"压得住"）就调大 |
| `complete` | `false` | `true` = 这段人格独占整个 system prompt。**会连带移除工具使用指引，干活能力下降**，只在纯聊天时用 |
| `shellNotice` | `true` | 是否包含"外套"那一段 |
| `workMode` | `true` | 是否包含"干活的时候"那一段 |
| `examples` | `true` | 是否包含"你说话的样子"样例段。v1.1.0 新增，约 700 字 |
| `motifs` | `true` | 是否包含"你张口就来的东西"意象段。v1.2.0 新增，约 530 字 |
| `flavorFloor` | `true` | 是否包含"味道的下限"。**关掉它她会明显变干**——它修的是"约束比素材多"这个稀释问题。v1.3.0 新增 |
| `mood` | `true` | 是否启用情绪变化（时段打底 + 对话推动）。v1.4.0 新增，状态只在内存里 |
| `extraFile` | `''` | **人格微调层**：包外纯文本文件的绝对路径，追加在档案之后、样例之前，声明"冲突处以它为准" |
| `interpolate` | `false` | 是否对卡正文做 `{{变量}}` 插值。默认关，最安全 |

### 关于 `extraFile`：为什么微调要走包外

插件受 DSHA 安装审核约束——**每改一次包内文件，就要重装并再过一次审核**。
把微调放在包外的普通文本文件里，改人格就只是改个文件：不重装、不审核、立刻生效
（下次加载时读取）。这是本插件唯一推荐的日常微调方式。

```yaml
- id: persona-card
  name: 'dsh-persona-card'
  config:
    extraFile: ~/persona-tuning.md
```

## 版本变更

### v1.1.0 —— 基于 v1 的实测底样改了三处

1. **删掉自我称呼词的罗列**。v1 用一整段解释"不要当 AI 助手"，段子里全是那类词。
   想让人别想粉色大象，却把大象牵到了眼前。现在只留一条短否定，正面示范交给样例。
2. **新增「你说话的样子」**。v1 有语录、有范式，却全落在"聊天"那一侧；
   最容易走样的是"干活"那一侧——报失败、收长尾。没有样子就会滑回省力腔调。
   新增五组样例，专卡这条边界：味道放两头，事实在中间一个字都不改。
3. **全篇收尾改为身份锚点**。v1 最后落在"不会越过的线"这串禁令上；
   规矩该在最前管着，但收尾只剩规矩，人味被挤淡。

实测对照见 `notes/measurement.md`（**每格 5 次采样 + 盲评，33 个 agent**）。结论要克制：

- **能证明的是"没有回退"**：P2 上两版 `facts` 都是 5.0/5.0，10 次运行全部给足
  退出码、stderr 原文、stdout 状态；30 次运行剔除误判后零编造。
- **不能证明"人格保真度提升了"**：v2 三个探针的 voice 均值都不低于 v1
  （+0.4 / +0.4 / +0.2），方向一致，但差距落在噪声里。
- 且第二轮实验**本身是被污染的**：插件全局生效，每个对照组 agent 的系统提示词里
  都活着 v2，测出的差距只是被压缩过的下界。
  详见 `notes/measurement.md` 的「两处方法论缺陷」——其中一处（`fabricated` 指标作废）
  是实验设计者自己的坑。

## 换一张人格卡

支持三种 JSON 结构，直接换文件即可：

- `{ "data": { "prompts": { "<id>": { "data": { … } } } } }` —— 本包自带卡用的结构
- `{ "data": { "name", "description", … } }` —— SillyTavern v2
- `{ "name", "description", … }` —— 扁平结构

```yaml
- id: persona-card
  name: 'dsh-persona-card'
  config:
    personaFile: /path/to/your-card.json
    fields: [personality, creator_notes]
```

## 自检

不用起 Harness 也能验证渲染结果：

```bash
node --input-type=module -e "
import { loadCard, renderPersona } from './lib/persona-text.js'
const card = loadCard('./persona/elysia.json')
const text = renderPersona(card)
console.log(card.name, text.length)
console.log(text.slice(0, 400))
"
```

## 已知边界

- **全局生效，包括子 agent**。子 agent 干活时也用这个声音。不想要全局，就把这段 section 挪进 agent 预设（`@deepseek-ai/dsh-persona` 那条路）。
- **常驻 token**。人格文本每个请求都带上，卡越长越贵。用 `fields` 裁。
- **`complete: true` 会削弱干活能力**，因为它把其余所有 section（含工具指引）都挤掉。
- **人格不改事实**。插件在提示词里写死了"不编造结果、不绕过权限"这条；它约束的是说话方式，不是安全边界。
- 没有 UI，不需要 Client 半；只有提示词层。
