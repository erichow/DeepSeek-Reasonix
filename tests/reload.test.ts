import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReloadManager } from "../src/reload/manager.js";

/** Create a temporary project directory with a basic config.json. */
function tmpProject(): { root: string; configPath: string; snapPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "reload-test-"));
  const reasonixDir = join(root, ".reasonix");
  mkdirSync(reasonixDir, { recursive: true });
  const configPath = join(reasonixDir, "config.json");
  writeFileSync(configPath, JSON.stringify({ model: "deepseek-v4-flash" }), "utf8");
  const snapPath = join(reasonixDir, "reload-snapshot.json");
  return {
    root,
    configPath,
    snapPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function makeContext(projectRoot: string, configPath: string) {
  return {
    loop: {
      model: "deepseek-v4-flash",
      stream: false,
      reasoningEffort: "high" as string,
      maxOutputTokens: undefined as number | undefined,
      budgetUsd: null as number | null,
      configure: () => {},
      setBudget: () => {},
      rebuildSystemPrompt: () => {},
    },
    mcpReload: async () => ({
      added: [] as string[],
      removed: [] as string[],
      failed: [] as Array<{ spec: string; reason: string }>,
      summaries: [] as unknown[],
    }),
    skillStore: { list: () => [] as Array<{ name: string; scope: string; path: string }> },
    configPath,
    projectRoot,
    homeDir: projectRoot,
  };
}

describe("ReloadManager detectChanges", () => {
  it("detects 'new' on first run (empty snapshot)", () => {
    const { root, configPath, snapPath, cleanup } = tmpProject();
    try {
      const mgr = new ReloadManager({ projectRoot: root, configPath });
      mgr.setSnapshotPath(snapPath);
      const changes = mgr.detectChanges();
      expect(changes.hasAny).toBe(true);
      expect(changes.config).toBe("new");
      expect(changes.mcp).toBe("new");
    } finally {
      cleanup();
    }
  });

  it("returns 'unchanged' when nothing has changed between two calls", () => {
    const { root, configPath, snapPath, cleanup } = tmpProject();
    try {
      const mgr = new ReloadManager({ projectRoot: root, configPath });
      mgr.setSnapshotPath(snapPath);

      // First detection to build baseline
      const first = mgr.detectChanges();
      expect(first.hasAny).toBe(true);

      // Apply to persist the snapshot
      mgr.applyChanges(first, makeContext(root, configPath));

      // Second detection — should be unchanged
      const second = mgr.detectChanges();
      expect(second.hasAny).toBe(false);
      expect(second.config).toBe("unchanged");
      expect(second.mcp).toBe("unchanged");
      expect(second.skills).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("detects 'changed' when config file content changes", () => {
    const { root, configPath, snapPath, cleanup } = tmpProject();
    try {
      const mgr = new ReloadManager({ projectRoot: root, configPath });
      mgr.setSnapshotPath(snapPath);

      // Build baseline
      mgr.applyChanges(mgr.detectChanges(), makeContext(root, configPath));

      // Modify config
      writeFileSync(configPath, JSON.stringify({ model: "deepseek-v4-pro" }), "utf8");

      // Second detection — should detect change
      const second = mgr.detectChanges();
      expect(second.hasAny).toBe(true);
      expect(second.config).toBe("changed");
    } finally {
      cleanup();
    }
  });

  it("ignores touch (mtime change, same content)", () => {
    const { root, configPath, snapPath, cleanup } = tmpProject();
    try {
      const mgr = new ReloadManager({ projectRoot: root, configPath });
      mgr.setSnapshotPath(snapPath);

      // Build baseline
      mgr.applyChanges(mgr.detectChanges(), makeContext(root, configPath));

      // Touch file — same content, new mtime
      const content = JSON.stringify({ model: "deepseek-v4-flash" });
      writeFileSync(configPath, content, "utf8");

      // Second detection — should be unchanged (same hash)
      // Note: this requires at least 1 second between writes for mtime to differ
      const second = mgr.detectChanges();
      expect(second.config).toBe("unchanged");
    } finally {
      cleanup();
    }
  });

  it("detects new skill files", () => {
    const { root, configPath, snapPath, cleanup } = tmpProject();
    try {
      // Create a project .reasonix/skills/ directory with a skill
      const skillsDir = join(root, ".reasonix", "skills");
      mkdirSync(skillsDir, { recursive: true });
      writeFileSync(
        join(skillsDir, "my-skill.md"),
        "---\nname: my-skill\ndescription: My test skill\n---\n\nBody",
        "utf8",
      );

      const mgr = new ReloadManager({ projectRoot: root, configPath });
      mgr.setSnapshotPath(snapPath);

      // First detection — baseline
      const first = mgr.detectChanges();
      mgr.applyChanges(first, makeContext(root, configPath));

      // Add a new skill
      writeFileSync(
        join(skillsDir, "another-skill.md"),
        "---\nname: another-skill\ndescription: Another\n---\n\nBody",
        "utf8",
      );

      // Second detection
      const second = mgr.detectChanges();
      expect(second.skills.length).toBeGreaterThan(0);
      expect(second.skills.some((s) => s.kind === "new")).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("detects skill file deletion", () => {
    const { root, configPath, snapPath, cleanup } = tmpProject();
    try {
      const skillsDir = join(root, ".reasonix", "skills");
      mkdirSync(skillsDir, { recursive: true });
      const skillFile = join(skillsDir, "to-delete.md");
      writeFileSync(
        skillFile,
        "---\nname: to-delete\ndescription: Will delete\n---\n\nBody",
        "utf8",
      );

      const mgr = new ReloadManager({ projectRoot: root, configPath });
      mgr.setSnapshotPath(snapPath);

      // Baseline
      mgr.applyChanges(mgr.detectChanges(), makeContext(root, configPath));

      // Delete skill
      rmSync(skillFile);

      // Detection
      const second = mgr.detectChanges();
      expect(second.skills.some((s) => s.kind === "removed")).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("ReloadManager updateSnapshot", () => {
  it("persists config and skills state to disk", () => {
    const { root, configPath, snapPath, cleanup } = tmpProject();
    try {
      const skillsDir = join(root, ".reasonix", "skills");
      mkdirSync(skillsDir, { recursive: true });
      writeFileSync(
        join(skillsDir, "test-skill.md"),
        "---\nname: test-skill\ndescription: Test\n---\n\nBody",
        "utf8",
      );

      const mgr = new ReloadManager({ projectRoot: root, configPath });
      mgr.setSnapshotPath(snapPath);

      // Apply changes to write snapshot
      mgr.applyChanges(mgr.detectChanges(), makeContext(root, configPath));

      // Verify snapshot file exists and is valid JSON
      const content = JSON.parse(readFileSync(snapPath, "utf8"));
      expect(content.version).toBe(1);
      expect(content.config).not.toBeNull();
      expect(content.config.mtime).toBeGreaterThan(0);
      expect(content.config.hash).toHaveLength(64); // SHA256 hex
      expect(content.skills.length).toBeGreaterThan(0);
      expect(content.lastReloadAt).toBeTruthy();
    } finally {
      cleanup();
    }
  });
});
