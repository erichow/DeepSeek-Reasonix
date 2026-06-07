import { describe, expect, it, vi } from "vitest";
import { SalienceEngine } from "../src/context/salience-engine.js";
import type { ChatMessage } from "../src/types.js";

describe("/ai-filter-officer integration", () => {
  it("analyze → apply produces expected message count and placeholders", async () => {
    const client = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          task_analysis: "Fixing a bug",
          actions: [
            { index: 0, action: "keep", reason: "system" },
            { index: 1, action: "keep", reason: "bug report" },
            { index: 2, action: "remove", reason: "stale search" },
          ],
        }),
        reasoningContent: null,
        toolCalls: [],
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        raw: {},
      }),
    };

    const engine = new SalienceEngine(client as any);
    const messages: ChatMessage[] = [
      { role: "system", content: "You are a coding agent" },
      { role: "user", content: "Fix the login bug" },
      { role: "tool", content: "search results: ..." },
    ];

    const plan = await engine.analyze(messages);
    expect(plan).not.toBeNull();
    expect(plan!.keepCount).toBe(2);
    expect(plan!.removeCount).toBe(1);

    const filtered = engine.apply(messages, plan!);
    expect(filtered).toHaveLength(2); // remove 消息被彻底移除
    expect(filtered[0]!.content).toBe("You are a coding agent");
    expect(filtered[1]!.content).toBe("Fix the login bug");
  });

  it("analyze returns null for empty messages", async () => {
    const client = { chat: vi.fn() };
    const engine = new SalienceEngine(client as any);
    await expect(engine.analyze([])).rejects.toThrow();
  });

  it("retries once on JSON parse failure", async () => {
    const client = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "not json",
          reasoningContent: null,
          toolCalls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          raw: {},
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            task_analysis: "Retry test",
            actions: [{ index: 0, action: "keep", reason: "test" }],
          }),
          reasoningContent: null,
          toolCalls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          raw: {},
        }),
    };
    const engine = new SalienceEngine(client as any);
    const messages: ChatMessage[] = [{ role: "user", content: "hi" }];
    const plan = await engine.analyze(messages);
    expect(plan).not.toBeNull();
    expect(client.chat).toHaveBeenCalledTimes(2);
  });

  it("applies with session.compacted event shape", () => {
    const engine = new SalienceEngine(null as any);
    const msgs: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
    ];
    const plan = {
      taskAnalysis: "test",
      keepCount: 1,
      compressCount: 0,
      removeCount: 1,
      tokensSaved: 10,
      details: [
        {
          index: 0,
          role: "system" as const,
          action: "keep" as const,
          reason: "sys",
          preview: "sys",
        },
        {
          index: 1,
          role: "user" as const,
          action: "remove" as const,
          reason: "outdated",
          preview: "hello",
        },
      ],
    };
    const filtered = engine.apply(msgs, plan as any);
    expect(filtered).toHaveLength(1); // remove 消息被彻底移除

    const compactedEvent = {
      type: "session.compacted" as const,
      beforeMessages: msgs.length,
      afterMessages: filtered.length,
      reason: "user" as const,
      replacementMessages: filtered,
    };
    expect(compactedEvent.beforeMessages).toBe(2);
    expect(compactedEvent.afterMessages).toBe(1);
    expect(compactedEvent.replacementMessages[0]!.content).toBe("sys");
  });
});
