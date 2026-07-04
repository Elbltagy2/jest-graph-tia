# Agent Kickoff Prompt — jest-graph-tia

Copy everything below the line into your coding agent (Claude Code, etc.) from inside an empty repo that already contains CLAUDE.md, docs/SPEC.md, and benchmarks/measure-delta.mjs from this starter kit.

---

You are building **jest-graph-tia**, an open-source Test Impact Analysis tool for JavaScript/TypeScript that combines two dependency graphs to select which Jest tests to run on a pull request:

1. **Jest's static import graph** — obtained by shelling out to `jest --findRelatedTests <files> --listTests` (never re-implement this).
2. **Graphify's semantic knowledge graph** — obtained by reading `graphify-out/graph.json` produced by the Graphify CLI (never vendor Graphify's code; invoke it or read its artifacts).

The selection rule is a **strict union**: `selected = jestRelatedTests ∪ graphifyImpactedTests`. Graphify may only ever ADD tests to Jest's baseline, never remove them. This is a hard invariant — write a test that enforces it.

Read `CLAUDE.md` and `docs/SPEC.md` in this repo before writing any code. They are the source of truth for architecture, naming, and scope. If the spec and this prompt ever conflict, the spec wins.

## Phase 0 — before any product code
Run the benchmark harness first. Execute `benchmarks/measure-delta.mjs` against the target repo I give you (ask me for the repo path and the number of historical PRs/commits to sample if I haven't provided them). The harness compares, per historical commit:
- what `jest --findRelatedTests --listTests` selects
- what Graphify graph traversal selects
- the delta between them

Produce `benchmarks/RESULTS.md` summarizing the delta. If the median delta is near zero, STOP and report back to me before building anything else — the project's value depends on this number.

## Phase 1 — MVP (only after Phase 0 results are reviewed)
Build a monorepo (npm workspaces, TypeScript, ESM) with:

- `packages/core` — pure logic, no I/O side effects at the API boundary:
  - `getChangedFiles(baseRef)` — git diff against merge-base, symbol-level later, file-level now
  - `queryGraph(graphJsonPath, changedFiles, config)` — load graph.json, reverse-BFS from changed files to test files, respecting per-confidence-tier max hop depth (EXTRACTED / INFERRED / AMBIGUOUS)
  - `selectTests({ jestList, graphList })` — the union + dedupe + invariant check
  - `explainSelection(...)` — for every selected test, return WHY: which source (jest|graphify|both), which edge path, hop count, confidence tier
- `packages/cli` — `jest-graph-tia run --changed-since <ref>` which:
  1. computes changed files
  2. triggers `graphify --update` incrementally (config flag to skip)
  3. gets Jest baseline via `--findRelatedTests --listTests`
  4. gets Graphify additions via core
  5. execs `jest <union of test paths>` and propagates the exit code
  - flags: `--dry-run`, `--explain`, `--fallback-full`, `--config <path>`
- Fallback-to-full-suite triggers (run EVERYTHING when): lockfile changed, jest config changed, graph.json missing/stale beyond threshold, `.env*` changed, or any changed file has zero nodes in the graph. Make triggers configurable in `jest-graph-tia.config.json`.

## Engineering rules
- TypeScript strict mode, ESM only, Node >= 20.
- Every core function unit-tested with Jest (dogfood). Include a fixture mini-repo under `fixtures/` with a known graph.json and known import structure so selection tests are deterministic.
- The invariant test: for 100 randomized fixture scenarios, assert `jestList ⊆ selected`.
- No network calls at runtime. No LLM calls at runtime — read only the pre-built graph.json.
- Keep `graphify` and `jest` as peerDependencies / CLI expectations, not bundled deps.
- Conventional commits; small commits; write the README last, from what actually works.

## Explicitly OUT of scope for MVP (do not build)
- Pruning/removing tests from Jest's baseline selection
- Vitest or any other runner (but keep `core` runner-agnostic: it returns file lists, it never imports jest)
- Coverage-based per-line mapping
- Any dashboard/UI
- GitHub Action packaging (stub an example YAML in `examples/`, nothing more)

## Definition of done for MVP
`jest-graph-tia run --changed-since main --dry-run --explain` on the fixture repo prints a table of selected tests with source/edge/hops, and `run` without `--dry-run` executes exactly that set via Jest and exits with Jest's code.

Start with Phase 0. Ask me for the target repo before running the benchmark.
