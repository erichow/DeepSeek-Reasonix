import type { TurnStats } from "../../../telemetry/stats.js";
import { inputCostUsd, outputCostUsd } from "../../../telemetry/stats.js";
import type { Scrollback } from "../hooks/useScrollback.js";

export class TurnTranslator {
  private reasoningCardId: string | null = null;
  private streamingCardId: string | null = null;
  private toolCardId: string | null = null;
  private toolStartedAt = 0;
  /** Timestamp (epoch ms) when the model first produced output this turn. */
  private turnStartedAt = 0;

  constructor(private readonly log: Scrollback) {}

  flushBuffers(
    reasoningChunk: string,
    contentChunk: string,
    model?: string,
    resolvedEffort?: "low" | "medium" | "high" | "max",
  ): void {
    if (!this.turnStartedAt) this.turnStartedAt = Date.now();
    if (reasoningChunk) {
      if (!this.reasoningCardId)
        this.reasoningCardId = this.log.startReasoning(model, resolvedEffort);
      this.log.appendReasoning(this.reasoningCardId, reasoningChunk);
    }
    if (contentChunk) {
      if (!this.streamingCardId) this.streamingCardId = this.log.startStreaming(model);
      this.log.appendStreaming(this.streamingCardId, contentChunk);
    }
  }

  /** Wall-clock ms since the model first produced output this turn, or 0 if not yet started. */
  get turnElapsedMs(): number {
    return this.turnStartedAt > 0 ? Date.now() - this.turnStartedAt : 0;
  }

  toolStart(name: string, args: unknown, callId?: string): void {
    this.toolStartedAt = Date.now();
    // callId from the loop event is the inflight-set key — using it as
    // the card id lets the UI derive `running` from `loop.inflight.has(card.id)`.
    this.toolCardId = this.log.startTool(name, args, callId);
  }

  toolEnd(output: string): void {
    if (this.toolCardId) {
      this.log.endTool(this.toolCardId, {
        output,
        elapsedMs: Date.now() - this.toolStartedAt,
      });
      this.toolCardId = null;
    }
  }

  toolAbort(output?: string): void {
    if (this.toolCardId) {
      this.log.endTool(this.toolCardId, {
        output,
        elapsedMs: Date.now() - this.toolStartedAt,
        aborted: true,
      });
      this.toolCardId = null;
    }
  }

  toolRetry(attempt: number, max: number): void {
    if (this.toolCardId) this.log.retryTool(this.toolCardId, attempt, max);
  }

  reasoningDone(reasoningText: string): void {
    if (!this.reasoningCardId) return;
    const paragraphs = reasoningText ? reasoningText.split(/\n\s*\n/).length : 0;
    const tokens = Math.round(reasoningText.length / 4);
    this.log.endReasoning(this.reasoningCardId, paragraphs, tokens);
    this.reasoningCardId = null;
  }

  streamingDone(): void {
    if (!this.streamingCardId) return;
    this.log.endStreaming(this.streamingCardId);
    this.streamingCardId = null;
  }

  turnEnd(
    stats: TurnStats,
    reasoningText: string,
    extras?: { promptCap?: number; elapsedMs?: number; sessionCacheHit?: number },
  ): void {
    const outputTokens = stats.usage.completionTokens;
    const reasonTokens = Math.round(reasoningText.length / 4);
    // Input (prompt) cost → UserCard; reasoning output cost → ReasoningCard;
    // reply output cost → StreamingCard; all three add up to total cost.
    const inputCost = inputCostUsd(stats.model, stats.usage);
    const outputCost = outputCostUsd(stats.model, stats.usage);
    const reasonOutputCost =
      outputTokens > 0 && reasonTokens > 0 ? (outputCost * reasonTokens) / outputTokens : 0;
    this.log.endTurn(
      {
        prompt: stats.usage.promptTokens,
        reason: reasonTokens,
        output: outputTokens,
        cacheHit: stats.cacheHitRatio,
        cost: stats.cost,
        inputCost,
        reasonCost: reasonOutputCost,
      },
      extras,
    );
  }

  abort(): void {
    if (this.streamingCardId) {
      this.log.endStreaming(this.streamingCardId, true);
      this.streamingCardId = null;
    }
    if (this.reasoningCardId) {
      this.log.endReasoning(this.reasoningCardId, 0, 0, true);
      this.reasoningCardId = null;
    }
    if (this.toolCardId) {
      this.log.endTool(this.toolCardId, {
        elapsedMs: Date.now() - this.toolStartedAt,
        aborted: true,
      });
      this.toolCardId = null;
    }
    this.log.abortTurn();
  }
}
