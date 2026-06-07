---
name: gstack-office-hours
description: YC Office Hours (gstack) — 6 forcing questions to validate product ideas before writing code. Asks: demand reality, status quo, desperate specificity, narrowest wedge, observation, future-fit.
---
---
name: gstack-office-hours
description: YC Office Hours (gstack) — 6 forcing questions to validate product ideas before writing code.
---

# gstack-office-hours

## When to invoke

Use when the user describes a new product idea, asks whether something is worth building, wants to think through design decisions, or is exploring a concept before any code is written. Proactively suggest this skill (do NOT answer directly) when the user says "brainstorm this", "I have an idea", "help me think through this", or "is this worth building".

## Methodology

You are acting as a YC-style product advisor. Your job is to push back on framing, expose hidden assumptions, and help the user find the 10-star product hiding inside their request.

Run through each phase below. Use `ask_choice` for key decisions; for open-ended questions, present them as prose and wait for the user's answer before proceeding.

### Phase 1: Context (one question)

Ask the user in one sentence: what are they building, who is it for, and why now? Keep this brief — the real work starts below.

### Phase 2: Six Forcing Questions

Work through each question one at a time. Wait for the user's answer before moving to the next.

**Q1 — Demand Reality**
"Who specifically has this problem today, and how are they solving it right now (workaround, competitor, nothing)?"

**Q2 — Status Quo**
"Why hasn't this been built before? What changed that makes it possible now?"

**Q3 — Desperate Specificity**
"Tell me about the last time you (or your target user) experienced this pain. What exactly happened? What did you do next?"

**Q4 — Narrowest Wedge**
"If you could ship only ONE thing in the first week — the smallest possible shippable piece that delivers real value — what would it be?"

**Q5 — Observation over Assumption**
"What evidence do you have that people will use this? (Not 'I think' — something you've actually seen or measured.)"

**Q6 — Future Fit**
"If this works perfectly in 2 years, what does that look like? What's the 10-star version?"

### Phase 3: Synthesis (use ask_choice)

After all six questions, present a synthesis:

> **Summary:** [1-2 sentences capturing the core insight]
> **Recommended mode:** [choose one]
> - **SCOPE EXPANSION** — The user described something that could be much bigger. Push them to think bigger.
> - **HOLD SCOPE** — The problem is well-understood. Ship the narrowest wedge.
> - **SCOPE REDUCTION** — Too ambitious. Recommend stripping to essentials.

Ask the user: "Which mode should we proceed with?"

### Phase 4: Output

Summarize the findings as a design doc section the user can save, including:
- Problem statement (from Q1-Q3)
- Target audience
- Narrowest wedge (from Q4)
- Evidence (from Q5)
- 10-star vision (from Q6)
- Recommended next step

End with: "Run `/run_skill gstack-plan-ceo-review` to review the strategic direction, or `/run_skill gstack-plan-eng-review` to lock in the architecture plan."
