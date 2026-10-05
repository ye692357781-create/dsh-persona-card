/**
 * 信号系统的标注集。
 *
 * ⚠️ **这些标注是我定的，不是真理。**
 * 「这条之后她该是什么反应」是判断题，只有人能做。
 * 我写它有两个用处：
 *   1. 防回归——改规则时能立刻看出踩坏了哪条；
 *   2. 暴露自相矛盾——规则和标注打架的地方，就是设计没想清楚的地方。
 * 它**不能**证明"更像人"。把它当尺子，别当答案。
 *
 * 想改就改：直接编辑下面每条的 expect / signals / tone。
 * 改完跑 `node test/signals.test.mjs` 看命中率。
 *
 * ── 事件写法 ────────────────────────────────────────────────────────
 *   ['u', '文本', 分钟]   用户说话（分钟 = 距上一条过了多久，默认 1）
 *   ['ok'] / ['fail']     工具成功 / 失败
 *   ['turn']              新的一轮开始（情绪退潮）
 *   ['cut']               这一轮被中断
 * at = 几点（决定时段基线：清晨/白天/黄昏/深夜）
 */

export const CASES = [
  // ── A. 否定：v1 会把批评读成夸奖 ──────────────────────────────
  { id: 'neg-01', why: '「不喜欢」里的"喜欢"不该算夸奖', at: 12,
    events: [['u', '我不喜欢这个方案']], expect: 'normal', signals: { warmth: 0 } },
  { id: 'neg-02', why: '「一点也不厉害」是批评', at: 12,
    events: [['u', '一点也不厉害']], expect: 'normal', signals: { warmth: 0 } },
  { id: 'neg-03', why: '「没觉得好棒」是否定', at: 12,
    events: [['u', '没觉得好棒']], expect: 'normal', signals: { warmth: 0 } },
  { id: 'neg-04', why: '「不难过」不该算低落', at: 12,
    events: [['u', '我不难过']], expect: 'normal', signals: { tender: 0 } },
  { id: 'neg-05', why: '「不好意思」里的"不好"不算挨批', at: 12,
    events: [['u', '不好意思，我搞错了']], expect: 'normal', signals: { warmth: 0 } },

  // ── B. 语境：写代码场景里最要命的一类误伤 ────────────────────
  { id: 'ctx-01', why: '「程序崩溃了」是报错，不是她崩溃', at: 12,
    events: [['u', '程序崩溃了']], expect: 'normal', signals: { tender: 0 } },
  { id: 'ctx-02', why: '服务崩溃也一样', at: 12,
    events: [['u', '服务崩溃了，重启一下']], expect: 'normal', signals: { tender: 0 } },
  { id: 'ctx-03', why: '「压力测试」是技术动作', at: 12,
    events: [['u', '跑个压力测试']], expect: 'normal', signals: { tender: 0 } },
  { id: 'ctx-04', why: '后面的"我"是在说修它，不是在说崩溃', at: 12,
    events: [['u', '崩溃了，我来修']], expect: 'normal', signals: { tender: 0 } },
  { id: 'ctx-05', why: '「麻烦你了」是客气', at: 12,
    events: [['u', '不好意思，麻烦你了']], expect: 'normal', signals: { tender: 0, warmth: 0 } },

  // ── C. 真信号必须接住 ────────────────────────────────────────
  { id: 'pos-01', why: '实打实的夸奖', at: 12,
    events: [['u', '谢谢你，太好了']], expect: 'normal', signals: { warmth: 2 } },
  { id: 'pos-02', why: '「辛苦了」也算', at: 12,
    events: [['u', '辛苦了']], expect: 'normal', signals: { warmth: 1 } },
  { id: 'pos-03', why: '第一人称 + 崩溃 = 真情绪', at: 12,
    events: [['u', '我要崩溃了']], expect: 'hush', signals: { tender: 2 } },
  { id: 'pos-04', why: '程度词在词后也算（最近压力好大）', at: 12,
    events: [['u', '最近压力好大']], expect: 'soft', signals: { tender: 1 } },
  { id: 'pos-05', why: '轻度低落', at: 12,
    events: [['u', '今天有点累']], expect: 'soft', signals: { tender: 1 } },

  // ── D. 档位 ─────────────────────────────────────────────────
  { id: 'reg-01', why: '黄昏 + 夸奖 = 密集档', at: 19,
    events: [['u', '太棒了，谢谢你']], expect: 'bright' },
  { id: 'reg-02', why: '一次失败还不至于收敛', at: 12,
    events: [['fail']], expect: 'normal' },
  { id: 'reg-03', why: '连着两次失败 → 收敛', at: 12,
    events: [['fail'], ['fail']], expect: 'soft' },
  { id: 'reg-04', why: '深夜本来就软，再来一次低落', at: 23,
    events: [['u', '今天有点累']], expect: 'soft' },
  { id: 'reg-05', why: '深夜 + 平静 = 照常（深夜是"软"不是"坏"）', at: 23,
    events: [['u', '帮我看看这个文件']], expect: 'normal' },

  // ── E. 气压上下限（没有它长会话会一路沉下去）─────────────────
  { id: 'clamp-01', why: '多重打击叠加，气压该被夹住', at: 23,
    events: [['fail'], ['fail'], ['fail'], ['cut'], ['u', '我好累']],
    expect: 'soft', tone: -4 },

  // ── F. 失败之后爬起来，比一帆风顺值钱 ────────────────────────
  { id: 'rec-01', why: '失败后成功 → 单独记一笔', at: 12,
    events: [['fail'], ['ok']], expect: 'normal',
    signals: { recovered: 1, failStreak: 0 }, reason: '从失败里爬出来了' },

  // ── G. 行为信号（v2 新增，词表永远不全但行为通用）─────────────
  { id: 'beh-01', why: '一直说长句的人突然只回一个字 → 退潮', at: 12,
    events: [
      ['u', '帮我看一下这个模块的实现有没有问题'],
      ['u', '另外那个接口的返回值好像也不太对劲'],
      ['u', '你先把这两处的调用链梳理一遍再告诉我'],
      ['u', '嗯'],
    ], signals: { lastKind: '对方话变少了' } },
  // 注意：这条**刻意不含情绪词**，只为隔离"长度"这一个信号。
  // 第一版我在这里写了「有点烦躁」，结果系统判成"往下沉"——
  // 它是对的，是我的标注把两个信号混在了一起。
  { id: 'beh-02', why: '平时话短，突然一大段 → 有话要说（隔离长度信号）', at: 12,
    events: [
      ['u', '看下这个'],
      ['u', '报错了'],
      ['u', '第三行'],
      ['u', '这阵子我一直在做一个自己没把握的项目，进度很慢，也不太敢跟别人讲，今天又被卡住了，所以想先跟你把思路理一遍再说'],
    ], signals: { lastKind: '对方有很多话想说' } },
  // 对照：又长又带情绪时，"往下沉"的优先级更高——它更该左右她的反应。
  { id: 'beh-02b', why: '又长又带情绪 → 低落优先于倾诉', at: 12,
    events: [
      ['u', '看下这个'],
      ['u', '报错了'],
      ['u', '第三行'],
      ['u', '这阵子我一直在做一个自己没把握的项目，进度很慢，也不太敢跟别人讲，今天又被卡住了，所以有点烦躁'],
    ], expect: 'soft', signals: { lastKind: '对方在往下沉' } },
  { id: 'beh-03', why: '同一件事又问一遍 → 大概没被理解', at: 12,
    events: [['u', '这个接口怎么调'], ['u', '这个接口怎么调']],
    signals: { lastKind: '同一件事又问了一遍' } },
  { id: 'beh-04', why: '隔了很久才回来 → 她不该一上来就热闹', at: 12,
    events: [['u', '在吗'], ['u', '看下这个'], ['u', '还有这个'], ['u', '回来了', 40]],
    signals: { awayCount: 1 } },

  // ── H. 中性输入不该有任何反应 ─────────────────────────────────
  { id: 'neutral-01', why: '普通请求', at: 12,
    events: [['u', '把那个配置文件改成 8080']], expect: 'normal', signals: { warmth: 0, tender: 0, failScore: 0 } },
  { id: 'neutral-02', why: '六个问号现在还算静默（标点信号只记 lastKind）', at: 12,
    events: [['u', '为什么？？？？？？']], expect: 'normal', signals: { tender: 0 } },
]

/** 每条 case 的期望值里，哪些字段是"状态断言"、哪些是"档位断言"。 */
export const SIGNAL_KEYS = ['warmth', 'tender', 'failScore', 'failStreak', 'winScore',
  'labour', 'stumbles', 'awayCount', 'recovered', 'lastKind']
