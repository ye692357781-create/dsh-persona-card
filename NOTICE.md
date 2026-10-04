# 关于人格卡来源的说明

## 代码

本仓库的**代码**（`lib/`、`cordis.patch.yml`、`package.json`、`icon.svg`、`locale/`）
采用 MIT 许可，见 [LICENSE](LICENSE)。

## 人格卡

`persona/elysia.json` 是**第三方同人创作**，**不在 MIT 许可范围内**。

- 它随本仓库分发，只是为了"装上就能用"。
- 本仓库作者**不是它的创作者**，也不掌握其原始出处与授权信息。
- 角色及原始设定的一切权利，归其各自的权利人所有。
- 如果你是这张卡的作者，或权利相关方，希望它被移除或更正署名，
  请开一个 issue，会立刻处理。

## 你在使用前应该知道

如果你的用途是**个人、离线、本地**，这通常没有问题。

如果你打算**再分发、商用，或以任何方式公开传播**，请自行确认你有权这么做——
本仓库不对卡的部分提供任何担保。

插件本身是通用的：整张卡都可以替换。想换成你自己的卡：

```yaml
- id: persona-card
  name: 'dsh-persona-card'
  config:
    personaFile: /path/to/your-own-card.json
```

或者直接把 `persona/` 里的文件换掉。
