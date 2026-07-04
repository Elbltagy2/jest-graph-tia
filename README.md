# jest-graph-tia

Test Impact Analysis for Jest, powered by a [Graphify](https://github.com/Graphify-Labs/graphify) knowledge graph.

On a PR, it runs only the tests your change can actually affect — including impacts Jest's static import graph **cannot see**: dynamic requires with computed paths, JSON/SQL/config dependencies, event-name coupling, DI wiring.

## How it works

```
git diff                    →  changed files
graphify graph.json         →  expand: changed ∪ graph-related files   (reverse-BFS, hop budgets)
jest --findRelatedTests     →  map the expanded file set to tests
jest --runTestsByPath       →  run exactly those, propagate exit code
```

The graph only ever **widens** Jest's input file set — Jest owns all test discovery. Hard invariant (property-tested): everything `jest --findRelatedTests` would select from your raw diff is always selected. A wrong graph edge costs one extra test run; it can never skip a test.

## Example

`src/pricing.js` loads `rules.json` through a dynamic require — invisible to Jest:

```
$ jest-graph-tia run --changed-since main --dry-run --explain
changed files vs main (merge-base c419fb85): 1
expanded 1 changed → 3 files (graphify added 2); selected 1 tests (jest baseline 0)

TEST                       SOURCE    VIA_FILE        HOPS  WEAKEST_TIER  PATH
-------------------------  --------  --------------  ----  ------------  -----------------------
__tests__/pricing.test.js  graphify  src/pricing.js  1     INFERRED      rules.json → pricing.js

selected 1 tests (jest: 0, graphify: +1) — 33.3% of full suite (3)
```

Jest alone selected **zero** tests for that change. The graph caught it.

## Install & use

Prereqs: Node ≥ 20, Jest in the target repo, [graphify CLI](https://github.com/Graphify-Labs/graphify) (`pip install graphifyy`) with a graph built once (`graphify update .` → `graphify-out/graph.json`).

```
npm i -D jest-graph-tia
npx jest-graph-tia run --changed-since main            # select + run + propagate exit code
npx jest-graph-tia run --changed-since main --dry-run  # print selection only
  --explain              # per-test: source, via-file, hops, confidence tier, graph path
  --explain-json <path>  # same, machine-readable (explainVersion: 2)
  --fallback-full        # force the full suite
  --config <path>        # default: jest-graph-tia.config.json
  --no-update-graph      # skip the incremental `graphify update` before selection

npx jest-graph-tia audit                        # whole-codebase gap scan: which source
  --explain-json <path>  # machine-readable      # files does NO test reach?
```

`audit` runs one forward-BFS from every test file along dependency edges (same hop budgets). Source files no test reaches are your blind spots — including the sneaky kind where `foo.test.ts` accidentally imports `bar.ts` and `foo.ts` is tested by nothing. Reachability, not line coverage: an unreached file is a hard gap; a reached file may still be thin. Tune noise with `audit.excludeGlobs`.

## Safety fallbacks — full suite runs when

- a lockfile, jest/babel/tsconfig, `.env*`, or CI workflow file changed
- graph.json is missing, unparsable, or too stale (`fallback.maxGraphAgeCommits`)
- any changed file has zero nodes in the graph
- your own globs match (`fallback.extraGlobs`)

## Config (`jest-graph-tia.config.json`, all optional)

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

Hop budgets are per confidence tier of a path's **weakest** edge: `EXTRACTED` (AST fact), `INFERRED` (model-derived), `AMBIGUOUS` (off by default).

## Repo layout

```
packages/core   pure logic: graph parsing, expansion, fallback rules, explain — no process spawning
packages/cli    the jest-graph-tia binary — owns git/graphify/jest subprocesses and exit codes
fixtures/       deterministic mini Jest repo + hand-written graph.json (drives unit + e2e tests)
examples/       CI YAML + config examples
docs/SPEC.md    behavior spec — source of truth
benchmarks/     delta measurement harness (run it on your repo to see what the graph adds)
```

## Development

```
npm install
npm run build
npm test        # 40 tests: unit + 100-scenario superset-invariant property test + subprocess e2e
```

Non-goals (v0.2): pruning below Jest's baseline, other runners, per-line coverage mapping, UI. See `docs/SPEC.md`.
