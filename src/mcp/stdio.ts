/** MCP stdio = newline-delimited JSON-RPC; transport iface lets tests fake it without spawning. */

import { type ChildProcess, spawn } from "node:child_process";
import type { JsonRpcMessage } from "./types.js";

export interface McpTransport {
  /** Send one JSON-RPC message. Resolves when the bytes are accepted. */
  send(message: JsonRpcMessage): Promise<void>;
  /** Async iterator over incoming messages. Ends when the connection closes. */
  messages(): AsyncIterableIterator<JsonRpcMessage>;
  /** Close the underlying resource (kill child process, close streams). */
  close(): Promise<void>;
}

export interface StdioTransportOptions {
  /** Argv to spawn. First element is the command. */
  command: string;
  args?: string[];
  /** Env overlay — merged over process.env unless replaceEnv=true. */
  env?: Record<string, string>;
  /** When true, only the env above is visible to the child. Default false. */
  replaceEnv?: boolean;
  /** CWD for the child. Default: process.cwd(). */
  cwd?: string;
  /** Default true on win32 to resolve `.cmd`/`.bat` wrappers (npx.cmd etc.). */
  shell?: boolean;
}

export class StdioTransport implements McpTransport {
  /**
   * Create a StdioTransport with exponential-backoff retry for transient
   * spawn failures. Spawns the child; if the process exits immediately
   * with a non-zero code or emits a transport error, retries up to
   * `maxRetries` times (default 4, total 5 tries).
   *
   * Returns `null` if all attempts fail — caller should surface the
   * last error to the user. The retry is suitable for servers that
   * are still starting up (e.g. waiting on a port, compiling once).
   */
  static async spawnWithRetry(
    opts: StdioTransportOptions,
    maxRetries = 4,
  ): Promise<{ transport: StdioTransport } | { error: string }> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await StdioTransport.trySpawn(opts);
      if ("transport" in result) return result;
      if (attempt < maxRetries) {
        const delay = Math.min(500 * 2 ** attempt, 8_000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    return { error: `StdioTransport failed after ${maxRetries + 1} attempts` };
  }

  private static trySpawn(
    opts: StdioTransportOptions,
  ): Promise<{ transport: StdioTransport } | { error: string }> {
    return new Promise((resolve) => {
      const transport = new StdioTransport(opts);
      // If the child exits quickly (e.g. command not found), catch it.
      const onClose = () => {
        if (transport.child.exitCode !== null && transport.child.exitCode !== 0) {
          transport.cleanupListeners();
          resolve({ error: `process exited with code ${transport.child.exitCode}` });
        } else if (transport.child.exitCode === null) {
          // Still running — resolve optimistically (handshake will validate).
          transport.cleanupListeners();
          resolve({ transport });
        }
      };
      const onError = (err: Error) => {
        transport.cleanupListeners();
        resolve({ error: err.message });
      };
      transport.child.on("close", onClose);
      transport.child.on("error", onError);
      // If the child is still running after a tick, treat as success.
      // The handshake in reconnectMcpServer will catch invalid servers.
      setImmediate(() => {
        if (transport.child.exitCode === null) {
          transport.cleanupListeners();
          resolve({ transport });
        }
      });
    });
  }

  private cleanupListeners(): void {
    this.child.removeAllListeners("close");
    this.child.removeAllListeners("error");
  }
  private readonly child: ChildProcess;
  private readonly queue: JsonRpcMessage[] = [];
  private readonly waiters: Array<(m: JsonRpcMessage | null) => void> = [];
  private closed = false;
  private stdoutBuffer = "";

  constructor(opts: StdioTransportOptions) {
    const env = opts.replaceEnv ? { ...(opts.env ?? {}) } : { ...process.env, ...(opts.env ?? {}) };
    // Windows wraps binaries as .cmd/.bat shims (npx.cmd, pnpm.cmd, …).
    // child_process.spawn without shell:true can't resolve them, which
    // breaks `--mcp "npx -y some-server"` — the most common MCP setup.
    // Default shell:true on win32 and leave POSIX alone.
    const shell = opts.shell ?? process.platform === "win32";

    if (shell) {
      // Node's shell:true + args[] triggers DEP0190 because it concatenates
      // with spaces and doesn't quote args — unsafe if an arg contains
      // shell metacharacters. We build a single command line ourselves,
      // quoting ONLY the args (command stays bare so the shell's PATH /
      // PATHEXT lookup finds `npx` → `npx.cmd` on Windows).
      const line = [
        opts.command,
        ...(opts.args ?? []).map((a) => quoteArg(a, process.platform === "win32")),
      ].join(" ");
      this.child = spawn(line, [], {
        env,
        cwd: opts.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
      });
    } else {
      this.child = spawn(opts.command, opts.args ?? [], {
        env,
        cwd: opts.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
    }
    this.child.stdout!.setEncoding("utf8");
    this.child.stdout!.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr!.setEncoding("utf8");
    this.child.stderr!.on("data", (chunk: string) => this.onStderr(chunk));
    this.child.on("close", () => this.onClose());
    this.child.on("error", (err) => {
      // Surface spawn errors as a synthetic JsonRpcError so callers don't
      // hang on a stream that never emits anything.
      this.push({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: `transport error: ${err.message}` },
      });
    });
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (this.closed) throw new Error("MCP transport is closed");
    return new Promise((resolve, reject) => {
      const line = `${JSON.stringify(message)}\n`;
      this.child.stdin!.write(line, "utf8", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async *messages(): AsyncIterableIterator<JsonRpcMessage> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<JsonRpcMessage | null>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next === null) return; // closed while we were waiting
      yield next;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // Signal any pending waiters.
    while (this.waiters.length > 0) this.waiters.shift()!(null);
    try {
      this.child.stdin!.end();
    } catch {
      /* already ended */
    }
    if (this.child.exitCode === null && !this.child.killed) {
      // child.kill("SIGTERM") throws EINVAL on Windows; plain kill()
      // can also throw on failed spawns. Swallow both.
      try {
        this.child.kill(process.platform === "win32" ? undefined : "SIGTERM");
      } catch {
        /* already exited or unsignallable */
      }
    }
  }

  /** Parse incoming stdout chunks into NDJSON messages. */
  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIdx: number;
    // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic loop shape
    while ((newlineIdx = this.stdoutBuffer.indexOf("\n")) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        this.push(msg);
      } catch {
        // Malformed stdout lines are dropped — some servers emit startup
        // banners before the JSON-RPC loop begins. Surface only under
        // REASONIX_DEBUG_MCP=1; otherwise the noise corrupts the TUI render.
        if (process.env.REASONIX_DEBUG_MCP === "1") {
          process.stderr.write(`[mcp-stdio] dropped malformed line: ${line}\n`);
        }
      }
    }
  }

  // Python MCP SDK writes info logs (`server.py:534 ListPromptsRequest`)
  // to stderr — letting those through would corrupt the TUI render.
  private onStderr(chunk: string): void {
    if (process.env.REASONIX_DEBUG_MCP === "1") {
      process.stderr.write(chunk);
    }
  }

  private onClose(): void {
    this.closed = true;
    while (this.waiters.length > 0) this.waiters.shift()!(null);
  }

  private push(msg: JsonRpcMessage): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(msg);
    else this.queue.push(msg);
  }
}

function quoteArg(s: string, windows: boolean): string {
  if (!windows) {
    // POSIX: single-quote, escape single quotes.
    return `'${s.replace(/'/g, "'\\''")}'`;
  }
  // cmd.exe: double-quote, escape internal quotes by doubling.
  return `"${s.replace(/"/g, '""')}"`;
}
