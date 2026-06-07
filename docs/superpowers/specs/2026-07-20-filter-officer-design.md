# `/ai-filter-officer` 上下文降噪命令设计

> 按需执行的 AI 驱动式上下文筛选——智能保留与当前任务相关的内容，移除过时噪音

## 概述

新增 `/ai-filter-officer` 斜杠命令。用户在会话中主动调用该命令时，系统读取完整会话消息，调用一次 `deepseek-v4-flash` 模型逐条分析相关性，生成降噪报告供用户审阅确认，然后将过时/不相关的消息移除或压缩。

**设计原则：**
- 按需执行（非自动），用户掌握控制权
- AI 辅助判断，用户最终确认——不自动删除任何内容
- 复用现有 fold 调用通道，不增加额外的独立 API 轮次
- 与现有 `/compact` 互补——compact 按位置压缩，filter-officer 按语义筛选

## 用户流程

```
用户输入 /ai-filter-officer
    │
    ▼
1. 收集上下文 → 读取 AppendOnlyLog 全部消息 + 添加索引
    │
    ▼
2. AI 分析 → 调用 deepseek-v4-flash 逐条标记 keep/remove/compress
    │
    ▼
3. 生成降噪报告 → 展示给用户（任务推断 + 各条目判定 + 节省量估算）
    │
    ▼
4. 用户确认 → [执行] [查看详情] [取消] [编辑]
    │  [确认]
    ▼
5. 执行 → compactInPlace 替换消息列表 + 写入 SessionCompactedEvent
```

## 架构

```
/ai-filter-officer 命令 (slash handler)
    │
    ▼
SalienceEngine.analyze(messages)
    │
    ├── 构建 prompt → 调用 deepseek-v4-flash
    ├── 解析返回的 SalienceResult JSON
    ├── 校验索引合法性
    └── 返回 DenoisePlan
    │
    ▼
展示报告给用户 (TUI)
    │
    ▼
用户确认 → SalienceEngine.apply(log, plan)
    │
    ├── log.compactInPlace(filteredMessages)
    └── 写入 session.compacted 事件
```

### 新文件

| 文件 | 职责 |
|---|---|
| `src/context/salience-engine.ts` | 核心分析引擎：收集消息 → 调用模型 → 解析结果 → 生成降噪计划 |
| `src/cli/ui/slash/handlers/filter-officer.ts` | `/ai-filter-officer` 命令处理器 |

### 核心类型 (`src/context/salience-engine.ts`)

```typescript
/** 模型返回的单条判定 */
export interface SalienceAction {
  index: number;       // 消息在输入列表中的索引
  action: "keep" | "remove" | "compress";
  reason: string;      // 判定理由（展示给用户）
  summary?: string;    // compress 时的替代摘要
}

/** 模型完整响应 */
export interface SalienceResult {
  task_analysis: string;      // 模型推断的当前任务
  actions: SalienceAction[];
}

/** 降噪计划——展示给用户确认 */
export interface DenoisePlan {
  taskAnalysis: string;
  keepCount: number;
  compressCount: number;
  removeCount: number;
  tokensSaved: number;       // 估算节省的 token 数
  details: Array<{
    index: number;
    role: "user" | "assistant" | "tool" | "system";
    action: "keep" | "remove" | "compress";
    reason: string;
    preview: string;         // 消息前 60 字符
  }>;
}

/** SalienceEngine API */
export class SalienceEngine {
  constructor(private deps: { client: DeepSeekClient });

  /** 分析消息列表，返回降噪计划 */
  async analyze(messages: ChatMessage[]): Promise<DenoisePlan>;

  /** 执行降噪：按 plan 过滤消息，返回新的消息列表 */
  apply(messages: ChatMessage[], plan: DenoisePlan): ChatMessage[];
}
```

## AI Prompt

分析调用的系统指令：

