/**
 * --explain (SPEC §5). Pure derivation + formatting; the CLI supplies
 * baseline/selected test lists and per-file graph attribution.
 */
import type { FileHit } from "./expand.js";
import type { Tier } from "./graphSchema.js";

export const EXPLAIN_VERSION = 2;

export interface ExplainRow {
  test: string;
  source: "jest" | "graphify";
  viaFile?: string;
  hops?: number;
  weakestTier?: Tier;
  path?: string[];
}

export interface Explanation {
  explainVersion: typeof EXPLAIN_VERSION;
  rows: ExplainRow[];
  footer: {
    jestCount: number;
    graphifyCount: number;
    selectedCount: number;
    fullSuiteCount?: number;
    percentOfFullSuite?: number;
    fallback: { triggered: boolean; reasons: string[] };
  };
}

export interface ExplainInput {
  /** findRelatedTests(changed) — Jest's own baseline */
  baselineTests: readonly string[];
  /** findRelatedTests(expanded) — the final selection */
  selectedTests: readonly string[];
  /** graph hits keyed by expanded file (from ExpansionResult) */
  hits: ReadonlyMap<string, FileHit>;
  /** test → expanded file(s) that pulled it in (CLI computes via per-file findRelatedTests) */
  attribution?: ReadonlyMap<string, string[]>;
  fullSuiteCount?: number;
  fallback?: { triggered: boolean; reasons: string[] };
}

export function explainSelection(input: ExplainInput): Explanation {
  const baseline = new Set(input.baselineTests);
  const rows: ExplainRow[] = [];

  for (const test of [...input.selectedTests].sort()) {
    if (baseline.has(test)) {
      rows.push({ test, source: "jest" });
      continue;
    }
    const row: ExplainRow = { test, source: "graphify" };
    // pick the attributed file with the shortest graph path
    const viaFiles = input.attribution?.get(test) ?? [];
    let best: FileHit | undefined;
    for (const f of viaFiles) {
      const hit = input.hits.get(f);
      if (hit && (!best || hit.hops < best.hops)) best = hit;
    }
    if (best) {
      row.viaFile = best.file;
      row.hops = best.hops;
      row.weakestTier = best.weakestTier;
      row.path = best.path;
    }
    rows.push(row);
  }

  const jestCount = rows.filter((r) => r.source === "jest").length;
  const graphifyCount = rows.length - jestCount;
  const footer: Explanation["footer"] = {
    jestCount,
    graphifyCount,
    selectedCount: rows.length,
    fallback: input.fallback ?? { triggered: false, reasons: [] },
  };
  if (input.fullSuiteCount !== undefined) {
    footer.fullSuiteCount = input.fullSuiteCount;
    footer.percentOfFullSuite =
      input.fullSuiteCount === 0 ? 0 : Math.round((rows.length / input.fullSuiteCount) * 1000) / 10;
  }
  return { explainVersion: EXPLAIN_VERSION, rows, footer };
}

/** Render the explanation as the stdout table (SPEC §5). */
export function formatExplanation(x: Explanation, opts: { relTo?: string } = {}): string {
  const rel = (p: string) =>
    opts.relTo && p.startsWith(opts.relTo + "/") ? p.slice(opts.relTo.length + 1) : p;
  const header = ["TEST", "SOURCE", "VIA_FILE", "HOPS", "WEAKEST_TIER", "PATH"];
  const lines = x.rows.map((r) => [
    rel(r.test),
    r.source,
    r.viaFile ?? "-",
    r.hops !== undefined ? String(r.hops) : "-",
    r.weakestTier ?? "-",
    r.path ? r.path.join(" → ") : "-",
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i]!.length)));
  const fmt = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  const out = [fmt(header), fmt(widths.map((w) => "-".repeat(w))), ...lines.map(fmt)];
  const f = x.footer;
  out.push("");
  out.push(
    `selected ${f.selectedCount} tests (jest: ${f.jestCount}, graphify: +${f.graphifyCount})` +
      (f.percentOfFullSuite !== undefined ? ` — ${f.percentOfFullSuite}% of full suite (${f.fullSuiteCount})` : "")
  );
  if (f.fallback.triggered) out.push(`FALLBACK → full suite: ${f.fallback.reasons.join("; ")}`);
  return out.join("\n");
}
