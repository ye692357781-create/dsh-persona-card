# 待办

> 这个文件是给「下一次」准备的地方。
> 对话会翻过去，仓库不会。

---

## ✅ 已完成：建一个正式的 GitHub Release（2026-10-07 23:05）

**这一条以后不用再提醒了。** 当时想做的那件事：

**建一个正式的 GitHub Release。**

现在这个仓库**只有 tag，没有 Release**。所以：

```
releases/tag/v2.4.2   ← 能打开，但显示的是「Tag 页」
                        不是带更新说明、带附件的「Release 页」
```

用户 2026-10-06 22:08 说过：

> 「后面再说吧，下一次更新记得提醒我」

**所以下一次推新版本的时候，主动问一句：要不要顺手建个正式 Release？**

### 做完了（2026-10-07 23:05）

```
tag      v2.5.0        （commit 09f6b5f）
Release  id 405890358
页面     https://github.com/ye692357781-create/dsh-persona-card/releases/tag/v2.5.0
附件     dsh-persona-card-v2.5.0.zip    110624 字节
```

验过的三样：

```
Release 页（不带 token 打开）   HTTP 200
zip 直接下载                    HTTP 200   110624 字节，和本地字节数一致
页面标题                        "Release v2.5.0 —— …"  ← 是 Release 页，不是 Tag 页
```

**做法记下来，下次不用重新想**：token 只放进一个 600 权限的临时文件、只经
`http.extraheader` 传，绝不写进 argv / `.git/config` / remote URL；用完 `shred -u`。
**推完必须实测「不带 token 能不能打开」，不能只看 API 返回 200。**

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

## 另外一条：**不只是装包 —— 每次 App 启动都会掉**

⚠️ 这一条昨晚写窄了，第二天凌晨抓到更准的版本：

```
我写的「装包之后」    ❌ 条件说窄了
实际是               ✅ 每次 App 启动都可能重写 profile 的 package.json
                        被重写的那一刻，不属于它的层就被删掉
```

三次记录，一次比一次清楚：

```
10-06 21:39  装 v2.4.0   →  少了 persona-card 和 memento
10-06 21:54  装 v2.4.2   →  少了 memento
10-07 00:46  App 启动     →  又少了 persona-card 和 memento
                             package.json 改动时间 = 进程启动时间（同一秒）
```

**所以这不是偶发，是常态。每一次重开 App 之后都该查一遍。**

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

---

## ⏳ 还欠一次推送

**这一版的 TODO.md 更新只在本地**——推 v2.5.0 的时候这份改动还没写。

```
远端 main 停在   09f6b5f
本地 main 多了   这份 TODO.md 的改动（还没提交）
```

**下次拿到 token 的时候顺手带上就行，不用单独跑一趟。**

（token 用完就删了，所以现在推不了。**这是故意的**——它不该在机器上过夜。）
