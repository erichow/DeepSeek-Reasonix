/**
 * 验证 /ai-filter-officer 的 compactInPlace 确实改变了上下文。
 * 模拟完整流程：analyze → apply → compactInPlace → 验证 token 减少。
 */
import { describe, expect, it, vi } from "vitest";
import { type DenoisePlan, SalienceEngine } from "../src/context/salience-engine.js";
import { AppendOnlyLog } from "../src/memory/runtime.js";
import { countTokensBounded } from "../src/tokenizer.js";
import type { ChatMessage } from "../src/types.js";

function makeLog(msgs: ChatMessage[]): AppendOnlyLog {
  const log = new AppendOnlyLog();
  log.initWindow(msgs);
  return log;
}

function makePlan(removeIndices: number[], compressIndices: number[]): DenoisePlan {
  const details: DenoisePlan["details"] = [];
  const total = removeIndices.length + compressIndices.length + 1;
  let ti = 0;
  let ri = 0;
  let ci = 0;
  for (let i = 0; ; i++) {
    if (ri < removeIndices.length && removeIndices[ri] === i) {
      details.push({ index: i, role: "tool", action: "remove", reason: "stale", preview: "x" });
      ri++;
    } else if (ci < compressIndices.length && compressIndices[ci] === i) {
      details.push({
        index: i,
        role: "assistant",
        action: "compress",
        reason: "done",
        preview: "x",
      });
      ci++;
    } else {
      details.push({ index: i, role: "user", action: "keep", reason: "active", preview: "x" });
      ti++;
    }
    if (ti >= total && ri >= removeIndices.length && ci >= compressIndices.length) break;
  }
  return {
    taskAnalysis: "test",
    keepCount: total,
    compressCount: compressIndices.length,
    removeCount: removeIndices.length,
    tokensSaved: 999,
    details,
  };
}

describe("compactInPlace context reduction", () => {
  it("compactInPlace reduces message count AND token count", () => {
    // 模拟 5 条消息，其中 2 条要移除
    const msgs: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "Hello, I need help" },
      { role: "tool", content: "read_file result that is very long... ".repeat(100) },
      { role: "assistant", content: "Let me fix this" },
      { role: "tool", content: "another stale result ".repeat(100) },
    ];

    const log = makeLog(msgs);
    expect(log.totalLength).toBe(5);
    const engine = new SalienceEngine(null as any);

    // 标记 index=2(index 2) 和 index=4 为 remove
    const plan = makePlan([2, 4], []);
    expect(plan.details.length).toBe(5);
    expect(plan.details[2]!.action).toBe("remove");
    expect(plan.details[4]!.action).toBe("remove");

    const beforeTokens = msgs.reduce(
      (s, m) => s + countTokensBounded(typeof m.content === "string" ? m.content : ""),
      0,
    );

    const filtered = engine.apply(msgs, plan);
    expect(filtered).toHaveLength(3); // 5 - 2 = 3

    // 替换日志
    log.compactInPlace(filtered);
    expect(log.totalLength).toBe(3);

    // 验证 toFullHistory 返回缩短后的数据
    const history = log.toFullHistory();
    expect(history).toHaveLength(3);

    // 验证 token 数确实减少了
    const afterTokens = history.reduce(
      (s, m) => s + countTokensBounded(typeof m.content === "string" ? m.content : ""),
      0,
    );
    expect(afterTokens).toBeLessThan(beforeTokens);
  });

  it("compress messages also reduce token count", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "long discussion with many details ".repeat(50) },
    ];

    const plan = makePlan([], [1]); // compress index 1
    const engine = new SalienceEngine(null as any);
    const filtered = engine.apply(msgs, plan);

    expect(filtered).toHaveLength(2);

    const beforeTokens = countTokensBounded(msgs[1]!.content as string);
    const afterTokens = countTokensBounded(filtered[1]!.content as string);
    expect(afterTokens).toBeLessThan(beforeTokens);
  });
});
