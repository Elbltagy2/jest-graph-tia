#!/usr/bin/env node
/**
 * jest-graph-tia run    --changed-since <ref> [--dry-run] [--explain] [--explain-json <p>]
 *                       [--summary-md <p>] [--fallback-full] [--config <p>] [--no-update-graph]
 * jest-graph-tia verify --changed-since <ref> [--json <p>] [--config <p>] [--no-update-graph]
 * jest-graph-tia audit  [--explain-json <p>] [--config <p>] [--no-update-graph]
 *
 * run    — select + execute via jest, propagate jest's exit code (SPEC §2)
 * verify — escape-rate check: run the FULL suite, report failures the selection
 *          would have missed. Exit 1 if any escape. (the trust metric)
 * audit  — whole-codebase gap scan: source files no test reaches (SPEC §6b)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, isAbsolute } from "node:path";
import {
  resolveConfig,
  explainSelection,
  formatExplanation,
  auditCoverage,
  applyDirectives,
  type TiaConfig,
  type ParsedGraph,
  type Explanation,
} from "@jest-graph-tia/core";
import { listAllTests, runJest, runJestJsonFull } from "./jest.js";
import { loadGraph, updateGraph } from "./graph.js";
import { git } from "./proc.js";
import { collectDirectives } from "./directives.js";
import { computeSelection, relPath, type Selection } from "./selection.js";
import { findRelatedTests } from "./jest.js";

interface CliArgs {
  command: string;
  changedSince: string;
  dryRun: boolean;
  explain: boolean;
  explainJson?: string;
  summaryMd?: string;
  jsonOut?: string;
  fallbackFull: boolean;
  configPath?: string;
  noUpdateGraph: boolean;
}

const USAGE = `usage:
  jest-graph-tia run    --changed-since <ref> [--dry-run] [--explain] [--explain-json <path>] [--summary-md <path>] [--fallback-full] [--config <path>] [--no-update-graph]
  jest-graph-tia verify --changed-since <ref> [--json <path>] [--config <path>] [--no-update-graph]
  jest-graph-tia audit  [--explain-json <path>] [--config <path>] [--no-update-graph]`;

function fail(msg: string): never {
  console.error(`jest-graph-tia: ${msg}`);
  process.exit(2);
}

function argValue(argv: string[], i: number, flag: string): string {
  const v = argv[i];
  if (v === undefined) fail(`${flag} needs a value`);
  return v;
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
        a.changedSince = argValue(argv, ++i, arg);
        break;
      case "--dry-run":
        a.dryRun = true;
        break;
      case "--explain":
        a.explain = true;
        break;
      case "--explain-json":
        a.explainJson = argValue(argv, ++i, arg);
        break;
      case "--summary-md":
        a.summaryMd = argValue(argv, ++i, arg);
        break;
      case "--json":
        a.jsonOut = argValue(argv, ++i, arg);
        break;
      case "--fallback-full":
        a.fallbackFull = true;
        break;
      case "--config":
        a.configPath = argValue(argv, ++i, arg);
        break;
      case "--no-update-graph":
        a.noUpdateGraph = true;
        break;
      default:
        fail(`unknown flag: ${arg}`);
    }
  }
  return a;
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

/** Collect @tia-covers directives from test files and inject them as graph edges. */
function injectDirectives(graph: ParsedGraph, repoRoot: string, testFilesRel: readonly string[]): void {
  const dirs = collectDirectives(repoRoot, testFilesRel);
  if (dirs.length === 0) return;
  const { applied, unresolved } = applyDirectives(graph, dirs);
  if (applied > 0) {
    console.log(`@tia-covers: injected ${applied} edge(s) from ${new Set(dirs.map((d) => d.testFile)).size} test file(s)`);
  }
  for (const u of unresolved) {
    console.warn(`warning: @tia-covers target not found in graph: ${u.target} (${u.testFile})`);
  }
}

function buildExplanation(repoRoot: string, sel: Selection): Explanation {
  // attribute each graph-added test to the expanded file(s) that pull it in
  const attribution = new Map<string, string[]>();
  const baselineSet = new Set(sel.baseline);
  const added = (sel.selected ?? []).filter((t) => !baselineSet.has(t));
  if (added.length > 0) {
    for (const f of sel.graphOnlyFiles) {
      for (const t of findRelatedTests(repoRoot, [f])) {
        if (baselineSet.has(t)) continue;
        const list = attribution.get(t);
        if (list) list.push(f);
        else attribution.set(t, [f]);
      }
    }
  }
  return explainSelection({
    baselineTests: sel.baseline,
    selectedTests: sel.selected ?? [],
    hits: sel.expansion.hits,
    attribution,
    fullSuiteCount: sel.fullSuite.length,
    fallback: sel.fallback,
  });
}

