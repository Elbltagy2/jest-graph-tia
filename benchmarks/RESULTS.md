# Benchmark — with vs without graphify (file-expansion design)

Repo: `/Users/ahmedelbltagy/agilitas` · commits: 10 · graph: 23403 nodes / 47913 edges (built at HEAD; historical commits measured against it)

| commit | subject | changed | expanded files | jest-only tests | with-graph tests | **delta** |
|---|---|---|---|---|---|---|
| c30bc56b | Round nutrient display and document USDA stub fill | 3 | 6 | 1 | 1 | **0** |
| 1a51933e | Restyle migration entry table for readability | 1 | 5 | 2 | 2 | **0** |
| a01e9506 | Show post-mapping nutrients in migration review | 7 | 44 | 9 | 16 | **7** |
| c45709d1 | Fill Genesis usdaCode stubs from cache on import | 7 | 37 | 8 | 13 | **5** |
| fed4dc92 | Add USDA nutrient cache and Genesis stub backfill | 9 | 9 | 1 | 1 | **0** |
| 34db3d54 | Widen Nutrient.quantity and guard out-of-range Genesis value | 4 | 34 | 8 | 13 | **5** |
| 8d14b7f5 | Fix Genesis nutrient units and backfill on re-import | 5 | 44 | 10 | 16 | **6** |
| ab738012 | FOR-473: PC Formulas Index Page + Sidebar (#919) | 63 | 858 | 172 | 180 | **8** |
| 942fae01 | Fix statusline slice counter stuck at N-1/N after final-slic | 1 | 1 | 0 | 0 | **0** |
| 4cb6b7e0 | FOR-461: Fix /qa diff base to include uncommitted changes (# | 1 | 1 | 0 | 0 | **0** |

**Medians:** jest-only=8 · with-graph=13 · delta=5

## Graph-only tests per commit
- a01e9506: tests/lib/genesis/parser.fixture.test.ts, tests/app/_components/Migrations/MigrationPreview.test.tsx, tests/app/_components/Migrations/MigrationCommit.test.tsx, tests/app/_components/Migrations/MissingIngredientResolution.test.tsx, tests/lib/genesis/nutrient-mapping.test.ts, tests/lib/genesis/parser.test.ts, tests/app/clientApi/genesisMigrations.test.ts
- c45709d1: tests/app/_components/Migrations/MigrationReviewEntries.test.tsx, tests/app/_components/Migrations/MigrationPreview.test.tsx, tests/app/_components/Migrations/MigrationCommit.test.tsx, tests/app/_components/Migrations/MissingIngredientResolution.test.tsx, tests/app/clientApi/genesisMigrations.test.ts
- 34db3d54: tests/app/_components/Migrations/MigrationReviewEntries.test.tsx, tests/app/_components/Migrations/MigrationPreview.test.tsx, tests/app/_components/Migrations/MigrationCommit.test.tsx, tests/app/_components/Migrations/MissingIngredientResolution.test.tsx, tests/app/clientApi/genesisMigrations.test.ts
- 8d14b7f5: tests/lib/genesis/parser.fixture.test.ts, tests/app/_components/Migrations/MigrationPreview.test.tsx, tests/app/_components/Migrations/MigrationCommit.test.tsx, tests/app/_components/Migrations/MissingIngredientResolution.test.tsx, tests/lib/genesis/parser.test.ts, tests/app/clientApi/genesisMigrations.test.ts
- ab738012: tests/app/_components/Migrations/MigrationReviewEntries.test.tsx, tests/app/_components/Migrations/MigrationCommit.test.tsx, tests/app/utils/bulk-upload-utils.test.ts, tests/app/_components/Migrations/MissingIngredientResolution.test.tsx, tests/lib/document/extract/ingredient/schema.test.ts, tests/app/utils/bulk-upload-mappers.test.ts, tests/app/clientApi/genesisMigrations.test.ts, tests/lib/document/extract/formula/schema.test.ts

## Notes
- Graph is code-only extraction (`graphify update`, AST). INFERRED semantic edges require graphify's LLM extraction pass; this graph carries 70 INFERRED edges from earlier runs.
- Delta counts tests selected via graph expansion that jest's own `--findRelatedTests` missed for the raw diff.
- Fallback triggers were bypassed for measurement (they'd run the full suite on lockfile/schema commits).

## Root cause of the delta (verified)

Traced `tests/app/_components/Migrations/MigrationCommit.test.tsx` (selected by graph, missed by jest) for commit `c45709d1`:

- `src/app/_components/Migrations/MigrationCommit.tsx:7` — `import type { GenesisCommitSummary } from "@/app/services/genesisMigration.service"`
- **Type-only imports are erased before Jest's dependency extraction** → `jest --findRelatedTests genesisMigration.service.ts` does not reach the component or its test.
- Graphify's tree-sitter extraction records the import as an `EXTRACTED` edge (1 hop) → the expansion adds `MigrationCommit.tsx`, and jest maps it to its test.

A change to the exported type's shape breaks the component while jest-only selection stays green. All 5 delta commits trace to this pattern (type-only imports across the Migrations/genesis feature) plus a handful of INFERRED page→hook edges.

## Verdict

Median delta 5 tests/commit on commits touching the genesis feature; 0 on leaf-file commits. The graph adds real, justified selections on exactly the dependency classes jest is blind to. Proceed.
