# dsh-ui-refresh

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
[![install](https://img.shields.io/badge/install-dsh%20plugin%20add-4D6BFE?style=flat-square)](#安装--install)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

**推理等级变成滑块，完全权限变红。** 两件事，一个插件，不动任何官方组件。

**Reasoning effort becomes a slider; full access turns red.** Two things, one plugin, no shipped component replaced.

---

## 为什么 / Why

DSH 的 composer 底部有两处可以更好用：

1. **完全权限是灰色的。** 「完全权限」意味着智能体能直接执行敏感操作 —— 删文件、跑命令、改系统。它和「仅可查看」用同一个颜色，视觉上没有任何区别。
2. **推理等级是一串菜单项。** 想从 Low 调到 High，要点开菜单、找到那一行、点它。档位越多找得越慢，而且看不出「现在在整条阶梯的哪个位置」。

这个插件把第一处变红，把第二处变成滑块。

DSH's composer has two spots that could read better:

1. **Full access is grey.** It permits destructive operations — deleting files, running commands, touching the system — yet it looks exactly like read-only.
2. **Effort is a list of menu rows.** Going from Low to High means opening a menu and hunting for the row. More rungs, more hunting, and no sense of where you sit on the ladder.

This plugin repaints the first and turns the second into a slider.

---

## 功能 / Features

### 1. 完全权限变红 / Full access in red

- 「完全权限」的文字和盾牌图标都变成主题红
- **明暗主题都红**，各用 DSH 自带的危险色：亮色 `#ec1313`，暗色 `#f25a5a`
- 只在该预设被选中时红；切回「仅可查看」自动恢复原色
- 确认弹窗里的「启用完全权限」按钮**不会**被误染

- The label and the shield glyph both take the theme's danger colour
- **Red in both themes**, using DSH's own tokens: `#ec1313` light, `#f25a5a` dark
- Red only while that preset is current; switching back restores the neutral tone
- The confirmation dialog's “Enable full access” button is deliberately left alone

### 2. 推理等级滑块 / Reasoning effort slider

- 滑块档位**完全由上游下发决定**，不写死
- 1 / 2 / 3 / 4 / 6 档都验证过；档数 < 2 时自动让位给官方选择器
- 拖动时实时预览档位名，**松手才提交**，不会一路刷请求
- 键盘方向键 / Home / End 同样可用
- **官方模型选择器原样保留** —— 滑块是新增控件，不是替换
- `/model` 命令照常可用

- The ladder is **entirely host-driven**, nothing hard-coded
- Verified against 1 / 2 / 3 / 4 / 6 rungs; below 2 it steps aside for the shipped picker
- Dragging previews the rung name; **the write happens on release**, so a drag is not a request per pixel
- Arrow keys, Home and End work as well
- **The shipped model selector is untouched** — this adds a control, it does not replace one
- `/model` keeps working

---

## 安装 / Install

```bash
dsh plugin add dsh-ui-refresh
```

也可以从源码装：

```bash
dsh plugin add F:/path/to/dsh-ui-refresh
```

装完**重启 DSH**。这是纯前端插件，没有服务端逻辑。

Install, then **restart DSH**. It is browser-only; there is no host-side logic.

---

## 兼容性 / Compatibility

| 项 | 要求 |
|---|---|
| DSH | `0.2.1-rc.3`（在 `rc.3` 上开发与验证） |
| 槽位 | `conversation.input.right`（`list` / `session`） |
| 依赖服务 | `slots`、`locale`、`modelDirectories` |
| 平台 | Web（桌面端与局域网访问一致） |

**为什么是 `conversation.input.right` 而不是 `dock`**

`conversation.input.dock` 在输入框**上方**，是一整行；真正的输入行在它下面。
`conversation.input.right` 与官方模型选择器**同一行**，且官方先渲染它、再渲染模型选择器：

```js
jsxs("div", { className: standardControls, children: [
  renderSlot("conversation.input.right", {}),
  renderSlot("conversation.input.model", { locked })
]})
```

所以滑块会出现在模型选择器左边，贴着它，这正是想要的落点。

**为什么不去 shadow 官方组件**

`single` 槽位在同 `priority` 重复注册会直接抛错：

```js
if (occupant) throw new Error(`single slot "${name}" already has a registration
  at priority ${priority} — register at a different priority to shadow it (lowest renders)`)
```

换 `priority: -1` 确实能遮蔽，但代价是**整个 `ModelSelect` 由本插件重写** —— 那份实现含搜索框、
方向键导航、`Escape` / `Shift+Tab` 焦点管理、浮层定位、失败重试与 toast。为一个滑块重写它不划算，
所以选择新增 list id。

---

## 实现要点 / How it works

### 红色：属性标记 + 一条 CSS

官方触发器渲染时用的是：

```css
.trigger      { color: var(--dsw-alias-label-secondary) }   /* 灰 */
.triggerIcon  { display: inline-flex }                       /* 无 color，继承 */
```

`triggerIcon` 不写 `color`，盾牌 `<svg>` 用 `currentColor` 描边 —— 所以**给按钮上色，盾牌跟着变**。

插件用 `MutationObserver` 监听，当触发器同时满足「`aria-label` 含访问模式」和「含完全权限文案」时打上
`data-dsh-full-access`，再配一条规则：

```css
[data-dsh-full-access]{ color: var(--dsw-alias-state-error-primary) !important }
[data-dsh-full-access] svg{ color: inherit !important }
```

`--dsw-alias-state-error-primary` 在主题里本来就分开放（亮色 → `red-600`，暗色 → `red-400`），
所以**不用自己挑色就自动跟随明暗**。预设切走时属性被移除，颜色自己回来。

判据故意从严：既要 `aria-label` 像触发器、又要含完全权限文案，两个条件都满足才动手 ——
官方哪天改了文案，结果是「不变红」而不是「染错按钮」。

### 滑块：`useSyncExternalStore` + 松手提交

从 `conversation.input.right` 的 `inject` 面拿到的是与官方选择器**同一套**：

```js
{ directory: ModelDirectory.store,   // 快照，含 current / groups / status
  load,                              // 触发目录加载
  select }                           // 提交 { provider, model, reasoningEffort }
```

档位从 `model.reasoning.efforts` 读，当前值用官方同款表达式：

```js
current.reasoningEffort ?? reasoning.defaultEffort
```

`defaultEffort === undefined` 时补一个「默认」档，与官方选择器一致。

提交走 `select()`，与官方点击菜单项是同一条写入路径 —— 不点 DOM，不另开通道。

**为什么松手才提交**：`ModelDirectory.select` 没有节流，`input` 事件逐像素触发，
每一档都会打一次 `session.selectModel`。所以拖动只更新本地 `draft`，
在 `pointerup` / `keyup` / `blur` 时才真正提交。

---

## 已知边界 / Known limits

- **依赖 `aria-label` 文案判定完全权限。** 官方若改文案（如「完整权限」），红色会失效但不会误染。
  修正位置：`lib/client.js` 的 `FULL_ACCESS_LABELS`。
- **滑块宽度固定 74px**，六档时档位名可能截断（有 `title` 与 `aria-valuetext` 兜底）。
- **不处理 subagent 会话**（`available === false`），与官方选择器一致。
- 模型切换未纳入滑块 —— 用官方选择器或 `/model`。

---

## 开发 / Development

```bash
git clone https://github.com/REALOIYO/dsh-ui-refresh
cd dsh-ui-refresh
```

目录：

```
lib/index.js       loader 入口（空实现，dsh.client 声明才让宿主加载 client.js）
lib/client.js      全部前端逻辑：CSS 注入、权限染色、滑块组件
cordis.patch.yml   profile patch 层，插入一个 loader entry
docs/              探测报告与验证记录
```

离线验证台在 `_tmp/`（不在包内）：用真实 DOM 复现 composer 行，
不连 DSH 即可检查红色与滑块。11 项断言 + 5 种档位长度。

---

## 许可 / License

MIT
