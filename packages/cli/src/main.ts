#!/usr/bin/env node
/**
 * jest-graph-tia run --changed-since <ref> [--dry-run] [--explain] [--explain-json <path>]
 *                    [--fallback-full] [--config <path>] [--no-update-graph]
 * Orchestration per SPEC §2. Exit code = Jest's exit code (or 0 for dry runs).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, isAbsolute } from "node:path";
import {
  resolveConfig,
  expandFiles,
  checkFallback,
  explainSelection,
  formatExplanation,
  type TiaConfig,
} from "@jest-graph-tia/core";
import { getChangedFiles, graphAgeCommits } from "./git.js";
import { findRelatedTests, listAllTests, runJest } from "./jest.js";
import { loadGraph, updateGraph } from "./graph.js";
import { git } from "./proc.js";

interface CliArgs {
  command: string;
  changedSince: string;
  dryRun: boolean;
  explain: boolean;
  explainJson?: string;
  fallbackFull: boolean;
  configPath?: string;
  noUpdateGraph: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = {
    command: argv[0] ?? "",
    changedSince: "main",
    dryRun: false,
    explain: false,
    fallbackFull: false,
    noUpdateGraph: false,
  };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--changed-since":
        a.changedSince = argv[++i] ?? "main";
        break;
      case "--dry-run":
        a.dryRun = true;
        break;
      case "--explain":
        a.explain = true;
        break;
      case "--explain-json": {
        const v = argv[++i];
        if (v === undefined) fail("--explain-json needs a path");
        a.explainJson = v;
        break;
      }
      case "--fallback-full":
        a.fallbackFull = true;
        break;
      case "--config": {
        const v = argv[++i];
        if (v === undefined) fail("--config needs a path");
        a.configPath = v;
        break;
      }
      case "--no-update-graph":
        a.noUpdateGraph = true;
        break;
      default:
        fail(`unknown flag: ${arg}`);
    }
  }
  return a;
}

function fail(msg: string): never {
  console.error(`jest-graph-tia: ${msg}`);
  process.exit(2);
}

function loadConfig(repoRoot: string, configPath?: string): TiaConfig {
  const p = configPath ?? join(repoRoot, "jest-graph-tia.config.json");
  if (!existsSync(p)) {
    if (configPath) fail(`config not found: ${configPath}`);
    return resolveConfig(undefined);
  }
  try {
    return resolveConfig(JSON.parse(readFileSync(p, "utf8")));
  } catch (e) {
    fail(`bad config ${p}: ${(e as Error).message}`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.command !== "run") {
    console.error("usage: jest-graph-tia run --changed-since <ref> [--dry-run] [--explain] [--explain-json <path>] [--fallback-full] [--config <path>] [--no-update-graph]");
    process.exit(args.command ? 2 : 0);
  }

  const repoRoot = git(["rev-parse", "--show-toplevel"], process.cwd());
  const cfg = loadConfig(repoRoot, args.configPath);

  // 1. changed files
  const changed = getChangedFiles(repoRoot, args.changedSince);
  console.log(`changed files vs ${args.changedSince} (merge-base ${changed.mergeBase.slice(0, 8)}): ${changed.all.length}`);

  // 2. graph update (incremental, cheap) + load
  if (cfg.updateGraph && !args.noUpdateGraph) {
    const u = updateGraph(repoRoot);
    if (!u.ok) console.warn(`warning: ${u.message} — proceeding with existing graph`);
  }
  const graphPath = isAbsolute(cfg.graphPath) ? cfg.graphPath : resolve(repoRoot, cfg.graphPath);
  const loaded = loadGraph(graphPath);
  if (!loaded.ok) console.warn(`warning: ${loaded.error}`);

  // 3. expansion (graph only ever ADDS files — invariant lives in core)
  const expansion = loaded.graph
    ? expandFiles(loaded.graph, changed.all, cfg.traversal, { includeNonJs: cfg.includeNonJs })
    : { files: changed.all, hits: new Map(), unmappedChanged: [] };

  // 4. fallback decision
  const age = graphAgeCommits(repoRoot, loaded.builtAtCommit, changed.mergeBase);
  const fallback = checkFallback(changed.all, cfg.fallback, {
    graphOk: loaded.ok,
    forced: args.fallbackFull,
    unmappedChanged: expansion.unmappedChanged,
    ...(age !== undefined ? { graphAgeCommits: age } : {}),
  });
  if (fallback.triggered) {
    console.log(`FALLBACK → full suite:`);
    for (const r of fallback.reasons) console.log(`  - ${r}`);
    if (args.dryRun) {
      const all = listAllTests(repoRoot);
      console.log(all.join("\n"));
      console.log(`\n(dry run) would run the FULL suite: ${all.length} tests`);
      process.exit(0);
    }
    process.exit(runJest(repoRoot, undefined, cfg.jestArgs));
  }

  if (changed.all.length === 0) {
    console.log("no changed files — nothing to run");
    process.exit(0);
  }

  // 5. jest maps files → tests (baseline for --explain attribution, expanded = selection)
  const existsOnDisk = (f: string) => existsSync(join(repoRoot, f));
  const expandedExisting = expansion.files.filter(existsOnDisk);
  const baseline = findRelatedTests(repoRoot, changed.existing.filter(existsOnDisk));
  const selected = findRelatedTests(repoRoot, expandedExisting);

  // 6. invariant: findRelatedTests(changed) ⊆ findRelatedTests(expanded)
  const selectedSet = new Set(selected);
  const missing = baseline.filter((t) => !selectedSet.has(t));
  if (missing.length > 0) {
    // must be impossible (changed ⊆ expanded); if it fires, keep safety by re-adding
    console.error(`INVARIANT VIOLATION — baseline tests absent from selection, re-adding: ${missing.join(", ")}`);
    selected.push(...missing);
  }

  const graphOnlyFiles = expandedExisting.filter((f) => expansion.hits.has(f));
  console.log(
    `expanded ${changed.all.length} changed → ${expansion.files.length} files (graphify added ${graphOnlyFiles.length}); ` +
      `selected ${selected.length} tests (jest baseline ${baseline.length})`
  );

  // 7. explain
  if (args.explain || args.explainJson) {
    // attribute each graph-added test to the expanded file(s) that pull it in
    const attribution = new Map<string, string[]>();
    const baselineSet = new Set(baseline);
    const added = selected.filter((t) => !baselineSet.has(t));
    if (added.length > 0) {
      for (const f of graphOnlyFiles) {
        for (const t of findRelatedTests(repoRoot, [f])) {
          if (baselineSet.has(t)) continue;
          const list = attribution.get(t);
          if (list) list.push(f);
          else attribution.set(t, [f]);
        }
      }
    }
    const explanation = explainSelection({
      baselineTests: baseline,
      selectedTests: selected,
      hits: expansion.hits,
      attribution,
      fullSuiteCount: listAllTests(repoRoot).length,
      fallback,
    });
    if (args.explain) console.log("\n" + formatExplanation(explanation, { relTo: repoRoot }));
    if (args.explainJson) {
      writeFileSync(
        args.explainJson,
        JSON.stringify({ ...explanation, rows: explanation.rows }, null, 2)
      );
      console.log(`explain JSON → ${args.explainJson}`);
    }
  }

  if (args.dryRun) {
    if (!args.explain) console.log(selected.map((t) => "  " + t).join("\n"));
    console.log(`\n(dry run) would run ${selected.length} tests`);
    process.exit(0);
  }

  if (selected.length === 0) {
    console.log("no related tests — nothing to run");
    process.exit(0);
  }

  // 8. execute exactly the selection; propagate jest's exit code
  process.exit(runJest(repoRoot, selected, cfg.jestArgs));
}

main();
