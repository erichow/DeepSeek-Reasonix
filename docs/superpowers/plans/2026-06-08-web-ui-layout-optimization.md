# Web UI 布局优化 实现计划

> **面向 AI 代理的工作者：** 使用 subagent-driven-development 或 executing-plans 逐任务实现。步骤使用复选框（`- [ ]`）跟踪进度。

**目标：** 合并顶栏三行（TitleBar/TabBar/MainHead）为单行 TopBar 40px，Composer 采用折叠模式默认显示为单行输入框，释放 ~130px 给对话区域。

**架构：**
- 删除 App.tsx 中内联的 `TitleBar` / `TabBar` / `MainHead` 三个函数，替换为新内联 `TopBar` 组件
- Composer 通过 `focused` 状态控制 hint 行和完整 foot 的显示/隐藏
- CSS Grid 从 4 行改为 3 行

**修改文件：**
- `dashboard/src/App.tsx` — 替换渲染逻辑，新增 TopBar 组件
- `dashboard/src/styles.css` — Grid、TopBar、Composer 折叠样式
- `dashboard/src/ui/composer.tsx` — 添加焦点状态控制

---

### 任务 1：CSS — Grid 布局、TopBar 样式、Composer 折叠

**文件：** `dashboard/src/styles.css`

- [ ] **步骤 1：修改 `.app` Grid 定义为 3 行**

替换 `.app` 的 `grid-template-rows` 和 `grid-template-areas`：

```css
/* 当前 */
.app {
  display: grid;
  grid-template-rows: 36px 36px 1fr 26px;
  grid-template-columns: 244px 1fr 320px;
  grid-template-areas:
    "title  title   title"
    "tabs   tabs    tabs"
    "side   main    ctx"
    "status status  status";
  height: 100%;
  background: var(--bg);
}

.app[data-ctx-collapsed="true"] {
  grid-template-columns: 244px 1fr 0;
}
.app[data-side-collapsed="true"] {
  grid-template-columns: 0 1fr 320px;
}
.app[data-ctx-collapsed="true"][data-side-collapsed="true"] {
  grid-template-columns: 0 1fr 0;
}
```

替换为：

```css
/* 新 */
.app {
  display: grid;
  grid-template-rows: 40px 1fr 26px;
  grid-template-columns: 244px 1fr 320px;
  grid-template-areas:
    "topbar topbar topbar"
    "side   main    ctx"
    "status status  status";
  height: 100%;
  background: var(--bg);
}

.app[data-ctx-collapsed="true"] {
  grid-template-columns: 244px 1fr 0;
}
.app[data-side-collapsed="true"] {
  grid-template-columns: 0 1fr 320px;
}
.app[data-ctx-collapsed="true"][data-side-collapsed="true"] {
  grid-template-columns: 0 1fr 0;
}
```

- [ ] **步骤 2：新增 `.topbar` 样式**

在 `/* ---------- APP SHELL ---------- */` 区域、`.app` 样式之后添加：

```css
/* ── TopBar (TitleBar + TabBar + MainHead 三合一) ── */
.topbar {
  grid-area: topbar;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  height: 40px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  min-width: 0;
  overflow: hidden;
}
.topbar .tbb-brand {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
  white-space: nowrap;
  padding: 0 4px;
  flex-shrink: 0;
}
.topbar .tbb-brand .mark {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--accent);
  display: inline-block;
}
.topbar .tbb-sep {
  color: var(--muted-2);
  margin: 0 2px;
}
.topbar .tbb-ws {
  color: var(--fg-2);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
  min-width: 0;
}
.topbar .tbb-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  color: var(--fg-2);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.topbar .tbb-tab:hover {
  background: var(--card-hover);
}
.topbar .tbb-tab[data-active="true"] {
  background: var(--accent-soft);
  color: var(--accent);
}
.topbar .tbb-tab .close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  opacity: 0.5;
}
.topbar .tbb-tab .close:hover {
  opacity: 1;
  background: var(--card-hover);
}
.topbar .tbb-tab-more {
  font-size: 11px;
  color: var(--muted-2);
  padding: 0 4px;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
}
.topbar .tbb-tab-more:hover {
  color: var(--fg);
}
.topbar .tbb-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10.5px;
  font-family: Geist Mono, monospace;
  background: var(--card);
  border: 1px solid var(--border);
  color: var(--muted);
  white-space: nowrap;
  flex-shrink: 0;
}
.topbar .tbb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
}
.topbar .tbb-btn:hover {
  background: var(--card-hover);
  color: var(--fg);
}
.topbar .tbb-btn[data-busy="true"] {
  color: var(--danger);
}
.topbar .tbb-btn[data-busy="true"]:hover {
  background: var(--danger-soft);
}
.topbar .tbb-grow {
  flex: 1;
  min-width: 4px;
}
```

