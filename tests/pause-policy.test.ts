import { describe, expect, it } from "vitest";
import { autoResolveVerdict, shouldAutoResolveCheckpoint } from "../src/core/pause-policy.js";

describe("shouldAutoResolveCheckpoint", () => {
  it("returns true for 'auto' mode", () => {
    expect(shouldAutoResolveCheckpoint("auto")).toBe(true);
  });

  it("returns true for 'yolo' mode", () => {
    expect(shouldAutoResolveCheckpoint("yolo")).toBe(true);
  });

  it("returns false for 'review' mode", () => {
    expect(shouldAutoResolveCheckpoint("review")).toBe(false);
  });

  it("returns false for unknown edit modes", () => {
    // @ts-expect-error — testing runtime behavior with an invalid value
    expect(shouldAutoResolveCheckpoint("unknown")).toBe(false);
  });
});

describe("autoResolveVerdict", () => {
  // --- plan_checkpoint ---
  it('returns {type:"continue"} for plan_checkpoint in auto mode', () => {
    const req = { id: 1, kind: "plan_checkpoint" as const, payload: {} };
    expect(autoResolveVerdict(req, "auto")).toEqual({ type: "continue" });
  });

  it('returns {type:"continue"} for plan_checkpoint in yolo mode', () => {
    const req = { id: 1, kind: "plan_checkpoint" as const, payload: {} };
    expect(autoResolveVerdict(req, "yolo")).toEqual({ type: "continue" });
  });

  it("returns null for plan_checkpoint in review mode", () => {
    const req = { id: 1, kind: "plan_checkpoint" as const, payload: {} };
    expect(autoResolveVerdict(req, "review")).toBeNull();
  });

  // --- path_access ---
  it('returns {type:"run_once"} for path_access in yolo mode', () => {
    const req = {
      id: 1,
      kind: "path_access" as const,
      payload: {
        path: "/etc/passwd",
        intent: "read" as const,
        toolName: "read_file",
        sandboxRoot: "/project",
        allowPrefix: "/etc",
      },
    };
    expect(autoResolveVerdict(req, "yolo")).toEqual({ type: "run_once" });
  });

  it("returns null for path_access in auto mode (only yolo bypasses)", () => {
    const req = {
      id: 1,
      kind: "path_access" as const,
      payload: {
        path: "/etc/passwd",
        intent: "read" as const,
        toolName: "read_file",
        sandboxRoot: "/project",
        allowPrefix: "/etc",
      },
    };
    expect(autoResolveVerdict(req, "auto")).toBeNull();
  });

  it("returns null for path_access in review mode", () => {
    const req = {
      id: 1,
      kind: "path_access" as const,
      payload: {
        path: "/etc/passwd",
        intent: "read" as const,
        toolName: "read_file",
        sandboxRoot: "/project",
        allowPrefix: "/etc",
      },
    };
    expect(autoResolveVerdict(req, "review")).toBeNull();
  });

  // --- run_command ---
  it('returns {type:"run_once"} for run_command in yolo mode', () => {
    const req = {
      id: 1,
      kind: "run_command" as const,
      payload: { command: "rm -rf /", cwd: "/project" },
    };
    expect(autoResolveVerdict(req, "yolo")).toEqual({ type: "run_once" });
  });

  it("returns null for run_command in auto mode", () => {
    const req = {
      id: 1,
      kind: "run_command" as const,
      payload: { command: "rm -rf /", cwd: "/project" },
    };
    expect(autoResolveVerdict(req, "auto")).toBeNull();
  });

  it("returns null for run_command in review mode", () => {
    const req = {
      id: 1,
      kind: "run_command" as const,
      payload: { command: "rm -rf /", cwd: "/project" },
    };
    expect(autoResolveVerdict(req, "review")).toBeNull();
  });

  // --- run_background ---
  it('returns {type:"run_once"} for run_background in yolo mode', () => {
    const req = {
      id: 1,
      kind: "run_background" as const,
      payload: { command: "npm run dev", cwd: "/project" },
    };
    expect(autoResolveVerdict(req, "yolo")).toEqual({ type: "run_once" });
  });

  it("returns null for run_background in auto mode", () => {
    const req = {
      id: 1,
      kind: "run_background" as const,
      payload: { command: "npm run dev", cwd: "/project" },
    };
    expect(autoResolveVerdict(req, "auto")).toBeNull();
  });

  // --- unknown request kinds ---
  it("returns null for unknown request kinds", () => {
    const req = { id: 1, kind: "unknown_kind" as any, payload: {} };
    expect(autoResolveVerdict(req, "yolo")).toBeNull();
    expect(autoResolveVerdict(req, "auto")).toBeNull();
    expect(autoResolveVerdict(req, "review")).toBeNull();
  });

  // --- other combinations that should return null ---
  it("returns null for plan_checkpoint in an unknown edit mode", () => {
    const req = { id: 1, kind: "plan_checkpoint" as const, payload: {} };
    // @ts-expect-error — testing runtime behavior with an invalid edit mode
    expect(autoResolveVerdict(req, "unknown")).toBeNull();
  });

  it("returns null for path_access with an unknown edit mode", () => {
    const req = {
      id: 1,
      kind: "path_access" as const,
      payload: {
        path: "/etc/passwd",
        intent: "read" as const,
        toolName: "read_file",
        sandboxRoot: "/project",
        allowPrefix: "/etc",
      },
    };
    // @ts-expect-error — testing runtime behavior with an invalid edit mode
    expect(autoResolveVerdict(req, "unknown")).toBeNull();
  });

  it("returns null for run_command with an unknown edit mode", () => {
    const req = {
      id: 1,
      kind: "run_command" as const,
      payload: { command: "ls", cwd: "/project" },
    };
    // @ts-expect-error — testing runtime behavior with an invalid edit mode
    expect(autoResolveVerdict(req, "unknown")).toBeNull();
  });
});