function writeSummaryMd(path: string, repoRoot: string, sel: Selection, changedSince: string): void {
  const selected = sel.selected ?? sel.fullSuite;
  const pct = sel.fullSuite.length === 0 ? 0 : Math.round((selected.length / sel.fullSuite.length) * 1000) / 10;
  const baselineSet = new Set(sel.baseline);
  const added = sel.selected ? sel.selected.filter((t) => !baselineSet.has(t)) : [];
  const lines = [
    `## jest-graph-tia — test selection`,
    ``,
    sel.fallback.triggered
      ? `**FULL SUITE** (${sel.fullSuite.length} tests) — fallback triggered:\n${sel.fallback.reasons.map((r) => `- ${r}`).join("\n")}`
      : `**${selected.length} / ${sel.fullSuite.length}** tests selected (${pct}% of suite) for ${sel.changed.all.length} changed file(s) vs \`${changedSince}\``,
    ``,
  ];
  if (!sel.fallback.triggered) {
    lines.push(`| source | tests |`, `|---|---|`, `| jest static graph | ${sel.baseline.length} |`, `| + graphify expansion | ${added.length} |`);
    if (added.length > 0) {
      lines.push(``, `<details><summary>graph-added tests (${added.length})</summary>`, ``);
      for (const t of added.slice(0, 25)) lines.push(`- \`${relPath(repoRoot, t)}\``);
      if (added.length > 25) lines.push(`- … +${added.length - 25} more`);
      lines.push(``, `</details>`);
    }
  }
  writeFileSync(path, lines.join("\n") + "\n");
  console.log(`summary → ${path}`);
}

/* ────────────────────────── run ────────────────────────── */