- [ ] **步骤 3：修改 Composer padding 和 hint 行焦点控制**

找到 `.composer-wrap` 样式：

```css
/* 当前 */
.composer-wrap {
  padding: 12px 28px 18px;
  ...
}
```

替换为：

```css
.composer-wrap {
  padding: 4px 28px 8px;
  ...
}
```

找到 `.hint-row` 默认样式（~3100 行）：

```css
/* 当前 */
.hint-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px 6px;
  font-family: inherit;
  font-size: 14px;
  color: var(--muted-2);
}
```

替换为：

```css
.hint-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px 6px;
  font-family: inherit;
  font-size: 14px;
  color: var(--muted-2);
}
/* 折叠模式：默认隐藏 hint 行和 foot，聚焦时展开 */
.composer-wrap.collapsed .hint-row {
  display: none;
}
.composer-wrap.collapsed textarea {
  max-height: 24px;
  overflow: hidden;
}
.composer-wrap.collapsed .composer-foot {
  padding-top: 2px;
  padding-bottom: 2px;
}
.composer-wrap.expanded .hint-row {
  display: flex;
}
.composer-wrap.expanded textarea {
  max-height: 220px;
}
.composer-wrap.expanded .composer-foot {
  padding: 6px 8px 8px 8px;
}
```

- [ ] **步骤 4：修改移动端 `.app` Grid**

找到 `@media` 断点中的 `.app`（~7009 行）：

```css
/* 当前 */
@media ... {
  .app {
    grid-template-rows: 36px 1fr 0;
    grid-template-columns: 1fr;
    grid-template-areas:
      "title"
      "main"
      "status";
    height: 100dvh;
  }
```

替换为：

```css
@media ... {
  .app {
    grid-template-rows: 40px 1fr 0;
    grid-template-columns: 1fr;
    grid-template-areas:
      "topbar"
      "main"
      "status";
    height: 100dvh;
  }
```

- [ ] **步骤 5：验证**

运行：`npm run build:dashboard` 确认构建无错误

---

### 任务 2：Composer — 添加焦点折叠状态

**文件：** `dashboard/src/ui/composer.tsx`

- [ ] **步骤 1：在 `Composer` 函数中添加 `focused` 状态**

在 `useLang()`（如果有）或第一个 `useState` 之后添加：

```tsx
const [focused, setFocused] = useState(false);
```

- [ ] **步骤 2：在 textarea 上添加 focus/blur 处理**

找到 textarea JSX，添加 `onFocus` 和 `onBlur`：

```tsx
<textarea
  ref={textareaRef}
  value={draft}
  placeholder={t("composer.placeholder")}
  onChange={handleChange}
  onKeyDown={handleKeyDown}
  onFocus={() => setFocused(true)}
  onBlur={() => {
    // 只有内容为空时才折叠
    if (!draft.trim()) setFocused(false);
  }}
  onCompositionStart={() => {
    composingRef.current = true;
  }}
  onCompositionEnd={() => {
    composingRef.current = false;
    compositionEndedAtRef.current = Date.now();
  }}
  rows={2}
  disabled={disabled}
/>
```

- [ ] **步骤 3：在 composer-wrap div 上添加 collapsed/expanded className**

找到 composer-wrap 的 `<div className="composer-wrap">`（它在 return 中包裹 composer-inner），修改 className：

```tsx
<div className={`composer-wrap ${focused || draft.trim() ? 'expanded' : 'collapsed'}`}>
```

- [ ] **步骤 4：验证**

运行：`npm run build:dashboard` 确认构建无错误

---

### 任务 3：App.tsx — 删除旧三组件，创建 TopBar

**文件：** `dashboard/src/App.tsx`

- [ ] **步骤 1：删除 `TitleBar` 函数**

删除 `function TitleBar({...})` 函数体（从 `function TitleBar(` 到对应的闭合 `}` 之间的所有代码，约 L2324-2600）。

- [ ] **步骤 2：删除 `TabBar` 函数**

删除 `function TabBar({...})` 函数体（从 `function TabBar(` 到对应闭合 `}`，约 L2600-2655）。

- [ ] **步骤 3：删除 `MainHead` 函数**

删除 `function MainHead({...})` 函数体（从 `function MainHead(` 到对应闭合 `}`，约 L2660-2733）。

