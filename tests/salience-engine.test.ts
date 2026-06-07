import { describe, expect, it } from "vitest";
import { SalienceEngine, parseSalienceResult } from "../src/context/salience-engine.js";
import type { ChatMessage } from "../src/types.js";

describe("parseSalienceResult", () => {
  it("parses valid JSON with keep/remove/compress actions", () => {
    const input = `{"task_analysis": "Adding a new slash command", "actions": [{"index": 0, "action": "keep", "reason": "system prompt"}, {"index": 3, "action": "remove", "reason": "stale read_file"}, {"index": 5, "action": "compress", "reason": "resolved discussion", "summary": "discussed approach A then B"}]}`;
    const result = parseSalienceResult(input, 10);
    expect(result).not.toBeNull();
    expect(result!.task_analysis).toBe("Adding a new slash command");
    expect(result!.actions).toHaveLength(3);
    expect(result!.actions[0]!.action).toBe("keep");
    expect(result!.actions[2]!.action).toBe("compress");
    expect(result!.actions[2]!.summary).toBe("discussed approach A then B");
  });

  it("returns null for invalid JSON", () => {
    expect(parseSalienceResult("not json", 10)).toBeNull();
  });

  it("returns null for JSON missing required fields", () => {
    expect(parseSalienceResult('{"actions": []}', 10)).toBeNull();
    expect(parseSalienceResult('{"task_analysis": "test"}', 10)).toBeNull();
  });

  it("filters out actions with out-of-range indices", () => {
    const input = `{"task_analysis": "test", "actions": [{"index": 0, "action": "keep", "reason": "ok"}, {"index": 99, "action": "remove", "reason": "out of range"}]}`;
    const result = parseSalienceResult(input, 5);
    expect(result).not.toBeNull();
    expect(result!.actions).toHaveLength(1);
    expect(result!.actions[0]!.index).toBe(0);
  });

  it("returns null when actions array is empty after filtering", () => {
    const input = `{"task_analysis": "test", "actions": [{"index": 99, "action": "remove", "reason": "out of range"}]}`;
    expect(parseSalienceResult(input, 5)).toBeNull();
  });

  it("rejects invalid action values", () => {
    const input = `{"task_analysis": "test", "actions": [{"index": 0, "action": "invalid", "reason": "bad"}]}`;
    const result = parseSalienceResult(input, 10);
    expect(result).toBeNull();
  });
});

describe("SalienceEngine", () => {
  describe("buildPlan", () => {
    it("creates DenoisePlan from valid SalienceResult", () => {
      const engine = new SalienceEngine(null as any);
      const msgs: ChatMessage[] = [
        { role: "system", content: "You are a coding assistant" },
        { role: "user", content: "Add a feature" },
        { role: "assistant", content: "Let me explore the codebase" },
        { role: "tool", content: "read_file result: file.ts" },
      ];
      const result = {
        task_analysis: "Adding a feature",
        actions: [
          { index: 0, action: "keep", reason: "system prompt" },
          { index: 1, action: "keep", reason: "user request" },
          { index: 2, action: "compress", reason: "intermediate exploration" },
          { index: 3, action: "remove", reason: "stale read result" },
        ],
      };

      const plan = (engine as any).buildPlan(msgs, result);
      expect(plan.taskAnalysis).toBe("Adding a feature");
      expect(plan.keepCount).toBe(2);
      expect(plan.compressCount).toBe(1);
      expect(plan.removeCount).toBe(1);
      expect(plan.tokensSaved).toBeGreaterThan(0);
    });
  });

  describe("apply", () => {
    it("removes entries from result and shortens array", () => {
      const engine = new SalienceEngine(null as any);
      const msgs: ChatMessage[] = [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Hello" },
        { role: "tool", content: "stale result" },
      ];
      const plan = {
        taskAnalysis: "test",
        keepCount: 2,
        compressCount: 0,
        removeCount: 1,
        tokensSaved: 10,
        details: [
          { index: 0, role: "system", action: "keep", reason: "keep sys", preview: "System" },
          { index: 1, role: "user", action: "keep", reason: "keep user", preview: "Hello" },
          { index: 2, role: "tool", action: "remove", reason: "stale", preview: "stale" },
        ],
      };
      const result = engine.apply(msgs, plan);
      expect(result).toHaveLength(2); // remove 消息被彻底移除
      expect(result[0]!.content).toBe("System prompt");
      expect(result[1]!.content).toBe("Hello");
    });

    it("replaces compressed messages with short placeholders", () => {
      const engine = new SalienceEngine(null as any);
      const msgs: ChatMessage[] = [{ role: "assistant", content: "long discussion..." }];
      const plan = {
        taskAnalysis: "test",
        keepCount: 0,
        compressCount: 1,
        removeCount: 0,
        tokensSaved: 50,
        details: [
          {
            index: 0,
            role: "assistant",
            action: "compress",
            reason: "resolved discussion",
            preview: "long",
          },
        ],
      };
      const result = engine.apply(msgs, plan);
      expect(result).toHaveLength(1); // compress 消息保留但缩短
      expect(result[0]!.content).toContain("🧹");
    });

    it("preserves keep messages unchanged", () => {
      const engine = new SalienceEngine(null as any);
      const msgs: ChatMessage[] = [{ role: "user", content: "Important request" }];
      const plan = {
        taskAnalysis: "test",
        keepCount: 1,
        compressCount: 0,
        removeCount: 0,
        tokensSaved: 0,
        details: [
          { index: 0, role: "user", action: "keep", reason: "active", preview: "Important" },
        ],
      };
      const result = engine.apply(msgs, plan);
      expect(result[0]!.content).toBe("Important request");
    });

    it("falls back to keep for messages not in plan details", () => {
      const engine = new SalienceEngine(null as any);
      const msgs: ChatMessage[] = [
        { role: "user", content: "msg1" },
        { role: "user", content: "msg2" },
      ];
      const plan = {
        taskAnalysis: "test",
        keepCount: 1,
        compressCount: 0,
        removeCount: 0,
        tokensSaved: 0,
        details: [{ index: 0, role: "user", action: "keep", reason: "active", preview: "msg1" }],
      };
      const result = engine.apply(msgs, plan);
      expect(result[0]!.content).toBe("msg1");
      expect(result[1]!.content).toBe("msg2");
    });
  });
});
