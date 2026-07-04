#!/usr/bin/env node
/**
 * measure-delta.mjs — Phase 0 go/no-go experiment for jest-graph-tia
 *
 * For each of the last N merge commits in a target repo, compares:
 *   A) tests Jest's static analysis selects (--findRelatedTests --listTests)
 *   B) tests Graphify's semantic graph traversal selects
 * and reports the DELTA (B − A): tests only the semantic graph finds.
 *
 * Usage:
 *   node benchmarks/measure-delta.mjs --repo /path/to/repo --commits 25 \
 *     [--graph /path/to/graphify-out/graph.json] [--out benchmarks/RESULTS.md]
 *
 * Prereqs in the target repo: jest installed, graphify graph built once.
 * NOTE for the agent: the traverse() below is a stub aligned with docs/SPEC.md §3.
 * Verify Graphify's actual graph.json schema & edge direction against a real
 * artifact before trusting numbers. Keep all schema assumptions in loadGraph().
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// ---------- args ----------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] ?? "true"]);
    return acc;
  }, [])
);
const REPO = resolve(args.repo ?? ".");
const N = parseInt(args.commits ?? "20", 10);
const GRAPH = resolve(args.graph ?? join(REPO, "graphify-out/graph.json"));
const OUT = resolve(args.out ?? "benchmarks/RESULTS.md");
const BUDGET = { EXTRACTED: 6, INFERRED: 2, AMBIGUOUS: 0 }; // SPEC §3
const TIER_RANK = { EXTRACTED: 3, INFERRED: 2, AMBIGUOUS: 1 };

const git = (...a) =>
  execFileSync("git", a, { cwd: REPO, encoding: "utf8" }).trim();

// ---------- graph loading (ALL schema assumptions live here) ----------
function loadGraph(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  // EXPECTED (verify!): raw.nodes: [{id, file?, ...}], raw.edges: [{source, target, confidence?}]
  const nodes = raw.nodes ?? raw.graph?.nodes ?? [];
  const edges = raw.edges ?? raw.links ?? raw.graph?.edges ?? [];
  const fileOfNode = new Map();
  const nodesOfFile = new Map();
  for (const n of nodes) {
    const f = n.file ?? n.path ?? n.attributes?.file;
    if (!f) continue;
    fileOfNode.set(n.id, f);
    if (!nodesOfFile.has(f)) nodesOfFile.set(f, []);
    nodesOfFile.get(f).push(n.id);
  }
  // reverse adjacency: dependentsOf[target] -> [{node: source, tier}]
  // VERIFY edge direction on a known fixture before trusting results (SPEC §3).
  const dependents = new Map();
  for (const e of edges) {
    const s = e.source ?? e.from, t = e.target ?? e.to;
    const tier = (e.confidence ?? e.tag ?? "EXTRACTED").toUpperCase();
    if (!dependents.has(t)) dependents.set(t, []);
    dependents.get(t).push({ node: s, tier });
  }
  return { fileOfNode, nodesOfFile, dependents };
}

// ---------- traversal (SPEC §3) ----------
function traverse(graph, changedFiles, isTestFile) {
  const hits = new Map(); // testFile -> {hops, weakestTier}
  const seen = new Map(); // nodeId -> best (max) remaining budget seen
  const queue = [];
  for (const f of changedFiles)
    for (const id of graph.nodesOfFile.get(f) ?? [])
      queue.push({ id, hops: 0, weakest: "EXTRACTED" });

  while (queue.length) {
    const { id, hops, weakest } = queue.shift();
    const budget = BUDGET[weakest] ?? 0;
    if (hops > budget) continue;
    const key = `${id}:${weakest}`;
    if ((seen.get(key) ?? -1) >= budget - hops) continue;
    seen.set(key, budget - hops);

    const file = graph.fileOfNode.get(id);
    if (file && isTestFile(file)) {
      const prev = hits.get(file);
      if (!prev || hops < prev.hops) hits.set(file, { hops, weakest });
    }
    for (const { node, tier } of graph.dependents.get(id) ?? []) {
      const w =
        TIER_RANK[tier] < TIER_RANK[weakest] ? tier : weakest;
      if (BUDGET[w] === 0) continue;
      queue.push({ id: node, hops: hops + 1, weakest: w });
    }
  }
  return hits;
}

// ---------- jest baseline ----------
function jestRelated(changedFiles) {
  if (changedFiles.length === 0) return [];
  try {
    const out = execFileSync(
      "npx",
      ["jest", "--findRelatedTests", ...changedFiles, "--listTests"],
      { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return out.split("\n").filter((l) => l.trim().startsWith("/"));
  } catch (e) {
    // jest exits non-zero when no tests match; treat stdout as the answer
    const out = e.stdout?.toString() ?? "";
    return out.split("\n").filter((l) => l.trim().startsWith("/"));
  }
}

const isTestFile = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
const rel = (p) => p.replace(REPO + "/", "");

// ---------- main ----------
if (!existsSync(GRAPH)) {
  console.error(`graph.json not found at ${GRAPH} — run graphify on the repo first.`);
  process.exit(1);
}
const graph = loadGraph(GRAPH);
const merges = git("log", "--merges", "--format=%H", `-n${N}`).split("\n").filter(Boolean);
const commits = merges.length >= Math.min(N, 5)
  ? merges
  : git("log", "--format=%H", `-n${N}`).split("\n").filter(Boolean); // fallback: plain commits

const rows = [];
for (const c of commits) {
  const changed = git("diff", "--name-only", `${c}^1`, c).split("\n").filter(Boolean);
  if (changed.length === 0) continue;
  const jestSet = new Set(jestRelated(changed).map(rel));
  const graphHits = traverse(graph, changed, isTestFile);
  const graphSet = new Set([...graphHits.keys()].map(rel));
  const delta = [...graphSet].filter((t) => !jestSet.has(t));
  rows.push({
    commit: c.slice(0, 8),
    changed: changed.length,
    jest: jestSet.size,
    graph: graphSet.size,
    delta: delta.length,
    union: new Set([...jestSet, ...graphSet]).size,
    deltaTests: delta,
  });
  console.log(`${c.slice(0, 8)}  changed=${changed.length}  jest=${jestSet.size}  graph=${graphSet.size}  DELTA=${delta.length}`);
}

// ---------- report ----------
const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const recurring = {};
for (const r of rows) for (const t of r.deltaTests) recurring[t] = (recurring[t] ?? 0) + 1;
const top = Object.entries(recurring).sort((a, b) => b[1] - a[1]).slice(0, 15);

const md = `# jest-graph-tia — Phase 0 delta results

Repo: \`${REPO}\` · Commits analyzed: ${rows.length} · Graph: \`${GRAAPH_SAFE(GRAPH)}\`

| commit | changed files | jest selects | graphify selects | **delta (graph-only)** | union |
|---|---|---|---|---|---|
${rows.map((r) => `| ${r.commit} | ${r.changed} | ${r.jest} | ${r.graph} | **${r.delta}** | ${r.union} |`).join("\n")}

**Medians:** jest=${med(rows.map((r) => r.jest))} · delta=${med(rows.map((r) => r.delta))} · union=${med(rows.map((r) => r.union))}

## Most recurring graph-only tests
${top.map(([t, n]) => `- ${t} (${n}×)`).join("\n") || "- none"}

## Decision (SPEC §7)
Median delta near zero → publish negative result and stop.
Meaningful delta (≈≥5% of suite, or delta tests with historical failures) → proceed to Phase 1.

> Caveat: graph built at a single recent commit; older commits analyzed against it (staleness noted per SPEC §7.3).
`;
function GRAAPH_SAFE(p) { return p; } // keep template simple
writeFileSync(OUT, md);
console.log(`\nWrote ${OUT}`);
