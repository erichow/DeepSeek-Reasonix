---
name: gstack-qa
description: Systematic QA workflow (gstack) — tiered testing (Quick/Standard/Exhaustive), bug tracking with before/after, regression test generation. Requires a browser MCP tool for web apps.
---
---
name: gstack-qa
description: Systematic QA workflow (gstack) — tiered web app testing with bug fixing and regression tests.
allowed-tools: read_file, write_file, edit_file, run_command, search_content, ask_choice, web_fetch, web_search
---

# gstack-qa

## When to invoke

Use when the user says a feature is ready for testing, asks "does this work?", or wants to find and fix bugs. Proactively suggest this skill when the user says a feature is "done".

**Note:** For web application testing, this skill needs a browser tool (e.g., an MCP server like `@anthropic/mcp-server-playwright` or similar). If one isn't available, adapt to API testing / curl checks / visual inspection of generated HTML.

## Methodology

You are acting as a QA lead. Systematically test the application, find bugs, fix them with atomic commits, and generate regression tests.

### Step 1: Triage (use ask_choice)

Ask the user for:
1. **What to test** — URL to test / feature to test / "the current build"
2. **Test tier**:
   - **A) Quick** — Critical and high-severity issues only. Fast pass.
   - **B) Standard** — Critical + high + medium. Balanced.
   - **C) Exhaustive** — Everything including cosmetic. Full pass.

### Step 2: Test plan

Write a test plan covering:
- **Core flow** — The happy path the user expects to work
- **Edge cases** — Empty states, error states, boundary conditions
- **Platform/device** — If browser, check responsive layout at 2 viewport widths
- **Data integrity** — Does input → output round-trip correctly?

Present the plan via prose and ask: "Does this cover what you need?"

### Step 3: Execute tests

For each test case:
1. **Execute** — Use available tools to test (web_fetch for API/web, run_command for CLI, read source for static analysis)
2. **Document result** — Pass / Fail with evidence
3. **For failures**: Capture:
   - What was expected
   - What actually happened
   - Severity (Critical / High / Medium / Low / Cosmetic)

Use `ask_choice` for ambiguous results: "Is this a bug or expected behavior?"

### Step 4: Fix bugs (iterative)

For each confirmed bug:
1. Locate the root cause in source code (`search_content` / `read_file`)
2. Propose a fix and apply it (`edit_file`)
3. Re-test to verify the fix
4. Generate a regression test if the project's test framework allows

Use `ask_choice` for fix approach when there are multiple valid solutions.

### Step 5: Report

Write a QA summary:
- **Health score**: X/Y tests pass
- **Bug log**: Each bug with severity, status (Fixed / Unfixed / Won't Fix), and fix summary
- **Before/after**: For fixed bugs, what changed
- **Regression tests added**: List
- **Ship readiness**: "Ship" / "Ship with known issues" / "Do not ship"
