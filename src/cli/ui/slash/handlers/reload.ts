import { ReloadManager } from "@/reload/manager.js";
import type { Changes } from "@/reload/types.js";
import type { SlashHandler } from "../dispatch.js";

const reload: SlashHandler = (args, loop, ctx) => {
  const sub = (args[0] ?? "").toLowerCase();
  const validSubs = new Set(["", "config", "skills", "mcp"]);
  if (!validSubs.has(sub)) {
    return { info: "用法: /reload [config|skills|mcp] — 不带参数时检测并重载所有变更" };
  }

  const configPath = ctx.configPath;
  const codeRoot = ctx.codeRoot ?? process.cwd();
  if (!configPath) {
    return { info: "✗ 无法确定配置路径" };
  }

  const manager = new ReloadManager({
    projectRoot: codeRoot,
    homeDir: ctx.homeDir,
    configPath,
  });

  const changes = manager.detectChanges();

  if (!changes.hasAny) {
    return { info: "✓ 一切均为最新 — Config / Skills / MCP 均未检测到变更" };
  }

  // Build filtered Changes so applyChanges only touches requested modules
  const includeAll = sub === "";
  const filteredChanges: Changes = {
    config: includeAll || sub === "config" ? changes.config : "unchanged",
    configDetails: includeAll || sub === "config" ? changes.configDetails : [],
    skills: includeAll || sub === "skills" ? changes.skills : [],
    mcp: includeAll || sub === "mcp" ? changes.mcp : "unchanged",
    mcpDetails: includeAll || sub === "mcp" ? changes.mcpDetails : [],
    hasAny: false,
  };
  filteredChanges.hasAny =
    filteredChanges.config === "changed" ||
    filteredChanges.config === "new" ||
    filteredChanges.skills.length > 0 ||
    filteredChanges.mcp === "changed" ||
    filteredChanges.mcp === "new";

  // Apply changes via ReloadManager (handles config + skills + snapshot)
  const report = manager.applyChanges(filteredChanges, {
    loop: {
      model: loop.model,
      stream: loop.stream,
      reasoningEffort: loop.reasoningEffort,
      maxOutputTokens: loop.maxOutputTokens,
      budgetUsd: loop.budgetUsd,
      configure: (opts) => loop.configure(opts),
      setBudget: (usd) => loop.setBudget(usd),
      rebuildSystemPrompt: () => loop.rebuildSystemPrompt(),
    },
    mcpReload: async () => ({ added: [], removed: [], failed: [], summaries: [] }),
    configPath,
    projectRoot: codeRoot,
    homeDir: ctx.homeDir ?? "",
  });

  // Build display text from the report
  const lines: string[] = [];

  if (report.config.length > 0) {
    lines.push("", "  Config:");
    for (const r of report.config) {
      lines.push(`  ${r.ok ? "✓" : "✗"} ${r.detail}`);
    }
  }

  if (report.skills.length > 0) {
    lines.push("", "  Skills:");
    for (const r of report.skills) {
      lines.push(`  ${r.ok ? "✓" : "✗"} ${r.detail}`);
    }
  }

  if (report.mcp.length > 0) {
    lines.push("", "  MCP:");
    lines.push("  ✓ 检测到变更，触发重载...");
    // Fire async MCP reload — results arrive via postInfo
    if (ctx.reloadMcp) {
      ctx.reloadMcp().then((result) => {
        const details: string[] = [];
        for (const name of result.added) details.push(`    + ${name} ✓`);
        for (const name of result.removed) details.push(`    — ${name}`);
        for (const f of result.failed) details.push(`    ✗ ${f.spec}: ${f.reason}`);
        if (ctx.postInfo) {
          ctx.postInfo(`MCP 重载结果:\n${details.join("\n")}`);
        }
      });
      lines.push("  ✓ MCP 后台重载中（结果稍后显示）");
    } else {
      lines.push("  ✗ MCP 重载不可用（无 reloadMcp 上下文）");
    }
  }

  return { info: ["✓ 重载完成", ...lines].join("\n") };
};

export const handlers: Record<string, SlashHandler> = { reload };
