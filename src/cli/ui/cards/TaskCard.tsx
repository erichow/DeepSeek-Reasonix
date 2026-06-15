import { Box, type Color, Text } from "ink";
// biome-ignore lint/style/useImportType: tsconfig jsx=react needs React in value scope for JSX compilation
import React from "react";
import { t } from "../../../i18n/index.js";
import { Card } from "../primitives/Card.js";
import { CardHeader } from "../primitives/CardHeader.js";
import { Pill, pillPath } from "../primitives/Pill.js";
import { PULSE_TRIANGLE, Pulse } from "../primitives/Pulse.js";
import type { TaskCard as TaskCardData, TaskStep } from "../state/cards.js";
import { useThemeTokens } from "../theme/context.js";
import { FG, TONE, formatCost } from "../theme/tokens.js";

const STEP_GLYPH: Record<TaskStep["status"], string> = {
  queued: "○",
  running: "●",
  done: "✓",
  failed: "✗",
};

const TASK_GLYPH: Record<TaskCardData["status"], string> = {
  running: "●",
  done: "✓",
  failed: "✗",
};

export function TaskCard({ card }: { card: TaskCardData }): React.ReactElement {
  const { fg, tone } = useThemeTokens();
  const stepColor: Record<TaskStep["status"], Color> = {
    queued: fg.faint,
    running: tone.warn,
    done: tone.ok,
    failed: tone.err,
  };
  const taskColor: Record<TaskCardData["status"], Color> = {
    running: tone.warn,
    done: tone.ok,
    failed: tone.err,
  };
  const elapsed = `${(card.elapsedMs / 1000).toFixed(1)}秒`;
  const meta: import("../primitives/CardHeader.js").MetaItem[] = [elapsed, card.status];
  if (card.roundCostUsd !== undefined && card.roundCostUsd > 0) {
    meta.push({
      text: formatCost(card.roundCostUsd, undefined, 4, "fen"),
      color: TONE.warn,
      bold: true,
    });
  }
  return (
    <Card tone={taskColor[card.status]}>
      <CardHeader
        glyph={
          card.status === "running" ? (
            <Pulse active frames={PULSE_TRIANGLE} settled="▶" color={taskColor[card.status]} />
          ) : (
            TASK_GLYPH[card.status]
          )
        }
        tone={taskColor[card.status]}
        title={t("cardTitles.task")}
        subtitle={`${card.index} / ${card.total}  ${card.title}`}
        meta={meta}
      />
      {card.steps.map((step) => (
        <Box key={step.id} flexDirection="row" gap={1}>
          {step.status === "running" ? (
            <Pulse active frames={PULSE_TRIANGLE} settled="▶" color={stepColor[step.status]} />
          ) : (
            <Text color={stepColor[step.status]}>{STEP_GLYPH[step.status]}</Text>
          )}
          <Text bold color={fg.body}>
            {(step.toolName ?? t("cardLabels.stepLabel")).padEnd(7)}
          </Text>
          <Pill label={step.title} {...pillPath()} bold={false} />
          {step.detail ? <Text color={fg.faint}>{step.detail}</Text> : null}
          {step.elapsedMs !== undefined ? (
            <Text color={fg.faint}>{`${(step.elapsedMs / 1000).toFixed(2)}秒`}</Text>
          ) : null}
        </Box>
      ))}
    </Card>
  );
}
