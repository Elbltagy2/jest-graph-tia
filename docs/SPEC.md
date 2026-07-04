# SPEC — jest-graph-tia v0.2 (MVP, file-expansion design)

Status: active. This file is the source of truth. CLAUDE.md operationalizes it.

> v0.2 supersedes the v0.1 "union of test lists" design by maintainer decision (2026-07-04).
> New model: the graph expands the changed-FILE set; Jest alone maps files → tests.

## 1. Problem
Jest's `--findRelatedTests` follows only statically resolvable imports. It cannot see:
(a) dynamic imports with computed paths, (b) DI/runtime wiring (routers, event buses, plugin registries),
(c) non-JS dependencies (SQL migrations, JSON fixtures, configs, schemas),
(d) fine-grained cross-package edges in monorepos, (e) semantic coupling (feature flags, event-name strings, contracts).
Graphify's knowledge graph (graph.json) contains AST-extracted and model-inferred edges across code AND non-code files, tagged EXTRACTED / INFERRED / AMBIGUOUS.

## 2. Selection algorithm (file-expansion)
Inputs: baseRef (default: merge-base with main), repo root, graph.json path, config.

1. `changed = gitDiffFiles(mergeBase(baseRef, HEAD), HEAD)` (added/modified/renamed; deleted files map to their old path's dependents).
2. Fallback check (§4). If triggered → full suite, exit path A.
3. `expanded = expandFiles(graph, changed, config.traversal)` (§3) → `changed ∪ graph-related source files` (FILES, not tests).
4. `selected = spawn("jest --findRelatedTests <expanded...> --listTests")` → absolute test paths.
5. INVARIANT: `findRelatedTests(changed) ⊆ findRelatedTests(expanded)` because `changed ⊆ expanded` and Jest's relatedness is monotonic in its input set. Property-tested against the fixture repo; `expandFiles` must always return a superset of its input.
6. `--dry-run` → print explanation table (§5) and exit 0. Otherwise `spawn("jest", selected)` and exit with Jest's code.

Core returns file lists and explanations only. Core never spawns processes and never imports jest. The CLI owns git/graphify/jest spawning.

## 3. Graph expansion (verified against graphify 0.8.39 artifacts)
graph.json is networkx node-link JSON: top-level keys `directed, multigraph, graph, nodes, links` (edges live under **`links`**).
- Node: `{ id, label, source_file (repo-relative path), source_location, file_type, community }`. A file maps to all nodes whose `source_file` equals it.
- Edge: `{ source, target, relation, confidence, confidence_score, weight }`. Direction: **source depends on target** (verified: `calc.js --imports_from--> math.js`). Therefore dependents-of-X = edges with `target ∈ X.nodes`, taking `source`.
- All schema parsing isolated in `core/src/graphSchema.ts` with a shape guard and a clear error (§9).
- Multi-source reverse BFS over incoming edges from every node of every changed file. Each frontier entry tracks: node, hops, weakestTier (min tier along path; EXTRACTED > INFERRED > AMBIGUOUS).
- Hop budget per weakestTier (config §6 defaults): EXTRACTED 6, INFERRED 2, AMBIGUOUS 1 but disabled by default (tier budget 0 = edges of that tier are never followed).
- `contains` edges (file ↔ its own functions) are free: they don't consume a hop (intra-file, no distance semantics).
- Output: set of `source_file`s of every reached node, minus non-code files that Jest can't take as arguments (config `includeNonJs: false` default) — plus, per reached file, the shortest qualifying path (for --explain).
- Unmapped changed file (zero nodes) → fallback trigger (§4.4).

## 4. Fallback-to-full-suite triggers (any → run everything, print reason)
1. Lockfile changed (npm/yarn/pnpm)
2. jest.config.*, babel.config.*, tsconfig* changed
3. graph.json missing/unparsable, or its recorded commit is > config.fallback.maxGraphAgeCommits (default 50) behind merge-base
4. Any changed file with zero graph nodes (deleted-only files exempt when their dependents resolve)
5. `.env*`, `.github/workflows/*`, or paths matching config.fallback.extraGlobs changed
Exit path A: `spawn("jest")` with no filters.

## 5. --explain output (stdout, also `--explain-json <path>`)
Table per selected test: TEST | SOURCE (jest|graphify) | VIA_FILE | HOPS | WEAKEST_TIER | PATH (a → b → c)
- SOURCE=jest: test already selected by `findRelatedTests(changed)` alone.
- SOURCE=graphify: test appears only with the expanded set. VIA_FILE/HOPS/TIER/PATH come from the graph path to the expanded file(s) that pulled it in; attribution computed by running `--findRelatedTests --listTests` per graph-added file (only under --explain; slower is acceptable).
Footer: counts per source, % of full suite selected, fallback status.
This output is a contract: benchmarks and users both consume it. Version it (`explainVersion: 2` in JSON).

## 6. Config file — jest-graph-tia.config.json (all optional)
```json
{
  "graphPath": "graphify-out/graph.json",
  "traversal": { "extracted": 6, "inferred": 2, "ambiguous": 0 },
  "fallback": { "maxGraphAgeCommits": 50, "extraGlobs": [] },
  "includeNonJs": false,
  "updateGraph": true,
  "jestArgs": []
}
```
`updateGraph: true` → cli runs `graphify update <root>` before selection; failure → warn + proceed with stale graph unless staleness trips §4.3.

## 7. Benchmark (deferred by maintainer decision)
Phase 0 harness (`benchmarks/measure-delta.mjs`) retained; run it post-MVP on a real JS/TS+Jest repo. Delta metric becomes `findRelatedTests(expanded) − findRelatedTests(changed)`.

## 8. Non-goals (v0.2)
Pruning below Jest's baseline; runners other than Jest; per-line coverage mapping; symbol-level diffs (file-level only); GitHub Action beyond an example YAML; any UI.

## 9. Risks & mitigations
- Over-connected semantic graph → expansion ≈ whole repo → selection ≈ full suite: mitigated by tier hop budgets; % selected surfaced in --explain footer.
- Graphify schema drift: all graph.json parsing in `core/src/graphSchema.ts` with a version/shape guard and a clear error.
- Trust: --explain from day one; escape-rate measurement (nightly full-run comparison) documented as v0.3.
