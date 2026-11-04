# dsh-ember

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
[![install](https://img.shields.io/badge/install-dsh%20plugin%20add-4D6BFE?style=flat-square)](#安装--install)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

**推理等级变成滑块，完全权限变红，模型菜单里认得出你是谁。** 三件事，一个插件，不动任何官方组件。

**Reasoning effort becomes a slider; full access turns red; the model picker finally tells you where you are.** Three things, one plugin, no shipped component replaced.

![推理等级滑块停在 Max 档：三个档位 Low / High / Max 均匀排在轨道下方，Max 加粗高亮；轨道左侧铺着暗红渐变、散落着被甩出的方块余烬；右侧白热尾焰从旋钮球体根部向左喷出，根部比球体更宽，把球包住](assets/effort-slider-max-dark.png)

<p align="center"><sub>推理等级滑块 · Max 档（暗色主题）<br>Effort slider at the top rung · dark theme</sub></p>

---

## 为什么 / Why

DSH 的 composer 底部有两处可以更好用：

1. **完全权限是灰色的。** 「完全权限」意味着智能体能直接执行敏感操作 —— 删文件、跑命令、改系统。它和「仅可查看」用同一个颜色，视觉上没有任何区别。
2. **推理等级是一串菜单项。** 想从 Low 调到 High，要点开菜单、找到那一行、点它。档位越多找得越慢，而且看不出「现在在整条阶梯的哪个位置」。

3. **模型菜单里认不出自己在哪。** 分组标题没有任何样式，滚动起来不知道当前是哪家 provider；选中的模型只有一个 14px 的对勾，官方 CSS 里 `._9r0rkG_selected` 明确写着 `background:0 0`（透明）—— 扫一眼落不下点。

这个插件把第一处变红，把第二处变成滑块，把第三处补上辨识度。

DSH's composer has two spots that could read better:

1. **Full access is grey.** It permits destructive operations — deleting files, running commands, touching the system — yet it looks exactly like read-only.
2. **Effort is a list of menu rows.** Going from Low to High means opening a menu and hunting for the row. More rungs, more hunting, and no sense of where you sit on the ladder.
3. **The model picker gives you no bearings.** Group headings have no styling of their own, so once the list scrolls you lose track of which provider you are in; the selected row carries only a 14px check mark, and the shipped `._9r0rkG_selected` is explicitly `background:0 0`.

This plugin repaints the first, turns the second into a slider, and gives the third some bearings.

---

## 功能 / Features

### 1. 完全权限变红 / Full access in red

![完全权限变红：展开的权限菜单里「询问」「只读」保持中性灰，「完全权限」这一行连同盾牌图标变成主题红并带勾；下方 composer 里的权限触发器同样是红色](assets/full-access-red-dark.png)

- 「完全权限」的文字和盾牌图标都变成主题红
- **明暗主题都红**，各用 DSH 自带的危险色：亮色 `#ec1313`，暗色 `#f25a5a`
- 只在该预设被选中时红；切回「仅可查看」自动恢复原色
- 确认弹窗里的「启用完全权限」按钮**不会**被误染

- The label and the shield glyph both take the theme's danger colour
- **Red in both themes**, using DSH's own tokens: `#ec1313` light, `#f25a5a` dark
- Red only while that preset is current; switching back restores the neutral tone
- The confirmation dialog's “Enable full access” button is deliberately left alone

### 2. 推理等级滑块 / Reasoning effort slider

打开模型菜单，「推理等级」那一行下面**直接**就是滑块 —— 不用点进去：

```
┌──────────────────────────────┐
│ 模型        Deepseek-V4.1…  ›│
│ 推理等级                High ›│
│ [======|===============]     │  ← 滑块，停在当前档
│ Low        **High**       Max│  ← 档名当刻度，当前档加粗
└──────────────────────────────┘
```

- 档位**完全由上游下发决定**：读模型适配器报的 `efforts`，不写死
- **连续拖动，不是分段按钮**：滑块位置是浮点数，跟手走；拖动时只重画，松手才吸附到最近档并提交
- 1 / 2 / 3 / 4 / 6 档都验证过；只有 1 档时钉在右端并标 `aria-readonly`
- 拖动时刻度**即时高亮**（热更新）
- 键盘方向键 / Home / End 同样可用
- 写入走 `modelDirectories` 的 `select()` —— 与官方选择器同一个服务调用
- 每档在旋钮背后画各自的余烬尾焰：档位越高，尾焰越长越热

- Ladder length comes from the model adapter's own `efforts`, never hard-coded
- **Continuously draggable, not a row of segmented buttons**: the position is a
  float that follows the pointer; dragging only repaints, and the knob snaps to
  the nearest rung and commits on release
- 1 / 2 / 3 / 4 / 6 rungs verified; with a single rung the knob parks at the
  right end and the rail is marked `aria-readonly`
- The scale highlights live while dragging
- Arrow keys, Home and End work as well
- Writes through `modelDirectories` `select()` — the same service call the
  shipped picker makes
- Each rung paints its own ember plume behind the knob: higher rungs burn longer
  and hotter

### 3. 模型菜单可读性 / Model picker legibility

模型菜单按官方尺寸（手机上也要用），所以这里**不动宽度**，改的是两处辨识：

```
┌──────────────────────────────┐
│ 搜索模型…                    │
├──────────────────────────────┤  ← 分组标题：14px 加粗 + 细分隔线
│ PROVIDER 名                  │    滚动时吸顶，自带不透明底
│                              │
│ ▢ Model-A · x0.8             │
│ ▣ Model-B · x0.12          ● │  ← 选中行：10% 洗色 + 2px 边 + 同色圆点
└──────────────────────────────┘
```

- **分组标题**加粗加大（12px → 14px / 700），下方一条细分隔线；
  sticky 时用主题自带的 `--dsw-alias-menu-group-header-fill` 铺底，
  否则下一组的行会从标题底下穿过去
- **当前模型**是一行**扁平**的选中态，只有三样东西：电光蓝
  （`#0a84ff`）10% 透明度的一层洗色、2px 同色半透明边（55%）、模型名 600
- **没有渐变、没有高光、没有内阴影、没有光晕。** 这些是拟物化痕迹，
  叠在有色底上只会显得油腻；现代系统 UI 靠单一强调色 + 一层洗色 +
  一条干净的边来区分选中，不靠伪造的光影
- 原来的小对勾换成一个**同色实心圆点**（8px，`#0a84ff`，外圈一道 1px
  同色细线定边）。和边框同色相，所以「行被选中」与「点在这儿」是**一个信号**，
  不是两个颜色互相打架
- 圆点用 CSS 画，不是 `🟢` 字符 —— emoji 字形在桌面与手机字体上大小不一，
  画出来的点尺寸稳定
- **宽度不变、行高不变、节点不增删**，所以移动端布局和宿主自己的尺寸计算都不受影响

- Headings go bold and up a size with a rule beneath them, and get the theme's
  own `--dsw-alias-menu-group-header-fill` bed so rows do not scroll through
  the sticky title
- The selected row is a **flat** state built from exactly three things: a 10%
  wash of electric blue (`#0a84ff`), a 2px half-transparent edge of the same
  colour (55%), and a semibold name
- **No gradients, no highlights, no inner shadows, no glow.** Those are
  skeuomorphic tells; stacked over a tinted row they read as greasy. Modern
  system UI separates a selected state with one accent, one wash and one clean
  edge — not with faked light
- The shipped check mark becomes a **same-colour solid dot** (8px, `#0a84ff`,
  with a 1px hairline ring for definition). Sharing the accent with the row
  edge makes “this row is selected” and “the mark is here” **one signal**
  instead of two colours competing
- The dot is drawn in CSS rather than the `🟢` character, because emoji glyphs
  differ in size across desktop and mobile fonts
- **No width change, no row-height change, no nodes added or removed**, so the
  mobile layout and the host's own sizing are untouched

---

## 安装 / Install

从 GitHub 装：

```bash
dsh plugin add https://github.com/REALOIYO/dsh-ember
```

或者先克隆到本地，再指向那个目录：

```bash
git clone https://github.com/REALOIYO/dsh-ember
dsh plugin add F:/path/to/dsh-ember
```

装完**重启 DSH**。这是纯前端插件，没有服务端逻辑。

Install from GitHub, then **restart DSH**. It is browser-only; there is no
host-side logic.

---

## 兼容性 / Compatibility

| 项 | 要求 |
|---|---|
| DSH | `0.2.1-rc.3`（在 `rc.3` 上开发与验证） |
| 菜单 | `[role="menu"][aria-label="模型与推理等级"]` |
| 依赖服务 | `locale` |
| 平台 | Web（桌面端与局域网访问一致） |

模型菜单那部分用的是 `:has()` 与属性匹配，需要 Chromium 105+ 以上的选择器支持；
桌面端与局域网访问都是同一个内核，两处一致。

**为什么注入 DOM，而不是用槽位**

输入行里的模型选择器是 `conversation.input.model`，一个 `single` 槽位：

- 同 priority 重复注册**直接抛错**（`already has a registration`），想接管就得整体重写那份 79KB 的 `ModelSelect`（菜单、搜索、键盘导航、浮层定位、失败重试、toast）
- `single` 槽位也不能容纳第二个 child —— child 必须在父 entry 的 `children` 表里声明，而那张表属于官方包

菜单内部没有留给第三方的缝隙，所以走唯一不碰官方的路：**观察菜单，插入一个它自己没写过的元素**。

**Why DOM injection rather than a slot**

The composer model seat is a `single` slot: re-registering at the same priority
throws, so taking it over means reimplementing the whole 79KB ModelSelect. A
`single` slot also cannot host a second child — child slots are declared by the
parent entry's `children` table, which belongs to the shipped package. There is
no seam inside its popup, so the only route that leaves the host untouched is to
observe the menu and insert one element it did not author.

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

### 滑块：读服务、写服务

第一步是找到菜单。用它的**无障碍名**匹配，不用哈希类名：

```js
document.querySelectorAll('[role="menu"]')
  → aria-label 匹配 模型与推理等级 / Model and reasoning effort
```

哈希类名（如 `_9r0rkG_*`）每次构建都变，而 `aria-label` 是产品文案。

档位不是猜的，是**读模型适配器报的阶梯**：

```js
directory.store.getSnapshot()
→ snapshot.groups[i].models[j].reasoning.efforts
→ [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }, …]
```

`current.reasoningEffort` 指向当前档，数组顺序就是上游声明的顺序。这样一来
档位数与档名全都跟着上游走，上游加档不用改这个插件。

提交走 `directory.select()`：

```js
await directory.select({
  provider: current.provider,
  model: current.model,
  reasoningEffort: levelId,
});
```

传入的是完整的三元组，不是裸的档位 id —— provider 与 model 原样回填当前值，
只有 `reasoningEffort` 变化。

这是官方选择器用的同一个服务调用，插件不新开写入通道，也不点任何宿主节点。

**为什么要等存储确认**：`select()` 是异步的，快照在写入后仍会短暂回报旧档位。
如果立刻采纳它，旋钮会先吸附到新档、再弹回旧档 —— 所以本地记住「我要的是哪档」，
等上游追上来（或超时）之后再认账。

**为什么松手才提交**：拖动过程中只重画刻度与 `aria-valuetext`，不写数据。
一旦在 `pointermove` 里提交，一次拖动会打出十几次切换。

**为什么落点只算一次**：滑块几何由 `pct`（0..1）决定，不由档位数决定。
2 档和 6 档得到的是同一条轨道、同一条尾焰，只是刻度数量不同。

**只注入、不接管**：官方那两行（模型 / 推理等级）原样保留，只是在推理等级下方
多了一个本插件写的块。官方菜单自己怎么渲染、怎么定位、怎么处理键盘，完全没动。

---

## 已知边界 / Known limits

- **依赖 `aria-label` 文案判定完全权限。** 官方若改文案（如「完整权限」），红色会失效但不会误染。
  修正位置：`lib/client.js` 的 `FULL_ACCESS_LABELS`。
- **轨道宽度跟随菜单行**，档名过长时相邻刻度可能靠得较近（有 `title` 与 `aria-valuetext` 兜底）。
- **不处理 subagent 会话**（`available === false`），与官方选择器一致。
- 模型切换未纳入滑块 —— 用官方选择器或 `/model`。
- **菜单不可见时环境动画停止。** 宿主用 `display:none` / `visibility:hidden` / `opacity:0`
  或直接移除节点关闭菜单时，循环都会自停，并在菜单重新可见后自行恢复。
- **动画按需降级**：`prefers-reduced-motion: reduce` 时不隐藏 canvas（尾焰是视觉主体），
  而是降低绘制本身的抖动与亮度变化。
- **模型菜单的选中行样式靠属性推断。** 官方没给选中项留 `aria-checked` 之外的稳定标记，
  插件用三条选择器兜底（`[aria-checked="true"]` / `[data-selected]` / `[class*="_selected"]`）。
  哈希类名每次构建都会变，所以用 `class*=` 子串匹配；真正起作用的是 `_selected` 那条
  （官方定义为 `background:0 0`，即故意不给背景）。三条都不命中时**静默无效果**，不会误染。
- **分组标题靠 `data-menu-group-heading` 定位**，另有 `section[data-menu-group] > div:first-child`
  兜底。若官方改了属性名，结果是标题不再加粗，而不是样式串到别的元素上。
- **选中行没有任何阴影，这是设计决定而非限制。** 列表是 `overflow-y:auto`
  （隐式 `overflow-x:auto`），菜单本身又 `overflow:hidden`，向外画的阴影会被裁掉 ——
  也就是说这里做不出真阴影。用内阴影去伪造景深正是前几版「油腻」的来源，所以现在
  这一版干脆不用光影分层，改用「一层洗色 + 一条边」的扁平方案。
- **电光蓝是写死的 `#0a84ff`，不走主题 token。** 主题自带的 business blue 是 `#4176e6`，
  在 10% 洗色下亮度不足、在深色底上偏闷；所以这里刻意偏离主题色，换取两种主题下的
  一致可读性。若要跟随主题，把 `rgba(10,132,255,…)` 换回
  `var(--dsw-alias-state-business-primary)` 并调高 alpha。

---

## 开发 / Development

```bash
git clone https://github.com/REALOIYO/dsh-ember
cd dsh-ember
```

目录：

```
lib/index.js       loader 入口（空实现，dsh.client 声明才让宿主加载 client.js）
lib/client.js      全部前端逻辑：CSS 注入、权限染色、滑块组件、模型菜单样式
cordis.patch.yml   profile patch 层，插入一个 loader entry
docs/              探测报告与验证记录
```

离线验证台在 `_tmp/`（不在包内）：用真实 DOM 复现 composer 行，
不连 DSH 即可检查红色与滑块。11 项断言 + 5 种档位长度。

> 验证台是开发用的临时产物，不随包发布；装好插件后不需要它。

---

## 许可 / License

MIT
