# `/thinking` 命令实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 新增 `/thinking <on|off>` 命令，控制 DeepSeek 模型的 `extra_body.thinking.type` 开关。`off` 时还必须在 client 层自动剥离 `reasoning_effort` 以避免 API 报错。

**架构：** 遵循 `/effort` 的成熟模式——Loop 实例字段 + `configure()` + config.json 持久化。`thinkingOverride` 在 `streaming.ts` 和 `loop.ts` 的模型调用处替换 `thinkingModeForModel(model)`。关键约束在 `src/client.ts` 的 `buildPayload()` 中保障。

**技术栈：** TypeScript, DeepSeek API (extra_body.thinking.type), vitest

---

## 文件改动总览

| 文件 | 职责 |
|---|---|
| `src/loop.ts` | 新增 `thinkingOverride` 字段到 `CacheFirstLoopOptions`、`ReconfigurableOptions`、`CacheFirstLoop` 类 + `configure()` |
| `src/loop/streaming.ts` | `StreamModelOptions` 新增 `thinkingOverride`，调用 client 时使用它 |
| `src/client.ts` | `buildPayload()` 中当 `thinking: "disabled"` 时剥离 `reasoning_effort` |
| `src/config.ts` | 新增 `loadThinkingOverride` / `saveThinkingOverride` |
| `src/cli/ui/slash/commands.ts` | 注册 `/thinking` 命令 spec |
| `src/cli/ui/slash/handlers/model.ts` | 新增 `thinking` handler |
| `src/tools/subagent.ts` | child loop 传入 `thinkingOverride` |
| `src/i18n/EN.ts` | 新增 i18n 字符串 |
| `src/i18n/types.ts` | 新增 thinking 相关类型 |
| `tests/config.test.ts` | 测试 `loadThinkingOverride` / `saveThinkingOverride` |

---

### 任务 1：`src/loop.ts` — 核心状态

**文件：** 修改 `src/loop.ts`

- [ ] **步骤 1：`CacheFirstLoopOptions` 新增 `thinkingOverride`**

找到 `CacheFirstLoopOptions` 接口（约 line 96），在 `reasoningEffort` 后面添加：

```ts
thinkingOverride?: "enabled" | "disabled";
```

- [ ] **步骤 2：`ReconfigurableOptions` 新增 `thinkingOverride`**

找到 `ReconfigurableOptions` 接口（约 line 120），在 `reasoningEffort` 后面添加：

```ts
thinkingOverride?: "enabled" | "disabled";
```

- [ ] **步骤 3：`CacheFirstLoop` 类声明新字段**

在类 body 中 `reasoningEffort` 字段后面添加：

```ts
thinkingOverride?: "enabled" | "disabled";
```

- [ ] **步骤 4：构造函数中初始化**

找到构造函数（约 line 223），在 `this.reasoningEffort = ...` 后面添加：

```ts
this.thinkingOverride = opts.thinkingOverride;
```

- [ ] **步骤 5：`configure()` 方法处理新字段**

找到 `configure()` 方法（约 line 426），在 `reasoningEffort` 处理后面添加：

```ts
if (opts.thinkingOverride !== undefined) this.thinkingOverride = opts.thinkingOverride;
```

- [ ] **步骤 6：stream 路径使用 thinkingOverride**

找到 stream 路径（约 line 904-919），将：

```ts
thinking: thinkingModeForModel(callModel),
```

改为：

```ts
thinking: this.thinkingOverride ?? thinkingModeForModel(callModel),
```

同时也检查 chat 路径（约 line 919-925）做同样的替换。

- [ ] **步骤 7：运行类型检查**

```bash
npx tsc --noEmit 2>&1 | grep -v PlanPanel
```
预期：无新增错误

---

### 任务 2：`src/loop/streaming.ts` — 流式调用入口

**文件：** 修改 `src/loop/streaming.ts`

- [ ] **步骤 1：`StreamModelOptions` 新增 `thinkingOverride`**

找到 `StreamModelOptions` 接口，在 `turn` 前面添加：

```ts
thinkingOverride?: "enabled" | "disabled";
```

- [ ] **步骤 2：解构新参数**

解构行添加：

```ts
const { client, model, messages, toolSpecs, signal, reasoningEffort, maxTokens, turn, thinkingOverride } = opts;
```

- [ ] **步骤 3：调用 client 时使用 thinkingOverride**

将：

```ts
thinking: thinkingModeForModel(model),
```

改为：

```ts
thinking: thinkingOverride ?? thinkingModeForModel(model),
```

- [ ] **步骤 4：运行类型检查**

```bash
npx tsc --noEmit 2>&1 | grep -v PlanPanel
```
预期：无新增错误

---

### 任务 3：`src/client.ts` — 请求层安全剥离

**文件：** 修改 `src/client.ts`

- [ ] **步骤 1：`buildPayload()` 中保护 `reasoning_effort`**

找到 `buildPayload()` 方法中的这段代码（约 line 234-236）：

