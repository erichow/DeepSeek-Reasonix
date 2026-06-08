# Web UI 布局优化设计

## 问题

Dashboard Web UI 固定高度「chrome」元素过多（TitleBar + TabBar + MainHead + Composer + StatusBar ≈ 308px），导致中间对话区域（Thread）仅占 viewport 的 65%，需要频繁滚动才能查看对话内容。

## 方案 C：极端压缩

合并顶栏三行为单行，Composer 采用折叠模式。

### 1. 顶栏三合一

**删除** `TitleBar` / `TabBar` / `MainHead` 三个独立组件，替换为单个 `<TopBar>` 组件。

**TopBar 布局 (40px):**

```
┌───────────────────────────────────────────────────────── 40px ─┐
│ ☰  Reasonix  /  ws-name  [🧠 flash]  [📋][⬇]  [+] [⏹]  ⋮ │
└────────────────────────────────────────────────────────────────┘
```

| 元素 | 来源 | 说明 |
|------|------|------|
| `☰` | TitleBar 的 sidebar toggle | 侧边栏切换 |
| `Reasonix` | TitleBar 的 brand | 品牌名 |
| `ws-name` | TabBar + MainHead | 当前工作空间名称（Tab label） |
| `[🧠 flash]` | MainHead 的 model pill | 当前模型 |
| `[📋]` | MainHead 的 copy 按钮 | 图标化，去掉文字 |
| `[⬇]` | MainHead 的 export 按钮 | 图标化，去掉文字 |
| `[✚]` | MainHead 的 new chat 或 TabBar 的 + | 新建会话 |
| `[⏹]` | MainHead 的 abort 按钮 | 仅在 busy 时显示 |
| `⋮` | TitleBar 的 more 菜单 | 含命令面板 / 设置 / 主题 / 清除对话 |

**Tab 切换处理：**
- 单 Tab：不显示 Tab bar，只显示工作空间名
- 多 Tab：以 inline pill 显示在品牌名右侧；超过 3 个折叠为 `ws-name ▸ 2 more`

### 2. Composer 折叠模式

**默认状态 (collapsed, ~42px):**

```
┌──────────────────────────────────────────────────────┐
│  向 Reasonix 发送消息...                            │ ~24px
├──────────────────────────────────────────────────────┤
│ 🧠 flash·high ▾                              [➤]   │ ~18px
└──────────────────────────────────────────────────────┘
```

单行输入框 + 模型选择行 + 发送按钮。

**聚焦状态 (expanded, ~110px):**

```
┌──────────────────────────────────────────────────────┐
│  / 命令 · @ 文件 · ⌘K 调色板         [review]      │ ← hint 行
├──────────────────────────────────────────────────────┤
│                                                      │
│  向 Reasonix 发送消息...                             │ ← textarea
│                                                      │
├──────────────────────────────────────────────────────┤
│ 📎  🖼️  /  @                    🧠 flash·high ▾ [➤]│ ← foot
└──────────────────────────────────────────────────────┘
```

**焦点行为：**
- 失焦且内容为空 → 折叠回默认状态
- 聚焦 → 展开显示 hint 行 + 完整 foot
- 有内容时保持展开状态

### 3. CSS Grid 调整

```diff
- grid-template-rows: 36px 36px 1fr 26px;
+ grid-template-rows: 40px 1fr 26px;

  grid-template-areas:
-   "title  title   title"
-   "tabs   tabs    tabs"
-   "side   main    ctx"
-   "status status  status";
+   "topbar topbar topbar"
+   "side   main    ctx"
+   "status status  status";
```

### 4. 变更清单

| 文件 | 操作 |
|------|------|
| `dashboard/src/styles.css` | `.app` grid 修改；新增 `.topbar` 样式；`.composer-wrap` padding 压缩；`.hint-row` 焦点控制样式；移动端断点适配 |
| `dashboard/src/App.tsx` | 删除内联 `TitleBar` / `TabBar` / `MainHead` 函数和渲染；添加新的内联 `TopBar` 组件；TabRuntime 的 return 中替换渲染 |
| `dashboard/src/ui/composer.tsx` | 添加 `focused` 状态控制；className 切换 `collapsed`/`expanded` |

### 5. 预期效果

| 指标 | 优化前 | 优化后 | 变化 |
|------|--------|--------|------|
| Title + Tab + Main | 122px | 40px | **-82px** |
| Composer | ~160px | ~42/110px | **-50~118px** |
| 固定 chrome 合计 | ~308px | ~108~176px | **-132~200px** |
| Thread 可用高度 (900px) | ~592px | ~724~792px | **+22~34%** |

### 6. 风险与注意事项

- **Composer 折叠行为变化较大** — 用户需要习惯聚焦展开的模式
- **多 Tab 切换的 UX** — 折叠后的 tab 切换入口需要清晰
- **与已有设置/规则的兼容** — TopBar 的 `⋮` 菜单需包含设置入口，确保不丢失功能
- **移动端适配** — 移动端 grid 已经是单列，TopBar 需要保留汉堡菜单入口