- [ ] **步骤 4：在删除位置插入新的 `TopBar` 函数**

```tsx
function TopBar({
  session,
  model,
  workspaceDir,
  busy,
  hasMessages,
  tabs,
  activeTabId,
  singleTab,
  sideOn,
  ctxOn,
  onToggleSide,
  onToggleCtx,
  onNewChat,
  onAbort,
  onCopy,
  onExport,
  onClear,
  onOpenCommands,
  onOpenSettings,
  onCloseTab,
  onSetActiveTab,
}: {
  session: string;
  model?: string;
  workspaceDir?: string;
  busy: boolean;
  hasMessages: boolean;
  tabs: { id: string; workspaceDir?: string }[];
  activeTabId: string;
  singleTab: boolean;
  sideOn: boolean;
  ctxOn: boolean;
  onToggleSide: () => void;
  onToggleCtx: () => void;
  onNewChat: () => void;
  onAbort: () => void;
  onCopy: () => void;
  onExport: () => void;
  onClear: () => void;
  onOpenCommands: () => void;
  onOpenSettings: () => void;
  onCloseTab: (id: string) => void;
  onSetActiveTab: (id: string) => void;
}) {
  useLang();
  const [menuOpen, setMenuOpen] = useState(false);
  const moreWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moreWrapRef.current && !moreWrapRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const wsLabel = workspaceDir
    ? workspaceDir.split(/[\\/]/).pop() || "workspace"
    : session || "—";

  // 多 Tab 处理：显示前 3 个，多余折叠
  const MAX_VISIBLE_TABS = 3;
  const visibleTabs = singleTab ? [] : tabs.slice(0, MAX_VISIBLE_TABS);
  const hiddenCount = singleTab ? 0 : Math.max(0, tabs.length - MAX_VISIBLE_TABS);

  return (
    <header className="topbar">
      {/* 左侧：sidebar toggle + brand */}
      <button
        type="button"
        className="iconbtn"
        data-on={sideOn}
        title={localizeShortcutText(t("app.titlebar.sidebar"))}
        onClick={onToggleSide}
        style={{ flexShrink: 0 }}
      >
        <I.panel_l size={14} />
      </button>

      <div className="tbb-brand">
        <span className="mark" />
        <span>Reasonix</span>
      </div>

      <span className="tbb-sep">/</span>
      <span className="tbb-ws" title={workspaceDir ?? wsLabel}>
        {wsLabel}
      </span>

      {/* 多 Tab pills */}
      {visibleTabs.map((t) => {
        const tabWs = t.workspaceDir ?? "";
        const label = tabWs.split(/[\\/]/).pop() || "workspace";
        return (
          <span
            key={t.id}
            className="tbb-tab"
            data-active={t.id === activeTabId}
            onClick={() => onSetActiveTab(t.id)}
          >
            {label}
            {!singleTab ? (
              <span
                className="close"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(t.id);
                }}
              >
                <I.x size={10} />
              </span>
            ) : null}
          </span>
        );
      })}
      {hiddenCount > 0 ? (
        <span className="tbb-tab-more" title={t("app.titlebar.more")}>
          ▸ {hiddenCount} more
        </span>
      ) : null}

      <span className="tbb-grow" />

      {/* 模型 pill */}
      {model ? (
        <span className="tbb-pill">
          <I.brain size={10} />
          {model}
        </span>
      ) : null}

      {/* 操作按钮 */}
      <button
        type="button"
        className="tbb-btn"
        onClick={onCopy}
        disabled={!hasMessages}
        title={t("app.titlebar.copyMd")}
      >
        <I.copy size={13} />
      </button>
      <button
        type="button"
        className="tbb-btn"
        onClick={onExport}
        disabled={!hasMessages}
        title={t("app.titlebar.exportMd")}
      >
        <I.download size={13} />
      </button>
      <button
        type="button"
        className="tbb-btn"
        onClick={onNewChat}
        title={t("app.header.newChat")}
      >
        <I.plus size={14} />
      </button>
      {busy ? (
        <button
          type="button"
          className="tbb-btn"
          data-busy="true"
          onClick={onAbort}
          title={t("app.header.abort")}
        >
          <I.stop size={14} />
        </button>
      ) : null}

      {/* 更多菜单 */}
      <div ref={moreWrapRef} style={{ position: "relative" }}>
        <button
          type="button"
          className="tbb-btn"
          title={t("app.titlebar.more")}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <I.more size={14} />
        </button>
        {menuOpen ? (
          <div
            className="popup"
            style={{ top: "calc(100% + 6px)", right: 0, left: "auto", bottom: "auto", width: 200 }}
          >
            <div className="popup-list">
              <div className="popup-item" onClick={() => { onOpenCommands(); setMenuOpen(false); }}>
                <span className="ico"><I.search size={12} /></span>
                <div className="nm"><span>{t("app.titlebar.commandPalette")}</span></div>
                <span className="kb"><Shortcut keys={["mod", "K"]} /></span>
              </div>
              <div className="popup-item" onClick={() => { onOpenSettings(); setMenuOpen(false); }}>
                <span className="ico"><I.cog size={12} /></span>
                <div className="nm"><span>{t("app.titlebar.settings")}</span></div>
                <span className="kb"><Shortcut keys={["mod", ","]} /></span>
              </div>
              <div className="popup-sep" />
              <div className="popup-item" onClick={() => { onClear(); setMenuOpen(false); }}>
                <span className="ico"><I.x size={12} /></span>
                <div className="nm"><span>{t("app.titlebar.clearChat")}</span></div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* 右侧面板切换 */}
      <button
        type="button"
        className="iconbtn"
        data-on={ctxOn}
        title={t("app.titlebar.contextPanel")}
        onClick={onToggleCtx}
        style={{ flexShrink: 0 }}
      >
        <I.panel_r size={14} />
      </button>
    </header>
  );
}
```