```ts
if (opts.reasoningEffort) {
  payload.reasoning_effort = opts.reasoningEffort;
}
```

改为：

```ts
if (opts.reasoningEffort && opts.thinking !== "disabled") {
  payload.reasoning_effort = opts.reasoningEffort;
}
```

**为什么：** DeepSeek API 在 `thinking: "disabled"` 时不允许同时发送 `reasoning_effort`，否则报错。这是最底层的安全保障。

- [ ] **步骤 2：添加注释说明**

在改动上一行添加注释：

```ts
// #thinking-off: reasoning_effort conflicts with thinking:disabled — DeepSeek API rejects the combo.
```

- [ ] **步骤 3：运行类型检查**

```bash
npx tsc --noEmit 2>&1 | grep -v PlanPanel
```
预期：无新增错误

---

### 任务 4：`src/config.ts` — 持久化

**文件：** 修改 `src/config.ts`

- [ ] **步骤 1：添加类型定义**

在 `ReasoningEffort` 类型附近添加：

```ts
/** `undefined` = auto-detect by model name (existing behavior). */
export type ThinkingOverride = "enabled" | "disabled";
```

- [ ] **步骤 2：添加 `loadThinkingOverride`**

```ts
export function loadThinkingOverride(path: string = defaultConfigPath()): ThinkingOverride | undefined {
  const v = readConfig(path).thinkingOverride;
  return v === "enabled" || v === "disabled" ? v : undefined;
}
```

- [ ] **步骤 3：添加 `saveThinkingOverride`**

```ts
export function saveThinkingOverride(value: ThinkingOverride, path: string = defaultConfigPath()): void {
  const cfg = readConfig(path);
  cfg.thinkingOverride = value;
  writeConfig(cfg, path);
}
```

- [ ] **步骤 4：运行类型检查**

```bash
npx tsc --noEmit 2>&1 | grep -v PlanPanel
```
预期：无新增错误

---

### 任务 5：`src/cli/ui/slash/commands.ts` — 命令注册

**文件：** 修改 `src/cli/ui/slash/commands.ts`

- [ ] **步骤 1：添加命令 spec**

在 `th` 字母顺序附近（`theme` 后面 / `title` 前面）添加：

```ts
{
  cmd: "thinking",
  group: "setup",
  argsHint: "<on|off>",
  summary:
    "toggle chain-of-thought reasoning — off = faster/cheaper responses (thinking:disabled), on = full reasoning",
  argCompleter: ["on", "off"],
},
```

- [ ] **步骤 2：运行类型检查**

```bash
npx tsc --noEmit 2>&1 | grep -v PlanPanel
```
预期：无新增错误

---

### 任务 6：`src/cli/ui/slash/handlers/model.ts` — Handler

**文件：** 修改 `src/cli/ui/slash/handlers/model.ts`

- [ ] **步骤 1：新增 `thinking` handler**

在 `effort` handler 后面添加：

```ts
const thinking: SlashHandler = (args, loop, ctx) => {
  const raw = (args[0] ?? "").toLowerCase();
  if (raw === "") {
    const status =
      loop.thinkingOverride === undefined
        ? "auto (model-default)"
        : loop.thinkingOverride;
    return { info: t("handlers.model.thinkingStatus", { status }) };
  }
  const isOn = raw === "on" || raw === "true" || raw === "1";
  const isOff = raw === "off" || raw === "false" || raw === "0";
  if (!isOn && !isOff) {
    return { info: t("handlers.model.thinkingUsage") };
  }
  const next: "enabled" | "disabled" = isOn ? "enabled" : "disabled";
  loop.configure({ thinkingOverride: next });
  try {
    saveThinkingOverride(next, ctx.configPath);
  } catch {
    /* disk full / perms — runtime change still took effect */
  }
  return { info: t("handlers.model.thinkingSet", { value: next }) };
};
```

- [ ] **步骤 2：更新 exports**

找到 exports 对象底部的 `handlers` record，添加：

```ts
export const handlers: Record<string, SlashHandler> = {
  model,
  effort,
  budget,
  "max-tokens": maxTokens,
  thinking,   // ← 新增
};
```

- [ ] **步骤 3：更新 import**

在文件顶部添加 import：

```ts
import { saveThinkingOverride } from "@/config.js";
```

- [ ] **步骤 4：运行类型检查**

```bash
npx tsc --noEmit 2>&1 | grep -v PlanPanel
```
预期：无新增错误

---

### 任务 7：`src/i18n` — 国际化

**文件：** 修改 `src/i18n/types.ts`、`src/i18n/EN.ts`

- [ ] **步骤 1：`src/i18n/types.ts` 中添加类型**

找到 `model` 下的字符串类型（约 line xxx），在 `effortSet` 后面添加：

```ts
thinkingStatus: string;
thinkingUsage: string;
thinkingSet: string;
```

- [ ] **步骤 2：`src/i18n/EN.ts` 中添加英文文案**

