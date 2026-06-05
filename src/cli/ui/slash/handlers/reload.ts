import { readConfig, clearConfigCache } from "@/config.js";
import { ReloadManager } from "@/reload/manager.js";
import type { SlashHandler } from "../dispatch.js";

function formatLine(label: string, ok: boolean, detail: string): string {
  const icon = ok ? "✓" : "✗";
  return `  ${icon} ${label}: ${detail}`;
}

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

  // Detect changes
  const changes = manager.detectChanges();

  // If no changes at all
  if (!changes.hasAny) {
    return { info: "✓ 一切均为最新 — Config / Skills / MCP 均未检测到变更" };
  }

  // Sub-command filter
  const lines: string[] = [];
  let hasWork = false;

  // Config
  if (sub === "" || sub === "config") {
    if (changes.config === "changed" || changes.config === "new") {
      hasWork = true;
      lines.push("", "  Config:");
      for (const d of changes.configDetails) {
        lines.push(formatLine(`• ${d.name}`, true, d.detail ?? ""));
      }
      // Apply config changes
      clearConfigCache(configPath);
      const cfg = readConfig(configPath);
      const cfgOpts: Record<string, unknown> = {};
      if (cfg.model) cfgOpts.model = cfg.model;
      if (cfg.stream !== undefined) cfgOpts.stream = cfg.stream;
      if (cfg.reasoningEffort) cfgOpts.reasoningEffort = cfg.reasoningEffort;
      if (cfg.maxOutputTokens !== undefined) cfgOpts.maxOutputTokens = cfg.maxOutputTokens;

      if (Object.keys(cfgOpts).length > 0) {
        loop.configure(
          cfgOpts as { model?: string; stream?: boolean; reasoningEffort?: string; maxOutputTokens?: number },
        );
        lines.push(formatLine("  runtime", true, `model/stream/effort/tokens 已更新`));
      }
      if (cfg.budgetUsd !== undefined) {
        loop.setBudget(cfg.budgetUsd ?? null);
        lines.push(formatLine("  budget", true, `预算已更新: ${cfg.budgetUsd ?? "无上限"}`));
      }
      loop.rebuildSystemPrompt();
      lines.push(formatLine("  system", true, "系统提示已重建"));
    } else {
      lines.push("", "  Config: 无变更");
    }
  }

  // Skills
  if (sub === "" || sub === "skills") {
    if (changes.skills.length > 0) {
      hasWork = true;
      lines.push("", "  Skills:");
      for (const s of changes.skills) {
        const icon = s.kind === "removed" ? "—" : s.kind === "new" ? "+" : "~";
        lines.push(`    ${icon} ${s.name}  ${s.detail ?? ""}`);
      }
      loop.rebuildSystemPrompt();
      lines.push(formatLine("  index", true, "技能索引已更新（下次 API 调用生效）"));
    } else {
      lines.push("", "  Skills: 无变更");
    }
  }

  // MCP
  if (sub === "" || sub === "mcp") {
    if (changes.mcp === "changed" || changes.mcp === "new") {
      hasWork = true;
      lines.push("", "  MCP:");
      lines.push(formatLine("  config", true, "检测到变更，触发重载..."));
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
        lines.push(formatLine("  reload", true, "后台重载中（结果将稍后显示）"));
      } else {
        lines.push(formatLine("  reload", false, "MCP 重载不可用（无 reloadMcp 上下文）"));
      }
    } else {
      lines.push("", "  MCP: 无变更");
    }
  }

  if (!hasWork) {
    lines.push("  (所请求的模块无变更)");
  }

  // Save updated snapshot
  manager.applyChanges(changes, {
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
    mcpReload: ctx.reloadMcp ?? (async () => ({ added: [], removed: [], failed: [], summaries: [] })),
    skillStore: {
      list: () => [],
    },
    configPath,
    projectRoot: codeRoot,
    homeDir: ctx.homeDir ?? "",
  });

  return { info: [`✓ 重载完成`, ...lines].join("\n") };
};

export const handlers: Record<string, SlashHandler> = { reload };
