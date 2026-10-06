# 待办

> 这个文件是给「下一次」准备的地方。
> 对话会翻过去，仓库不会。

---

## 下一次更新时要提醒他的事

**建一个正式的 GitHub Release。**

现在这个仓库**只有 tag，没有 Release**。所以：

```
releases/tag/v2.4.2   ← 能打开，但显示的是「Tag 页」
                        不是带更新说明、带附件的「Release 页」
```

用户 2026-10-06 22:08 说过：

> 「后面再说吧，下一次更新记得提醒我」

**所以下一次推新版本的时候，主动问一句：要不要顺手建个正式 Release？**

建的话需要：

```
一把临时 token（Contents: Read and write，只勾这个仓库）
用完立刻撤销 —— 老规矩：他撤完，我实测 401
```

Release 页该写什么（已经想好了，到时候直接用）：

- 标题：版本号 + 一句话（例如 `v2.5.0 —— 一句话说清这一版改了什么`）
- 正文：照 `README.md` 的「版本变更」那一节，取这一版的部分
- 附件：把打包好的 zip 传上去（这样别人不用 clone 也能下载）

---

## 另外一条：装包之后的老问题

**每次在 DSHA 里装新包，`dsh.profile.bundles` 会被重写，把不属于这个包的层删掉。**

2026-10-06 当晚出现过两次：

```
21:39  装 v2.4.0  →  清单里少了 persona-card 和 memento
21:54  装 v2.4.2  →  清单里少了 memento
```

**另一条同时出现的**：装完之后 `card` 会回到包里声明的默认值
（公开包的默认是 `elysia`），需要重新改回想要的那张。

**所以装完包之后，第一件事是查这三样，不是查功能：**

```bash
# ① 挂载清单里该在的都在吗
python3 -c "import json;print(json.load(open('/root/.dsh/profiles/web/package.json'))['dsh']['profile']['bundles'])"

# ② card 是哪一张
grep -o "card: '[a-z]*'" /root/.dsh/plugin-src/dsh-persona-card/cordis.patch.yml | head -1

# ③ 人格那两段有没有真的注入（最直接的一条：看当前这一轮的提示词里有没有它们）
```
