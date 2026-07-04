# SPEC — jest-graph-tia v0.1 (MVP)

Status: draft. This file is the source of truth. PROMPT.md summarizes it; CLAUDE.md operationalizes it.

## 1. Problem
Jest's `--findRelatedTests` follows only statically resolvable imports. It cannot see:
(a) dynamic imports with computed paths, (b) DI/runtime wiring (routers, event buses, plugin registries),
(c) non-JS dependencies (SQL migrations, JSON fixtures, configs, schemas),
(d) fine-grained cross-package edges in monorepos, (e) semantic coupling (feature flags, event-name strings, contracts).
Graphify's knowledge graph (graph.json) contains AST-extracted and model-inferred edges across code AND non-code files, tagged EXTRACTED / INFERRED / AMBIGUOUS.

## 2. Selection algorithm
Inputs: baseRef (default: merge-base with main), repo root, graph.json path, config.

1. `changed = gitDiffFiles(mergeBase(baseRef, HEAD), HEAD)` (added/modified/renamed; deleted files map to their old path's dependents)
2. Fallback check (§4). If triggered → full suite, exit path A.
3. `jestList = spawn("jest --findRelatedTests <changed...> --listTests")` → absolute test paths.
4. `graphList = traverse(graph, changed, config.traversal)` (§3) → test paths.
5. `selected = dedupe(jestList ∪ graphList)`.
6. INVARIANT: `jestList ⊆ selected`. Assert in code; property-tested.
7. `--dry-run` → print explanation table (§5) and exit 0. Otherwise `spawn("jest", selected)` and exit with Jest's code.

## 3. Graph traversal
- Build reverse adjacency from graph.json (edge u→v means v depends... NOTE: verify Graphify's edge direction from its docs/fixtures at implementation time; encode the verified direction in one function `dependentsOf(node)` and test it against the fixture graph).
- Map changed file paths → graph nodes (nodes referencing that file). Unmapped changed file → fallback trigger (§4.4).
- Multi-source reverse BFS. Each frontier entry tracks: node, hops, weakestTier (min of tiers along path; EXTRACTED > INFERRED > AMBIGUOUS).
- Expansion budget per weakestTier (config defaults): EXTRACTED 6 hops, INFERRED 2, AMBIGUOUS 1 and disabled by default.
- A node is a "test hit" if its file matches the target repo's Jest testMatch (read from that repo's resolved jest config via `jest --showConfig`; fallback pattern set if unavailable).
- Record for every hit: the shortest qualifying path (for --explain).

## 4. Fallback-to-full-suite triggers (any → run everything, print reason)
1. Lockfile changed (npm/yarn/pnpm)
2. jest.config.*, babel.config.*, tsconfig* changed
3. graph.json missing/unparsable, or its recorded commit is > config.fallback.maxGraphAgeCommits (default 50) behind merge-base
4. Any changed file with zero graph nodes
5. `.env*`, `.github/workflows/*`, or paths matching config.fallback.extraGlobs changed
Exit path A: `spawn("jest")` with no filters.

## 5. --explain output (stdout, also `--explain-json <path>`)
Columns: TEST | SOURCE (jest|graphify|both) | HOPS | WEAKEST_TIER | PATH (a → b → c)
Footer: counts per source, % of full suite selected, fallback status.
This output is a contract: benchmarks and users both consume it. Version it (`explainVersion: 1` in JSON).

## 6. Config file — jest-graph-tia.config.json (all optional)
```json
{
  "graphPath": "graphify-out/graph.json",
  "traversal": { "extracted": 6, "inferred": 2, "ambiguous": 0 },
  "fallback": { "maxGraphAgeCommits": 50, "extraGlobs": [] },
  "updateGraph": true,
  "jestArgs": []
}
```
`updateGraph: true` → cli runs `graphify <root> --update` before selection; failure → warn + proceed with stale graph unless staleness trips §4.3.

## 7. Benchmark harness (Phase 0 — precedes all product code)
`benchmarks/measure-delta.mjs --repo <path> --commits <n>`:
For each of the last n merge commits (or a provided commit list):
1. `changed = git diff --name-only <commit>^1 <commit>`
2. jestList via `--findRelatedTests --listTests` at that commit's checkout (use a worktree)
3. graphList via traversal against a graph built once at a recent commit (accept staleness; note it in RESULTS)
4. Record: |jestList|, |graphList|, |graphList − jestList| (THE DELTA), |union|, full-suite size, and the delta test names.
Output RESULTS.md: per-commit table + medians + top recurring delta tests.
Decision rule (documented in RESULTS.md): median delta ≥ ~5% of suite or any delta test that historically failed → proceed to Phase 1; near-zero delta → stop and publish the negative result.

## 8. Non-goals (v0.1)
Pruning below Jest's baseline; runners other than Jest; per-line coverage mapping; symbol-level diffs (file-level only); GitHub Action beyond an example YAML; any UI.

## 9. Risks & mitigations
- Over-connected semantic graph → selection ≈ full suite: mitigated by tier hop budgets; expose % selected in --explain footer so it's visible immediately.
- Graphify schema drift: isolate all graph.json parsing in one module (`core/src/graphSchema.ts`) with a version guard and a clear error.
- Trust: --explain from day one; escape-rate measurement (nightly full run comparison) documented as v0.2.
