import { SalienceEngine } from "@/context/salience-engine.js";
import { rewriteSession } from "@/memory/session.js";
import type { SlashHandler } from "../dispatch.js";

export const handlers: Record<string, SlashHandler> = {
  "ai-filter-officer": (_args, loop, ctx) => {
    const before = loop.log.totalLength;
    if (before === 0) {
      return { info: "⚠️ 会话为空，无需降噪" };
    }

    void (async () => {
      try {
        ctx.postInfo?.("🔍 AI Filter Officer 正在分析会话相关性...");
        const messages = loop.log.toFullHistory();
        const engine = new SalienceEngine(loop.client);
        const plan = await engine.analyze(messages);
        if (!plan) {
          ctx.postInfo?.("⚠️ 模型返回无效结果，请重试");
          return;
        }

        if (plan.removeCount === 0 && plan.compressCount === 0) {
          ctx.postInfo?.("✅ 未发现可降噪内容——上下文已足够精简");
          return;
        }

        // 执行降噪：过滤消息
        const filtered = engine.apply(messages, plan);

        // 替换日志
        loop.log.compactInPlace(filtered);

        // 持久化到磁盘
        if (loop.sessionName) {
          rewriteSession(loop.sessionName, filtered);
        }

        // 报告结果
        const after = filtered.length;
        const removed = before - after;
        ctx.postInfo?.(
          `📋 ${plan.taskAnalysis}\n降噪完成：${plan.removeCount} 条已移除，${plan.compressCount} 条已压缩 | ${before} → ${after} 条消息（-${removed}）| 📦 释放 ~${plan.tokensSaved} tokens`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.postInfo?.(`❌ 降噪失败：${msg}`);
      }
    })();

    return { info: "🔍 正在分析会话，请稍候..." };
  },
};
