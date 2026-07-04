/**
 * Coverage-gap audit: which source files does NO test reach?
 *
 * Single forward BFS from every test file along OUTGOING (dependency) edges —
 * "what does this test transitively depend on?" — with the same per-tier hop
 * budgets as selection. A source file never reached by any test is untested.
 *
 * This is reachability by the graph's knowledge (static imports, type-only
 * imports, LLM-inferred links), not line coverage — a reached file may still
 * be poorly tested. Unreached is the strong signal: nothing exercises it.
 */
import type { ParsedGraph, Tier } from "./graphSchema.js";
import { budgetForTier, type TraversalConfig } from "./config.js";
import { globToRegExp } from "./fallback.js";

const TIER_RANK: Record<Tier, number> = { EXTRACTED: 3, INFERRED: 2, AMBIGUOUS: 1 };
const JS_FILE = /\.[cm]?[jt]sx?$/;
// test-like files are never "untested source" — even ones jest's config ignores
// (api-tests, e2e suites run by other runners): they are tests, not gaps.
const TEST_LIKE = /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|__mocks__)\//;

export interface AuditOptions {
  traversal: TraversalConfig;
  /** repo-relative test file paths (from `jest --listTests`) — the coverage sources */
  testFiles: readonly string[];
  /** globs to exclude from the untested report (defaults applied by caller) */
  excludeGlobs?: readonly string[];
}

export interface CoveredFile {
  file: string;
  /** hops of the shortest dependency path from some test */
  hops: number;
  weakestTier: Tier;
  /** a test that reaches it */
  viaTest: string;
}

export interface AuditResult {
  /** JS source files (non-test) reachable from at least one test */
  covered: Map<string, CoveredFile>;
  /** JS source files (non-test) no test reaches — the gaps */
  untested: string[];
  /** test files that have no nodes in the graph (stale graph warning) */
  testsNotInGraph: string[];
  totalSourceFiles: number;
}

export function auditCoverage(graph: ParsedGraph, opts: AuditOptions): AuditResult {
  const testSet = new Set(opts.testFiles);
  const exclude = (opts.excludeGlobs ?? []).map(globToRegExp);
  const isExcluded = (f: string) => exclude.some((re) => re.test(f));

  // all JS, non-test, non-excluded files known to the graph = the audit universe
  const universe = new Set<string>();
  for (const f of graph.nodesOfFile.keys()) {
    if (JS_FILE.test(f) && !testSet.has(f) && !TEST_LIKE.test(f) && !isExcluded(f)) universe.add(f);
  }

  // seed: every node of every test file
  interface Entry { nodeId: string; hops: number; weakest: Tier; viaTest: string }
  const queue: Entry[] = [];
  const testsNotInGraph: string[] = [];
  for (const t of opts.testFiles) {
    const ids = graph.nodesOfFile.get(t);
    if (!ids || ids.length === 0) {
      testsNotInGraph.push(t);
      continue;
    }
    for (const id of ids) queue.push({ nodeId: id, hops: 0, weakest: "EXTRACTED", viaTest: t });
  }

  const bestSlack = new Map<string, number>();
  const covered = new Map<string, CoveredFile>();

  let head = 0;
  while (head < queue.length) {
    const { nodeId, hops, weakest, viaTest } = queue[head++]!;
    const slack = budgetForTier(opts.traversal, weakest) - hops;
    if (slack < 0) continue;
    const prev = bestSlack.get(nodeId);
    if (prev !== undefined && prev >= slack) continue;
    bestSlack.set(nodeId, slack);

    const file = graph.nodes.get(nodeId)?.sourceFile;
    if (file !== undefined && universe.has(file)) {
      const existing = covered.get(file);
      if (
        !existing ||
        hops < existing.hops ||
        (hops === existing.hops && TIER_RANK[weakest] > TIER_RANK[existing.weakestTier])
      ) {
        covered.set(file, { file, hops, weakestTier: weakest, viaTest });
      }
    }

    // follow dependencies: outgoing edges (source depends on target)
    for (const edge of graph.outgoing.get(nodeId) ?? []) {
      const nextWeakest: Tier = TIER_RANK[edge.tier] < TIER_RANK[weakest] ? edge.tier : weakest;
      if (budgetForTier(opts.traversal, nextWeakest) === 0) continue;
      const cost = edge.relation === "contains" ? 0 : 1;
      queue.push({ nodeId: edge.target, hops: hops + cost, weakest: nextWeakest, viaTest });
    }
  }

  const untested = [...universe].filter((f) => !covered.has(f)).sort();
  return { covered, untested, testsNotInGraph, totalSourceFiles: universe.size };
}
