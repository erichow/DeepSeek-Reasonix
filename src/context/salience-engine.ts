import type { DeepSeekClient } from "../client.js";
import type { ChatMessage } from "../types.js";

/** 模型返回的单条判定 */
export interface SalienceAction {
  index: number;
  action: "keep" | "remove" | "compress";
  reason: string;
  summary?: string;
}

/** 模型完整响应 */
export interface SalienceResult {
  task_analysis: string;
  actions: SalienceAction[];
}

/** 降噪计划——展示给用户确认 */
export interface DenoisePlan {
  taskAnalysis: string;
  keepCount: number;
  compressCount: number;
  removeCount: number;
  tokensSaved: number;
  details: Array<{
    index: number;
    role: "user" | "assistant" | "tool" | "system";
    action: "keep" | "remove" | "compress";
    reason: string;
    preview: string;
  }>;
}

const VALID_ACTIONS = new Set(["keep", "remove", "compress"]);

/**
 * 解析模型返回的 JSON，校验字段合法性。
 * 返回 null 表示解析失败。
 */
export function parseSalienceResult(raw: string, maxIndex: number): SalienceResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.task_analysis !== "string" || !obj.task_analysis) return null;
  if (!Array.isArray(obj.actions)) return null;

  const actions: SalienceAction[] = [];
  for (const item of obj.actions) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (typeof a.index !== "number" || a.index < 0 || a.index > maxIndex) continue;
    if (typeof a.action !== "string" || !VALID_ACTIONS.has(a.action)) continue;
    if (typeof a.reason !== "string" || !a.reason) continue;
    actions.push({
      index: a.index,
      action: a.action as "keep" | "remove" | "compress",
      reason: a.reason,
      summary: typeof a.summary === "string" ? a.summary : undefined,
    });
  }

  if (actions.length === 0) return null;
  return { task_analysis: obj.task_analysis, actions };
}

const FILTER_MODEL = "deepseek-v4-flash";
const MAX_MESSAGES_FOR_ANALYSIS = 50;

function buildFilterPrompt(messages: ChatMessage[]): string {
  const lines = messages.map((msg, i) => {
    const role = msg.role;
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    const preview = content.length > 200 ? `${content.slice(0, 200)}...` : content;
    return `[${i}] role=${role}\n${preview}`;
  });
  return [
    "你是一个上下文筛选专家 (Filter Officer)。以下是编码会话的完整消息列表，每条消息前标有 [索引号]。",
    "",
    "你的任务：阅读整个会话，推断用户当前的主要任务目标，然后逐条判断每条消息是否仍然与当前任务相关。",
    "",
    "判定规则：",
    "- keep — 对当前任务仍有关键参考价值。例如：用户的原始需求、仍在使用的文件内容、活动的 Plan、关键决策、尚未完成的任务描述、系统提示。",
    "- remove — 明确与当前任务无关的过时内容。例如：已被后续编辑覆盖的文件读取结果、已解决的错误讨论、已废弃的方案探索、重复的搜索、已完成的中间步骤。",
    "- compress — 部分相关但无需保留原文。用一句话概括即可。例如：中间状态的讨论、备选方案的简要记录。",
    "",
    "返回格式（严格 JSON，不要包含其他文本）：",
    '{"task_analysis": "一句话描述用户当前任务", "actions": [{"index": N, "action": "keep|remove|compress", "reason": "判定理由"}]}',
    "",
    `注意：索引号从 0 开始。所有索引必须在 0 到 ${messages.length - 1} 之间。`,
    "",
    "以下是消息列表：",
    ...lines,
  ].join("\n");
}

/** 估算一条消息的 token 数（粗略）。 */
function estimateTokens(msg: ChatMessage): number {
  const content = typeof msg.content === "string" ? msg.content : "";
  let total = content.length / 4;
  if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
    total += JSON.stringify(msg.tool_calls).length / 4;
  }
  return Math.ceil(total);
}

export class SalienceEngine {
  constructor(private client: DeepSeekClient) {}

  /**
   * 分析消息列表，返回降噪计划。
   * 如果模型调用失败或解析失败，返回 null。
   */
  async analyze(messages: ChatMessage[]): Promise<DenoisePlan | null> {
    if (messages.length === 0) throw new Error("No messages to analyze");

    const sliced =
      messages.length > MAX_MESSAGES_FOR_ANALYSIS
        ? messages.slice(messages.length - MAX_MESSAGES_FOR_ANALYSIS)
        : messages;

    const prompt = buildFilterPrompt(sliced);

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.client.chat({
          model: FILTER_MODEL,
          messages: [{ role: "user", content: prompt }],
          responseFormat: { type: "json_object" },
          thinking: "disabled",
        });

        const parsed = parseSalienceResult(response.content, sliced.length - 1);
        if (!parsed) continue;

        return this.buildPlan(sliced, parsed);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError ?? new Error("Failed to analyze messages");
  }

  private buildPlan(messages: ChatMessage[], result: SalienceResult): DenoisePlan {
    const actionMap = new Map<number, SalienceAction>();
    for (const a of result.actions) {
      actionMap.set(a.index, a);
    }

    const details: DenoisePlan["details"] = [];
    let totalTokensSaved = 0;

    for (let i = 0; i < messages.length; i++) {
      const action = actionMap.get(i);
      const msg = messages[i]!;
      const content = typeof msg.content === "string" ? msg.content : "";
      const preview = content.length > 60 ? `${content.slice(0, 60)}…` : content;

      const effectiveAction = action?.action ?? "keep";
      const reason = action?.reason ?? "未明确判定，默认保留";

      details.push({
        index: i,
        role: msg.role,
        action: effectiveAction,
        reason,
        preview,
      });

      if (effectiveAction === "remove") {
        totalTokensSaved += estimateTokens(msg);
      } else if (effectiveAction === "compress") {
        totalTokensSaved += Math.ceil(estimateTokens(msg) * 0.8);
      }
    }

    return {
      taskAnalysis: result.task_analysis,
      keepCount: details.filter((d) => d.action === "keep").length,
      compressCount: details.filter((d) => d.action === "compress").length,
      removeCount: details.filter((d) => d.action === "remove").length,
      tokensSaved: totalTokensSaved,
      details,
    };
  }

  /**
   * 按 plan 过滤消息，返回新的消息列表（真正缩短上下文）。
   * - keep: 保留原文
   * - remove: 从结果中彻底移除
   * - compress: 替换为简短摘要占位符
   * - 不在 plan.details 中的消息默认 keep（保守策略）
   */
  apply(messages: ChatMessage[], plan: DenoisePlan): ChatMessage[] {
    const salienceMap = new Map<number, DenoisePlan["details"][0]>();
    for (const d of plan.details) {
      salienceMap.set(d.index, d);
    }

    const result: ChatMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
      const detail = salienceMap.get(i);
      const effectiveAction = detail?.action ?? "keep";

      if (effectiveAction === "remove") {
        // 彻底移除，不占位置
        continue;
      }

      const msg = messages[i]!;
      if (effectiveAction === "compress") {
        result.push({
          ...msg,
          content: `[🧹 ${detail!.reason}]`,
        } as ChatMessage);
      } else {
        result.push(msg);
      }
    }
    return result;
  }
}