```
你是一个上下文筛选专家 (Filter Officer)。以下是编码会话的完整消息列表，每条消息前标有 [索引号]。

你的任务：阅读整个会话，推断用户当前的主要任务目标，然后逐条判断每条消息是否仍然与当前任务相关。

判定规则：
- keep — 对当前任务仍有关键参考价值。例如：用户的原始需求、仍在使用的文件内容、活动的 Plan、关键决策、尚未完成的任务描述、系统提示。
- remove — 明确与当前任务无关的过时内容。例如：已被后续编辑覆盖的文件读取结果、已解决的错误讨论、已废弃的方案探索、重复的搜索、已完成的中间步骤。
- compress — 部分相关但无需保留原文。用一句话概括即可。例如：中间状态的讨论、备选方案的简要记录。

返回格式（严格 JSON，不要包含其他文本）：
{"task_analysis": "一句话描述用户当前任务", "actions": [{"index": N, "action": "keep|remove|compress", "reason": "判定理由"}]}

注意：索引号从 0 开始。所有索引必须在 0 到 {maxIndex} 之间。
```

## 交互与展示

### 降噪报告

```
╭─ 🔍 AI Filter Officer ───────────────────────────╮
│                                                    │
│  当前任务推断：在 Reasonix 中添加 /ai-filter-officer │
│  slash 命令实现上下文降噪功能                       │
│                                                    │
│  保留 ◉ 12 条  → 系统提示、用户需求、plan         │
│  压缩 ◉  5 条  → 中间讨论、备选方案               │
│  移除 ◉  8 条  → 过时的 read_file/搜索/已解决错误  │
│                                                    │
│  📦 预计释放 ~2,400 tokens（~18% 上下文）          │
│                                                    │
│  [执行]    [查看详情]    [取消]                     │
╰────────────────────────────────────────────────────╯
```

### 查看详情（可展开列表）

每条条目显示：`{action} [{role}] {preview} — {reason}`

### 确认后反馈

```
✅ 降噪完成：移除了 8 条过时内容，压缩了 5 条讨论摘要，释放 ~2,400 tokens
```

## 降噪后的占位符

被移除或压缩的消息位置替换为轻量占位符，保持对话连贯性：

| 原始类型 | 占位符格式 |
|---|---|
| 过时的工具结果 | `[🧹 已降噪：{reason}]` |
| 已压缩的讨论 | `[🧹 已压缩：{summary}]` |

占位符内容极短（<100 chars），不会显著占用上下文。

## 安全边界

| 场景 | 处理 |
|---|---|
| 模型返回非法 JSON | 重试一次；仍失败 → 报错不修改 |
| 索引越界 | 丢弃无效条目，处理合法部分 |
| 全是 keep | 提示"未发现可降噪内容" |
| 节省量 <500 tokens | 提示用户"节省量很小，建议取消" |
| 用户中途中断 | 不回写——原子化执行 |
| 空会话 | 报错"会话为空" |
| 同一 turn 内重复调用 | 拒绝并提示"请等待当前操作完成" |

## 与现有系统的关系

| 现有机制 | 关系 |
|---|---|
| `ContextManager.fold()` | 互补。fold 在上下文压力 >75% 时自动触发（位置截断）；filter-officer 按需触发（语义筛选） |
| `ReadTracker` | 降噪后需要重置 read-before-edit 跟踪缓存（通过 `onLogRewrite` 回调） |
| `SessionCompactedEvent` | 降噪执行后写入此事件，与现有事件流兼容 |
| `/compact` | compact 是全部折叠，filter-officer 是选择性保留/删除——可串行使用 |

## 测试

| 层级 | 文件 | 覆盖 |
|---|---|---|
| 单元测试 | `tests/salience-engine.test.ts` | 模型响应解析、DenoisePlan 生成、apply 过滤、占位符替换、边界条件 |
| 单元测试 | `tests/filter-officer.test.ts` | slash 命令注册 + 处理器流程 |
| 集成测试 | `tests/filter-officer.integration.test.ts` | 完整端到端：调用 → 报告 → 确认 → log 替换 |

不测试：模型判定的语义正确性（这是模型能力问题）和精确 token 节省量（只需估算）。

## 录制与撤销支持

降噪操作通过 `SessionCompactedEvent` 记录到事件日志中，支持 `reasonix replay` 回放查看。降噪本身是会话状态的一次性变更——用户可通过 checkpoint 恢复（如果有）来撤回。
