# `/thinking` 思维链开关命令设计

> 按需切换 DeepSeek 模型的链式推理（chain-of-thought）——关闭后响应更快、更省 token；开启后输出完整推理过程

## 概述

新增 `/thinking <on|off>` 斜杠命令。用户在会话中调用该命令时，控制后续轮次是否发送 `extra_body.thinking.type = "enabled" | "disabled"`。

- `off` → 模型不做深度推理，直接输出答案（更快、更便宜）
- `on` → 模型正常输出思维链（默认行为）
- bare `/thinking` → 显示当前状态（`auto` / `enabled` / `disabled`）

**设计原则：**
- 遵循 `/effort` 的现有模式：Loop 状态 + configure() + config.json 持久化
- `undefined` 回退到现有 `thinkingModeForModel()` 自动推导逻辑，保证零改动向下兼容
- 子 agent 也同步生效
- ⚠️ `thinking: "disabled"` 时 **不能同时发送 `reasoning_effort`**，否则 DeepSeek API 报错。Client 层需要自动剥离

## 用户流程

```
用户输入 /thinking off
    │
    ▼
1. 解析参数 → loop.configure({ thinkingOverride: "disabled" })
    │
    ▼
2. 持久化 → saveThinkingOverride("disabled", configPath)
    │
    ▼
3. 反馈 → info: "thinking: disabled"
    │
    ▼
下一轮模型请求:
  extra_body.thinking.type = "disabled"
  (之前: 由 thinkingModeForModel(model) 自动决定)
```

```
用户输入 /thinking       (无参数)
    │
    ▼
1. 读取 loop.thinkingOverride
    │
    ▼
2. 反馈:
   - undefined → "thinking: auto (model-default)"
   - "enabled" → "thinking: enabled"
   - "disabled" → "thinking: disabled"
```

## 文件改动清单

### 1. `src/loop.ts` — 核心状态

- `CacheFirstLoopOptions` 新增 `thinkingOverride?: "enabled" | "disabled"`
- `ReconfigurableOptions` 新增 `thinkingOverride?: "enabled" | "disabled"`
- `CacheFirstLoop` 新增 `thinkingOverride?: "enabled" | "disabled"` 字段
- 构造函数中：`this.thinkingOverride = opts.thinkingOverride;`
- `configure()` 方法中：`if (opts.thinkingOverride !== undefined) this.thinkingOverride = opts.thinkingOverride;`

### 2. `src/loop/thinking.ts` — 导出类型

- 不需要新增函数，各调用点直接使用 `thinkingOverride ?? thinkingModeForModel(model)` 即可

### 3. `src/loop/streaming.ts` — 流式调用入口

- `streamModelResponse` 参数中接收 `thinkingOverride`
- 调用时：`thinking: thinkingOverride ?? thinkingModeForModel(model)`

### 4. `src/loop.ts` 中 stream 路径（约 line 904-919）

- `thinking: this.thinkingOverride ?? thinkingModeForModel(callModel)`
- 替换原有的 `thinking: thinkingModeForModel(callModel)`

### 5. `src/config.ts` — 持久化

```ts
export function loadThinkingOverride(path?: string): "enabled" | "disabled" | undefined;
export function saveThinkingOverride(value: "enabled" | "disabled", path?: string): void;
```

配置键名：`thinkingOverride`

### 6. `src/client.ts` — 请求层安全剥离（核心修复）

`buildPayload()` 中，当 `opts.thinking === "disabled"` 时，必须**不发送** `reasoning_effort`：

```ts
// 之前
if (opts.reasoningEffort) {
  payload.reasoning_effort = opts.reasoningEffort;
}

// 之后
if (opts.reasoningEffort && opts.thinking !== "disabled") {
  payload.reasoning_effort = opts.reasoningEffort;
}
```

这是安全保障——无论上层状态如何组合，HTTP 请求层面不会发送冲突字段。

### 7. `src/cli/ui/slash/commands.ts` — 命令注册

```ts
{
  cmd: "thinking",
  group: "setup",
  argsHint: "<on|off>",
  summary: "toggle chain-of-thought reasoning — off = faster/cheaper responses (thinking:disabled), on = full reasoning",
  argCompleter: ["on", "off"],
}
```

### 8. `src/cli/ui/slash/handlers/model.ts` — Handler

新增 `thinking` handler，逻辑与 `effort` handler 完全一致的模式。
`/thinking off` 时如果当前 `reasoningEffort` 不是默认值，handler 中给出提示（但实际阻断在 client 层）。

### 9. `src/tools/subagent.ts` — 子 agent

子 agent 创建 child loop 时传入 `thinkingOverride`，使 `/thinking off` 对子 agent 也生效。

### 10. `src/i18n/EN.ts` — 国际化

新增 `handlers.model.thinkingStatus`、`handlers.model.thinkingSet` 等字符串。

### 11. `src/index.ts` — 公开导出

如果 `ReconfigurableOptions` 或 `CacheFirstLoopOptions` 被外部使用，确认新字段已导出。

## 测试计划

- `tests/config.test.ts`: `loadThinkingOverride` 默认值、round-trip、未知值回退
- 集成测试：`/thinking off` 后下一轮请求 payload 验证 `extra_body.thinking.type === "disabled"`
- 子 agent 测试：构造含 `thinkingOverride` 的 child loop 验证参数传递

## 边缘情况

| 场景 | 行为 |
|---|---|
| `/thinking off` 时 `reasoning_effort` 被设置 | Client 层 `buildPayload()` **自动剥离** `reasoning_effort`，不报错 |
| `/thinking off` 后 `/effort high` | `/effort` 正常保存到 config，但 client 层暂不发送；切回 `/thinking on` 后自动恢复 |
| `/thinking off` 后切到 `deepseek-chat` | 无影响（deepseek-chat 默认就是 disabled） |
| Azure 端点 | `_isAzureEndpoint()` 自动剥离 `extra_body`，无影响 |
| 第三方模型 | `thinkingModeForModel()` 返回 `undefined`，不发送该字段 |
| 重启后 | 持久化值恢复，同 `/effort` 行为 |