function runMain(args: CliArgs): void {
  const repoRoot = git(["rev-parse", "--show-toplevel"], process.cwd());
  const cfg = loadConfig(repoRoot, args.configPath);
  const sel = computeSelection(repoRoot, cfg, {
    changedSince: args.changedSince,
    fallbackForced: args.fallbackFull,
    skipGraphUpdate: args.noUpdateGraph,
  });
  console.log(
    `changed files vs ${args.changedSince} (merge-base ${sel.changed.mergeBase.slice(0, 8)}): ${sel.changed.all.length}`
  );

  if (args.summaryMd) writeSummaryMd(args.summaryMd, repoRoot, sel, args.changedSince);

  if (sel.fallback.triggered) {
    console.log(`FALLBACK → full suite:`);
    for (const r of sel.fallback.reasons) console.log(`  - ${r}`);
    if (args.dryRun) {
      console.log(sel.fullSuite.join("\n"));
      console.log(`\n(dry run) would run the FULL suite: ${sel.fullSuite.length} tests`);
      process.exit(0);
    }
    process.exit(runJest(repoRoot, undefined, cfg.jestArgs));
  }

  if (sel.changed.all.length === 0) {
    console.log("no changed files — nothing to run");
    process.exit(0);
  }

  const selected = sel.selected!;
  // amplification guard: two chained expansions can balloon toward the full
  // suite — surface the ratio on EVERY run.
  const pct = sel.fullSuite.length === 0 ? 0 : Math.round((selected.length / sel.fullSuite.length) * 1000) / 10;
  console.log(
    `expanded ${sel.changed.all.length} changed → ${sel.expansion.files.length} files (graphify added ${sel.graphOnlyFiles.length}); ` +
      `selected ${selected.length}/${sel.fullSuite.length} tests (${pct}% of suite; jest baseline ${sel.baseline.length})`
  );
  if (pct > 60) {
    console.warn(
      `warning: selection is ${pct}% of the suite — expansion is amplifying too much. ` +
        `Lower traversal.inferred/traversal.extracted hop budgets, or just run the full suite.`
    );
  }

  if (args.explain || args.explainJson) {
    const explanation = buildExplanation(repoRoot, sel);
    if (args.explain) console.log("\n" + formatExplanation(explanation, { relTo: repoRoot }));
    if (args.explainJson) {
      writeFileSync(args.explainJson, JSON.stringify(explanation, null, 2));
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

  process.exit(runJest(repoRoot, selected, cfg.jestArgs));
}

/* ────────────────────────── verify ────────────────────────── */

/**
 * The trust metric (escape-rate): run the FULL suite for real, then check
 * whether every failing test file would have been in the selection.
 * An "escape" = a failure the selection would have skipped. Exit 1 on any.
 */
function verifyMain(args: CliArgs): void {
  const repoRoot = git(["rev-parse", "--show-toplevel"], process.cwd());
  const cfg = loadConfig(repoRoot, args.configPath);
  const sel = computeSelection(repoRoot, cfg, {
    changedSince: args.changedSince,
    fallbackForced: args.fallbackFull,
    skipGraphUpdate: args.noUpdateGraph,
  });

  console.log(`verify: running the FULL suite (${sel.fullSuite.length} tests) to measure escapes…`);
  const report = runJestJsonFull(repoRoot, cfg.jestArgs);
  if (report.results.size === 0) fail("could not parse jest --json output");

  const failures = [...report.results.entries()].filter(([, passed]) => !passed).map(([f]) => f);
  const selectedSet = new Set(sel.selected ?? sel.fullSuite); // fallback = everything selected
  const caught = failures.filter((f) => selectedSet.has(f));
  const escapes = failures.filter((f) => !selectedSet.has(f));

  const out = {
    verifyVersion: 1,
    changedSince: args.changedSince,
    fallbackTriggered: sel.fallback.triggered,
    fullSuite: sel.fullSuite.length,
    selected: sel.selected?.length ?? sel.fullSuite.length,
    failures: failures.map((f) => relPath(repoRoot, f)),
    caught: caught.map((f) => relPath(repoRoot, f)),
    escapes: escapes.map((f) => relPath(repoRoot, f)),
  };
  if (args.jsonOut) {
    writeFileSync(args.jsonOut, JSON.stringify(out, null, 2));
    console.log(`verify JSON → ${args.jsonOut}`);
  }

  console.log(
    `\nverify: ${failures.length} failing test file(s) in the full suite · ` +
      `selection would have caught ${caught.length} · ESCAPES: ${escapes.length}`
  );
  if (escapes.length > 0) {
    console.error(`\nESCAPED FAILURES (selection would have skipped these):`);
    for (const f of escapes) console.error(`  ✕ ${relPath(repoRoot, f)}`);
    console.error(
      `\nEach escape is a dependency the graph doesn't know. Fix: add a // @tia-covers directive ` +
        `in the test, run graphify's LLM pass, or widen hop budgets.`
    );
    process.exit(1);
  }
  console.log(escapes.length === 0 && failures.length === 0 ? "suite green — nothing to escape" : "no escapes — selection is safe for this change");
  process.exit(0);
}

/* ────────────────────────── audit ────────────────────────── */

function auditMain(args: CliArgs): void {
  const repoRoot = git(["rev-parse", "--show-toplevel"], process.cwd());
  const cfg = loadConfig(repoRoot, args.configPath);

  if (cfg.updateGraph && !args.noUpdateGraph) {
    const u = updateGraph(repoRoot);
    if (!u.ok) console.warn(`warning: ${u.message} — proceeding with existing graph`);
  }
  const graphPath = isAbsolute(cfg.graphPath) ? cfg.graphPath : resolve(repoRoot, cfg.graphPath);
  const loaded = loadGraph(graphPath);
  if (!loaded.ok || !loaded.graph) fail(`audit needs a graph: ${loaded.error}`);

  const testFiles = listAllTests(repoRoot).map((t) => relPath(repoRoot, t));
  if (testFiles.length === 0) fail("jest --listTests returned no tests — is jest set up in this repo?");

  injectDirectives(loaded.graph, repoRoot, testFiles);

  const result = auditCoverage(loaded.graph, {
    traversal: cfg.traversal,
    testFiles,
    excludeGlobs: cfg.audit.excludeGlobs,
  });

  const coveredCount = result.covered.size;
  const pct = result.totalSourceFiles === 0 ? 0 : Math.round((coveredCount / result.totalSourceFiles) * 1000) / 10;
  console.log(
    `audit: ${result.totalSourceFiles} source files known to the graph · ` +
      `${coveredCount} reached by tests (${pct}%) · ${result.untested.length} UNTESTED`
  );
  if (result.testsNotInGraph.length > 0) {
    console.warn(
      `warning: ${result.testsNotInGraph.length} test files have no graph nodes (stale graph?) — run graphify update`
    );
  }

  if (result.untested.length > 0) {
    const byDir = new Map<string, string[]>();
    for (const f of result.untested) {
      const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ".";
      const list = byDir.get(dir);
      if (list) list.push(f);
      else byDir.set(dir, [f]);
    }
    console.log("\nUNTESTED FILES (no test reaches them through the graph):");
    for (const [dir, files] of [...byDir.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n  ${dir}/  (${files.length})`);
      for (const f of files) console.log(`    ${f.slice(dir === "." ? 0 : dir.length + 1)}`);
    }
  } else {
    console.log("every source file in the graph is reachable from at least one test");
  }

  if (args.explainJson) {
    writeFileSync(
      args.explainJson,
      JSON.stringify(
        {
          auditVersion: 1,
          totalSourceFiles: result.totalSourceFiles,
          coveredCount,
          coveredPercent: pct,
          untested: result.untested,
          testsNotInGraph: result.testsNotInGraph,
          covered: [...result.covered.values()],
        },
        null,
        2
      )
    );
    console.log(`\naudit JSON → ${args.explainJson}`);
  }
  process.exit(0);
}

/* ────────────────────────── entry ────────────────────────── */

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "run":
      return runMain(args);
    case "verify":
      return verifyMain(args);
    case "audit":
      return auditMain(args);
    default:
      console.error(USAGE);
      process.exit(args.command ? 2 : 0);
  }
}

main();