- [ ] **步骤 5：修改 `TabRuntime` 的 return，替换三行 `<TitleBar>` / `<TabBar>` / `<MainHead>` 为一行 `<TopBar>`**

在 `TabRuntime` 的 return 中（~1859-1915），找到：

```tsx
<TitleBar
  session={session}
  model={state.settings?.model}
  sideOn={!sideCollapsed}
  ctxOn={!ctxCollapsed}
  onToggleSide={onToggleSide}
  onToggleCtx={onToggleCtx}
  onOpenCommands={() => palette.setOpen(true)}
  onOpenSettings={() => openSettingsAt("general")}
  onCopy={conversationCopy}
  onExport={exportConversation}
  onClear={() => dispatch({ t: "clear" })}
  hasMessages={state.messages.length > 0}
  mobileSideOpen={mobileSideOpen}
  onToggleMobileSide={onToggleMobileSide}
/>

<TabBar
  tabs={tabsList}
  activeId={activeTabId}
  setActive={setActiveTabId}
  onClose={(id) => {
    if (tabsList.length <= 1) return;
    invoke("rpc_send", {
      line: JSON.stringify({ cmd: "tab_close", tabId: id }),
    }).catch((err) => console.error("tab_close failed", err));
  }}
  onNew={onNewTab}
  singleTab={tabsList.length <= 1}
/>
```

以及之后的 `<MainHead ...>`，全部替换为一行的：

```tsx
<TopBar
  session={session}
  model={state.settings?.model}
  workspaceDir={state.settings?.workspaceDir}
  busy={state.busy}
  hasMessages={state.messages.length > 0}
  tabs={tabsList}
  activeTabId={activeTabId}
  singleTab={tabsList.length <= 1}
  sideOn={!sideCollapsed}
  ctxOn={!ctxCollapsed}
  onToggleSide={onToggleSide}
  onToggleCtx={onToggleCtx}
  onNewChat={newChat}
  onAbort={abort}
  onCopy={conversationCopy}
  onExport={exportConversation}
  onClear={() => dispatch({ t: "clear" })}
  onOpenCommands={() => palette.setOpen(true)}
  onOpenSettings={() => openSettingsAt("general")}
  onCloseTab={(id) => {
    if (tabsList.length <= 1) return;
    invoke("rpc_send", {
      line: JSON.stringify({ cmd: "tab_close", tabId: id }),
    }).catch((err) => console.error("tab_close failed", err));
  }}
  onSetActiveTab={setActiveTabId}
/>
```

- [ ] **步骤 6：验证**

运行：`npm run build:dashboard` 确认构建无错误

---

### 任务 4：构建并验证

- [ ] **步骤 1：完整构建 dashboard**

```bash
npm run build:dashboard
```
预期：exit 0，生成 `dashboard/dist/app.js`

- [ ] **步骤 2：重启 dev 服务器验证**

```bash
npm run dev
```
打开仪表盘 URL，确认：
- 顶部只有一行 40px 的工具条，没有多余的行
- Composer 默认显示为单行输入框
- 点击输入框展开显示 hint 行和完整 foot
- 失焦且内容为空时折叠回单行
- Sidebar / Context Panel 切换正常
