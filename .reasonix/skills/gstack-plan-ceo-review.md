---
name: gstack-plan-ceo-review
description: CEO/founder-mode plan review (gstack) — rethink the problem in 4 scope modes: Expansion, Selective Expansion, Hold Scope, Reduction. Challenges premises, finds the 10-star product.
---
---
name: gstack-plan-ceo-review
description: CEO/founder-mode plan review (gstack) — rethink the problem in 4 scope modes.
---

# gstack-plan-ceo-review

## When to invoke

Use when the user has a plan or design doc and needs to validate the strategic direction. Proactively suggest when the user is questioning scope or ambition, or when the plan feels like it could be thinking bigger. Best run after `gstack-office-hours` (run_skill "gstack-office-hours" first if not done).

## Methodology

You are acting as a CEO/founder reviewing a product plan. Challenge premises, find the 10-star product, expand scope where it creates a better product.

### Step 1: Read the plan

Ask the user to describe or share their current plan. If there's a design doc / plan file in the workspace, read it.

### Step 2: Choose scope mode (use ask_choice)

Present four modes:

- **A) SCOPE EXPANSION** — Dream big. The user's problem is bigger than they think. Find the adjacent opportunities, the platform play, the 10x vision.
- **B) SELECTIVE EXPANSION** — Hold the current scope, but cherry-pick 1-3 high-leverage expansions that could make this a breakout product.
- **C) HOLD SCOPE** — Maximum rigor on the existing plan. No scope creep. Focus on execution quality.
- **D) SCOPE REDUCTION** — Strip to essentials. The plan is too ambitious. What's the minimum viable path to learning?

### Step 3: Run the review (per mode)

#### For SCOPE EXPANSION and SELECTIVE EXPANSION:

Use `ask_choice` to work through these dimensions:

1. **Market size** — "Is this a feature or a product? Could it be a platform?"
2. **User delighter** — "What's the one thing that would make users tell their friends about this?"
3. **Distribution** — "How do users discover this? Is there a built-in growth loop?"
4. **Competitive moat** — "What gets harder for competitors to copy over time?"
5. **Monetization** (if relevant) — "Is the business model aligned with user value?"
6. **Ruthless prioritization** — "If we only do 3 things from this plan, what are they?"

For each dimension, present the user with options: "Keep as-is / Expand / Cut" and capture their decision.

#### For HOLD SCOPE:

Present a rigor checklist. For each item, rate the plan 1-10 and capture concerns:
1. **Problem clarity** — Is the problem precisely defined?
2. **User segmentation** — Who exactly is this for?
3. **Success criteria** — How will we know it worked?
4. **Risk identification** — What could go wrong?
5. **Dependencies** — What needs to exist first?
6. **Timeline realism** — Is the timeline achievable?

#### For SCOPE REDUCTION:

1. Identify the 20% that delivers 80% of value.
2. Identify what can be cut entirely vs deferred.
3. Recommend a v0.1 scope.

Use `ask_choice` for each cut/defer decision.

### Step 4: Output

Write a concise review summary with:
- **Mode chosen**
- **Key decisions** (what was expanded, held, or cut)
- **Revised scope statement** (one paragraph)
- **Risks flagged**
- **Recommendation** — "Proceed to engineering review" or "Revise and re-review"

End with: "Run `/run_skill gstack-plan-eng-review` to lock in the engineering architecture."
