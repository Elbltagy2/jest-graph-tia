# jest-graph-tia — Starter Kit

Four files to hand to your coding agent (Claude Code etc.) to kick off the project.

## How to use

1. Create an empty git repo: `mkdir jest-graph-tia && cd jest-graph-tia && git init`
2. Copy `CLAUDE.md`, `docs/SPEC.md`, and `benchmarks/measure-delta.mjs` into it, commit.
3. Open your agent in that repo and paste the contents of `PROMPT.md` (everything below the divider line).
4. When the agent asks for the target repo, point it at a real codebase you know well that:
   - uses Jest,
   - already has a Graphify graph built (`graphify <root>` → `graphify-out/graph.json`),
   - has ≥20 merge commits of history.

## What happens

- **Phase 0 (first, mandatory):** the agent runs the delta benchmark and writes `benchmarks/RESULTS.md`. This answers the only question that matters: does Graphify find impacted tests that Jest's static analysis misses? Review it before letting the agent continue.
- **Phase 1:** only if the delta is meaningful — the agent builds the MVP monorepo per `docs/SPEC.md`.

## The two rules baked into every file

1. **Union invariant:** Graphify only ever ADDS tests to Jest's baseline; it never removes one. Worst case of a bad semantic edge = one extra test run, never a skipped failing test.
2. **Verify before trusting:** the benchmark script marks Graphify's graph.json schema and edge direction as assumptions to validate against a real artifact — the agent is instructed to confirm both before believing any numbers.

## Files

- `PROMPT.md` — the kickoff prompt you paste into the agent
- `CLAUDE.md` — persistent project context the agent reads every session
- `docs/SPEC.md` — detailed behavior spec (source of truth on conflicts)
- `benchmarks/measure-delta.mjs` — Phase 0 experiment harness (runnable skeleton; agent hardens it)