找到 `handlers.model` 下的 `effortSet` 后面添加：

```ts
thinkingStatus: "thinking → {status}   (/thinking on|off to change)",
thinkingUsage: "usage: /thinking <on|off>   (off = faster/cheaper, no chain-of-thought)",
thinkingSet: "thinking → {value}",
```

- [ ] **步骤 3：运行类型检查**

```bash
npx tsc --noEmit 2>&1 | grep -v PlanPanel
```
预期：无新增错误（其他语言的 i18n 文件用了 `...EN.handlers.model` 会自动继承）

---

### 任务 8：`src/tools/subagent.ts` — 子 agent 同步

**文件：** 修改 `src/tools/subagent.ts`

- [ ] **步骤 1：传递 thinkingOverride 给 child loop**

找到 child loop 构造处（约 line 209），在 `reasoningEffort: DEFAULT_SUBAGENT_EFFORT,` 后面添加：

```ts
thinkingOverride: opts.thinkingOverride,
```

需要先在 `SubagentOptions` 或函数参数中添加 `thinkingOverride` 字段。搜索 `SubagentToolOptions` 或 `SubagentOptions`。

实际上，查看 `runSubagent` 函数的签名——它只是从上下文中获取 parentLoop。让我们在子 agent 工具定义处找到如何传递。

子 agent 工具接收 `ToolCallContext`，其中包含 `loop` 引用。所以可以直接从 `ctx.loop.thinkingOverride` 获取。

直接修改 child loop 创建处为：

```ts
const childLoop = new CacheFirstLoop({
  client: opts.client,
  prefix: childPrefix,
  tools: childTools,
  model,
  reasoningEffort: DEFAULT_SUBAGENT_EFFORT,
  thinkingOverride: opts.thinkingOverride,
  hooks: [],
  stream: true,
  session: sessionName,
});
```

需要确认 `opts` 类型中有 `thinkingOverride` 字段。

- [ ] **步骤 2：找到 `SubagentRunOptions` 或等同类型，新增 `thinkingOverride` 字段**

```ts
thinkingOverride?: "enabled" | "disabled";
```

- [ ] **步骤 3：运行类型检查**

```bash
npx tsc --noEmit 2>&1 | grep -v PlanPanel
```
预期：无新增错误

---

### 任务 9：`tests/config.test.ts` — 配置测试

**文件：** 修改 `tests/config.test.ts`

- [ ] **步骤 1：导入新函数**

文件顶部添加：

```ts
import {
  loadThinkingOverride,
  saveThinkingOverride,
  ThinkingOverride,
} from "../src/config.js";
```

- [ ] **步骤 2：添加测试块**

找到 `saveReasoningEffort + loadReasoningEffort` 测试块后面添加：

```ts
it("loadThinkingOverride returns undefined when unset", () => {
  expect(loadThinkingOverride(path)).toBeUndefined();
});

it("saveThinkingOverride + loadThinkingOverride round-trip enabled/disabled", () => {
  for (const v of ["enabled", "disabled"] as const) {
    saveThinkingOverride(v, path);
    expect(loadThinkingOverride(path)).toBe(v);
    expect(readConfig(path).thinkingOverride).toBe(v);
  }
});

it("saveThinkingOverride doesn't clobber other persisted fields", () => {
  saveReasoningEffort("high", path);
  saveThinkingOverride("disabled", path);
  expect(loadReasoningEffort(path)).toBe("high");
  expect(loadThinkingOverride(path)).toBe("disabled");
});

it("loadThinkingOverride returns undefined for unknown values", () => {
  writeConfig({ thinkingOverride: "turbo" as any }, path);
  expect(loadThinkingOverride(path)).toBeUndefined();
});
```

- [ ] **步骤 3：运行测试**

```bash
npx vitest run tests/config.test.ts 2>&1 | tail -10
```
预期：4 个新测试全部 PASS

---

### 任务 10：最终集成验证

- [ ] **步骤 1：完整类型检查**

```bash
npx tsc --noEmit 2>&1 | grep -v PlanPanel
```
预期：仅 PlanPanel 的已知预存错误

- [ ] **步骤 2：完整 lint**

```bash
npx biome check src tests 2>&1
```
预期：no fixes applied

- [ ] **步骤 3：完整测试**

```bash
npx vitest run 2>&1 | tail -20
```
预期：全部测试通过

- [ ] **步骤 4：Commit 所有改动**

```bash
git add -A
git commit -m "feat: /thinking command — toggle chain-of-thought reasoning

- Add thinkingOverride to CacheFirstLoop (options, configure, state)
- Stream thinkingOverride through streaming.ts to client calls
- Strip reasoning_effort at client layer when thinking:disabled (API constraint)
- Add loadThinkingOverride / saveThinkingOverride to config
- Register /thinking slash command with on|off completer
- Add thinking handler (follows /effort pattern)
- Thread thinkingOverride into subagent child loops
- Add i18n strings and config tests"
```
