/** The shared selection pipeline (SPEC §2) — used by `run` and `verify`. */
import { existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import {
  expandFiles,
  checkFallback,
  applyDirectives,
  type TiaConfig,
  type ExpansionResult,
  type FallbackDecision,
  type ParsedGraph,
} from "@jest-graph-tia/core";
import { getChangedFiles, graphAgeCommits, type ChangedFiles } from "./git.js";
import { findRelatedTests, listAllTests } from "./jest.js";
import { loadGraph, updateGraph } from "./graph.js";
import { collectDirectives } from "./directives.js";

const JS_FILE = /\.[cm]?[jt]sx?$/;

export interface SelectionOptions {
  changedSince: string;
  fallbackForced: boolean;
  skipGraphUpdate: boolean;
}

export interface Selection {
  changed: ChangedFiles;
  graphOk: boolean;
  graphError?: string;
  expansion: ExpansionResult;
  fallback: FallbackDecision;
  /** findRelatedTests(changed) — jest's own baseline (absolute paths) */
  baseline: string[];
  /** findRelatedTests(expanded) — the selection (absolute paths); undefined when fallback → full suite */
  selected: string[] | undefined;
  fullSuite: string[];
  graphOnlyFiles: string[];
  graph?: ParsedGraph;
}

export function relPath(repoRoot: string, p: string): string {
  return p.startsWith(repoRoot + "/") ? p.slice(repoRoot.length + 1) : p;
}

export function computeSelection(repoRoot: string, cfg: TiaConfig, opts: SelectionOptions): Selection {
  const changed = getChangedFiles(repoRoot, opts.changedSince);

  if (cfg.updateGraph && !opts.skipGraphUpdate) {
    const u = updateGraph(repoRoot);
    if (!u.ok) console.warn(`warning: ${u.message} — proceeding with existing graph`);
  }
  const graphPath = isAbsolute(cfg.graphPath) ? cfg.graphPath : resolve(repoRoot, cfg.graphPath);
  const loaded = loadGraph(graphPath);
  if (!loaded.ok) console.warn(`warning: ${loaded.error}`);

  const fullSuite = listAllTests(repoRoot);

  // @tia-covers directives: explicit test→file edges (fs-reads, fixtures, CLIs)
  if (loaded.graph) {
    const dirs = collectDirectives(repoRoot, fullSuite.map((t) => relPath(repoRoot, t)));
    if (dirs.length > 0) {
      const { applied, unresolved } = applyDirectives(loaded.graph, dirs);
      if (applied > 0) {
        console.log(`@tia-covers: injected ${applied} edge(s) from ${new Set(dirs.map((d) => d.testFile)).size} test file(s)`);
      }
      for (const u of unresolved) console.warn(`warning: @tia-covers target not found in graph: ${u.target} (${u.testFile})`);
    }
  }

  const expansion: ExpansionResult = loaded.graph
    ? expandFiles(loaded.graph, changed.all, cfg.traversal, { includeNonJs: cfg.includeNonJs })
    : { files: changed.all, hits: new Map(), unmappedChanged: [] };

  const age = graphAgeCommits(repoRoot, loaded.builtAtCommit, changed.mergeBase);
  const fallback = checkFallback(changed.all, cfg.fallback, {
    graphOk: loaded.ok,
    forced: opts.fallbackForced,
    unmappedChanged: expansion.unmappedChanged,
    ...(age !== undefined ? { graphAgeCommits: age } : {}),
  });

  const base: Omit<Selection, "baseline" | "selected" | "graphOnlyFiles"> = {
    changed,
    graphOk: loaded.ok,
    expansion,
    fallback,
    fullSuite,
    ...(loaded.error !== undefined ? { graphError: loaded.error } : {}),
    ...(loaded.graph !== undefined ? { graph: loaded.graph } : {}),
  };

  if (fallback.triggered || changed.all.length === 0) {
    return { ...base, baseline: [], selected: undefined, graphOnlyFiles: [] };
  }

  // only JS/TS paths that exist go to jest; JS dependents of non-JS files carry the signal
  const forJest = (files: readonly string[]) =>
    files.filter((f) => JS_FILE.test(f) && existsSync(join(repoRoot, f)));
  const expandedExisting = forJest(expansion.files);
  const baseline = findRelatedTests(repoRoot, forJest(changed.existing));
  const selected = findRelatedTests(repoRoot, expandedExisting);

  // INVARIANT: findRelatedTests(changed) ⊆ findRelatedTests(expanded)
  const selectedSet = new Set(selected);
  const missing = baseline.filter((t) => !selectedSet.has(t));
  if (missing.length > 0) {
    console.error(`INVARIANT VIOLATION — baseline tests absent from selection, re-adding: ${missing.join(", ")}`);
    selected.push(...missing);
  }

  return {
    ...base,
    baseline,
    selected,
    graphOnlyFiles: expandedExisting.filter((f) => expansion.hits.has(f)),
  };
}
