# `/reload` 命令设计

> 检测并热重载 Config / Skills / MCP 的变更

## 概述

新增 `/reload` 斜杠命令，自动检测配置、技能和 MCP server 的变更，并触发热重载。采用混合策略（mtime 快速扫描 + hash 确认）进行变更检测，快照持久化到 `.reasonix/reload-snapshot.json`，支持跨 session 感知。

## 架构

```
/reload 命令
    │
    ▼
ReloadManager.detectChanges()
    │
    ├── Config   → 清缓存重读 → 与 snapshot 对比 hash
    ├── Skills   → 扫描 skill 文件 mtime → 与 snapshot 对比 hash
    └── MCP      → 对比 normalizeMcpConfig() 结果 hash
    │
    ▼
ReloadManager.applyChanges()
    │
    ├── Config   → loop.configure() + prefix.replaceSystem()
    ├── Skills   → SkillStore.forceRescan() + prefix.replaceSystem()
    └── MCP      → ctx.reloadMcp() (复用已有)
    │
    ▼
保存新 snapshot → 输出摘要 + 详情
```

## 组件详述

### 1. Snapshot — `.reasonix/reload-snapshot.json`

```json
{
  "version": 1,
  "config": {
    "mtime": 1700000000,
    "hash": "sha256-..."
  },
  "skills": [
    {
      "name": "explore",
      "scope": "builtin",
      "mtime": 0,
      "path": "builtin://explore",
      "hash": "sha256-..."
    }
  ],
  "mcp": {
    "hash": "sha256-...",
    "specNames": ["filesystem", "github"]
  },
  "lastReloadAt": "2026-05-29T10:30:00Z"
}
```

- 路径: `<project>/.reasonix/reload-snapshot.json`
- 写策略: 原子写入 (tmp → rename)，与 `slash-usage.json` 同模式
- 不存在时 → `detectChanges()` 将所有项标记为 `"new"`（首次运行自动建立基线）

### 2. ReloadManager — `src/reload/manager.ts`

**`detectChanges()` 流程:**

```
1. 读 snapshot (不存在 → 空基线)
2. Config:
   a. stat config.json → 取 mtime
   b. mtime 与 snapshot 一致 → 跳过
   c. 不一致 → 读内容 → SHA256 → 对比 hash
   d. hash 一致 → 更新 snapshot mtime (touch 但没有内容变更)
   e. hash 不一致 → 标记 "changed"
3. Skills:
   a. 获取 SkillStore.roots() 下所有技能文件列表
   b. 对每个文件: (mtime, hash) 对比 → 标记 added/changed/removed
4. MCP:
   a. normalizeMcpConfig(readConfig({ force: true })) → JSON → SHA256
   b. 对比 hash → 标记 changed/unchanged
5. 返回 Changes 对象
```

**`applyChanges(changes, loop, ctx)` 流程:**

```
按顺序执行 (MCP 依赖更新后的配置):
1. Config 变更:
   - model / stream / reasoningEffort / maxOutputTokens → loop.configure()
   - budgetUsd → loop.setBudget()
   - 其他 → 在 snapshot 中记录变更，部分通过 UI dispatch 刷新
2. Skills 变更:
   - SkillStore.forceRescan() 清除内部缓存
   - rebuildSystemPrompt() → prefix.replaceSystem() 更新技能索引
3. MCP 变更:
   - ctx.reloadMcp() → 复用现有 reloadFromConfig()
4. 写入更新后的 snapshot
```

### 3. Config 重载细节

| 字段类别 | 字段 | 处理方式 |
|---|---|---|
| 运行时 | `model`, `stream`, `reasoningEffort`, `maxOutputTokens` | `loop.configure()` 即时生效 |
| 预算 | `budgetUsd` | `loop.setBudget()` |
| MCP | `mcpServers`, `mcp`, `mcpDisabled` | 触发 MCP 重载 |
| Skills | `skills.paths`, `subagentModels` | 触发 Skills 重载 |
| 显示 | `theme`, `lang` | 通过 `ctx.dispatch` 触发 UI 刷新 |
| 其他 | `proxy`, `rateLimit`, `pricingOverride` | 仅 snapshot 记录，提示重启完全生效 |

### 4. Skills 重载细节

- `SkillStore.forceRescan()`: 清除内部 `byName` 缓存，下次 `list()`/`read()` 重新扫描磁盘
- `rebuildSystemPrompt()`: 调用 `this.prefix.replaceSystem(this._rebuildSystem())` — 与 `clearLog()` 中已有模式一致，但不触发清空历史
- 技能索引更新后，下一轮 API 调用自动携带新的技能列表（代价：一次前缀缓存未命中）

