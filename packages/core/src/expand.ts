/**
 * File expansion (SPEC §3): multi-source reverse BFS over incoming edges
 * ("who depends on the changed code?"), with per-tier hop budgets.
 *
 * INVARIANT (SPEC §2.5): the returned file set is ALWAYS a superset of the
 * changed files that exist in the graph — expansion only ever adds.
 */
import type { ParsedGraph, Tier } from "./graphSchema.js";
import { budgetForTier, type TraversalConfig } from "./config.js";

const TIER_RANK: Record<Tier, number> = { EXTRACTED: 3, INFERRED: 2, AMBIGUOUS: 1 };

export interface FileHit {
  file: string;
  /** hops of the shortest qualifying path from a changed file */
  hops: number;
  weakestTier: Tier;
  /** node labels along the path, changed-side first */
  path: string[];
  /** the changed file this hit was reached from */
  fromChanged: string;
}

export interface ExpansionResult {
  /** changed ∪ related, deduped; superset of mapped changed files */
  files: string[];
  /** per related (non-changed) file: how we got there */
  hits: Map<string, FileHit>;
  /** changed files with zero nodes in the graph → fallback trigger §4.4 */
  unmappedChanged: string[];
}

interface QueueEntry {
  nodeId: string;
  hops: number;
  weakest: Tier;
  path: string[];
  fromChanged: string;
}

const JS_FILE = /\.[cm]?[jt]sx?$/;

export function expandFiles(
  graph: ParsedGraph,
  changedFiles: readonly string[],
  cfg: TraversalConfig,
  opts: { includeNonJs?: boolean } = {}
): ExpansionResult {
  const includeNonJs = opts.includeNonJs ?? false;
  const changedSet = new Set(changedFiles);
  const unmappedChanged: string[] = [];
  const queue: QueueEntry[] = [];

  for (const f of changedFiles) {
    const nodeIds = graph.nodesOfFile.get(f);
    if (!nodeIds || nodeIds.length === 0) {
      unmappedChanged.push(f);
      continue;
    }
    for (const id of nodeIds) {
      const label = graph.nodes.get(id)?.label ?? id;
      queue.push({ nodeId: id, hops: 0, weakest: "EXTRACTED", path: [label], fromChanged: f });
    }
  }

  // best remaining budget seen per node — re-expanding with less slack is pointless
  const bestSlack = new Map<string, number>();
  const hits = new Map<string, FileHit>();

  let head = 0;
  while (head < queue.length) {
    const entry = queue[head++]!;
    const { nodeId, hops, weakest, path, fromChanged } = entry;
    const slack = budgetForTier(cfg, weakest) - hops;
    if (slack < 0) continue;
    const prev = bestSlack.get(nodeId);
    if (prev !== undefined && prev >= slack) continue;
    bestSlack.set(nodeId, slack);

    const node = graph.nodes.get(nodeId);
    const file = node?.sourceFile;
    if (file !== undefined && !changedSet.has(file)) {
      const existing = hits.get(file);
      if (
        !existing ||
        hops < existing.hops ||
        (hops === existing.hops && TIER_RANK[weakest] > TIER_RANK[existing.weakestTier])
      ) {
        hits.set(file, { file, hops, weakestTier: weakest, path, fromChanged });
      }
    }

    for (const edge of graph.incoming.get(nodeId) ?? []) {
      const nextWeakest: Tier = TIER_RANK[edge.tier] < TIER_RANK[weakest] ? edge.tier : weakest;
      if (budgetForTier(cfg, nextWeakest) === 0) continue; // tier disabled
      // `contains` edges (file ↔ its own members) are intra-file: hop-free (SPEC §3)
      const cost = edge.relation === "contains" ? 0 : 1;
      const dependent = graph.nodes.get(edge.source);
      const label = dependent?.label ?? edge.source;
      queue.push({
        nodeId: edge.source,
        hops: hops + cost,
        weakest: nextWeakest,
        path: [...path, label],
        fromChanged,
      });
    }
  }

  const related = [...hits.keys()].filter((f) => includeNonJs || JS_FILE.test(f));
  // superset invariant: every changed file (mapped or not) stays in the output
  const files = [...new Set([...changedFiles, ...related])];
  return { files, hits, unmappedChanged };
}
