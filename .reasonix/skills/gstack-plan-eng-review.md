---
name: gstack-plan-eng-review
description: Eng manager-mode architecture review (gstack) — lock in data flow, state machines, edge cases, test matrix, security concerns before coding starts.
---
---
name: gstack-plan-eng-review
description: Eng manager-mode architecture review (gstack) — lock in architecture & implementation plan.
---

# gstack-plan-eng-review

## When to invoke

Use when the user has a plan or design doc and is about to start coding. Proactively suggest this skill to catch architecture issues before implementation. Best run after `gstack-plan-ceo-review` (run_skill "gstack-plan-ceo-review" first if not done).

## Methodology

You are acting as an Engineering Manager reviewing an implementation plan. Lock in architecture, data flow, edge cases, test coverage, performance, and failure modes.

### Step 1: Read the plan

Ask the user to describe or share their implementation plan. Read any design doc / spec files in the workspace.

### Step 2: Run the engineering review

Work through each section using `ask_choice` for key decisions. Present one section at a time, wait for user input.

#### Section A: Data Flow & Architecture

Use `ask_choice` to check:
- **Data flow diagram** — "Can you sketch (or describe) the data flow? What enters the system, what transforms it, what leaves?"
  - Options: "Clear / Fuzzy / Missing — needs design"
- **State management** — "What states can each entity be in? Is there a state machine diagram?"
  - Options: "Covered / Partial / Missing"
- **Boundaries** — "Where are the system boundaries? What's in scope vs out of scope?"
  - Options: "Well-defined / Ambiguous / Not defined"

#### Section B: API / Interface Design

Check (use `ask_choice` for each):
- **API contract** — "Is the API/fn signature defined? Request/response shapes?"
- **Error handling** — "What happens when X fails? Database down, network timeout, invalid input?"
- **Backward compatibility** — "Does this change existing behavior? How do we migrate?"

#### Section C: Data & Storage

- **Schema changes** — "What DB migrations are needed?"
- **Data volume** — "How much data? Growth rate? Query patterns?"
- **Caching strategy** — "What's cached? Invalidation policy?"

#### Section D: Failure Modes

Use `ask_choice` — present each failure mode and rate the plan:
1. **Graceful degradation** — "What breaks if a dependency is down?"
2. **Race conditions** — "Can two operations happen at the same time and conflict?"
3. **Data integrity** — "What prevents corrupt/duplicate data?"
4. **Rollback** — "How do we undo if this goes wrong?"

Options per item: "Mitigated / Acknowledged but not addressed / Not considered"

#### Section E: Test Strategy

Use `ask_choice`:
- **Unit tests** — "What are the key units to test? Coverage target?"
- **Integration tests** — "What real dependencies need testing?"
- **Edge cases** — "List 5 edge cases the plan should cover."
- **Performance tests** — "Is there a perf requirement or benchmark?"

Options: "Planned / Not planned / N/A"

#### Section F: Security (lightweight)

- **Auth/Authz** — "Who can do what? Is auth modeled?"
- **Input validation** — "What user-controlled input enters the system?"
- **Secret management** — "Where are API keys / credentials stored?"

Options: "Covered / Partial / Not addressed"

### Step 3: Architecture decisions (use ask_choice)

For any ambiguous or high-risk areas, present concrete options:
- "Option A: [approach with tradeoffs]"
- "Option B: [alternative approach]"
- "Which should we use?"

### Step 4: Output

Write a review document including:
- **Architecture overview** (ASCII diagram or bullet list of components)
- **Key decisions** (with rationale)
- **Risk table** (what could go wrong, severity, mitigation)
- **Test matrix** (what to test, how)
- **Open questions** (things to resolve before coding)
- **Readiness verdict**: "Ready to implement" / "Need design revisions" / "Blocked on decisions"

End with: "Run `/run_skill gstack-qa` when you have a deployable build for testing."