### 5. MCP 重载

- 完全复用已有的 `mcpRuntime.reloadFromConfig(loop)` 和 `ctx.reloadMcp!()`
- `/reload` 只负责调用并收集结果

### 6. 变更检测 — 混合策略

```
mtime 对比 (O(1) stat):
  └── 一致 → 跳过 (无变更)
  └── 不一致 → 读内容 → SHA256
       └── hash 一致 → 仅更新 snapshot mtime (touch)
       └── hash 不一致 → 标记 changed
```

适用场景:
- `touch config.json` (不修改内容) → mtime 变但 hash 不变 → 不触发重载
- 编辑技能文件后撤销 → mtime 和 hash 都恢复到原值 → 不触发重载 (因为 hash 一致)
- 实际修改内容 → mtime 变 + hash 变 → 触发重载

### 7. 输出格式

**无变更:**
```
✓ 一切均为最新 — Config / Skills / MCP 均未检测到变更
```

**有变更:**
```
✓ 重载完成 (3 项变更, 0 项失败)

  Config:
    • 变更: model (pro → flash), proxy (新增)
    • 已应用 ✓

  Skills:
    • 新增: my-helper
    • 变更: code-review
    • 已应用 ✓ (下次 API 调用生效)

  MCP:
    • 新增: filesystem ✓
    • 变更: github ✓
```

**有失败:**
```
  MCP:
    • 新增: filesystem ✓
    • 变更: github — ✗ 连接失败 (ECONNREFUSED)
```

### 8. 子命令支持

- `/reload` — 无参数时检测所有三项，只重载有变更的部分
- `/reload config` — 仅检测并重载配置
- `/reload skills` — 仅检测并重载技能
- `/reload mcp` — 仅检测并重载 MCP server
- 子命令的目的是**跳过检测**（不需要的文件直接不 stat），提升性能

## 文件清单

### 新增文件

| 文件 | 估算行数 |
|---|---|
| `src/reload/types.ts` | ~50 |
| `src/reload/manager.ts` | ~180 |
| `src/cli/ui/slash/handlers/reload.ts` | ~60 |

### 修改文件

| 文件 | 改动 | 行数 |
|---|---|---|
| `src/config.ts` | 暴露 `clearConfigCache()` | +3 |
| `src/skills.ts` | 加 `SkillStore.forceRescan()` | +8 |
| `src/loop.ts` | 加 `rebuildSystemPrompt()` 公共方法 | +10 |
| `src/cli/ui/slash/commands.ts` | 加 `/reload` 命令注册 | +1 |
| `src/cli/ui/slash/dispatch.ts` | 导入 reloadHandlers | +2 |

## 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| prefix.replaceSystem() 导致缓存未命中 | 低 | 预期行为，用户执行 `/reload` 时已接受 |
| rebuildSystem 可能抛异常 | 低 | 复用 clearLog 的 try/catch 模式 |
| MCP 部分失败 | 中 | reloadFromConfig 是增量的，失败只影响单个 server |
| snapshot 写入竞争 | 低 | 原子写入 (tmp → rename) |
| 快照文件不存在（首次运行） | 低 | detectChanges 优雅降级为全量标记 "new" |

## 测试策略

- `src/reload/manager.test.ts`:
  - 空 snapshot（首次运行）→ 全量标记为 "new"
  - mtime 无变化 → 跳过
  - mtime 变但 hash 不变（touch）→ 只更新 mtime
  - mtime 变且 hash 变 → 标记 changed
  - 技能文件新增/删除 → 正确标记
  - 配置无变更 → MCP hash 不变 → 不触发重载
- `src/reload/manager.test.ts` (集成):
  - 在 tmp 目录创建 config.json + 技能文件 → 执行 detectChanges → 验证结果
  - 修改其中一个文件 → 再次 detectChanges → 只有被改的文件标记 changed

## 非功能性需求

- 变更检测应在 100ms 内完成（绝大多数 stat 操作，小范围 hash 计算）
- snapshot 文件 < 10KB（仅存储元数据）
- 不引入新的外部依赖（crypto 模块已可用）

## 未来扩展

- Hooks 变更检测（当前 hooks 已有 `/hooks reload` 命令）
- `.mcp.json` 变更检测
- theme/lang 的即时 UI 刷新
- Config 中 proxy/rateLimit 的即时生效
