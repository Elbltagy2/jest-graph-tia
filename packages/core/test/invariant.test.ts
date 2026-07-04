/**
 * THE invariant (CLAUDE.md / SPEC §2.5): expansion only ever ADDS files.
 * For 100 randomized graph+change scenarios: changed ⊆ expandFiles(...).files.
 * Seeded PRNG — deterministic, no flake.
 */
import { parseGraph, expandFiles, type Tier } from "../src/index.js";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIERS: Tier[] = ["EXTRACTED", "INFERRED", "AMBIGUOUS"];
const RELATIONS = ["imports_from", "calls", "contains", "reads", "listens_to_event"];

function randomScenario(rnd: () => number) {
  const nFiles = 3 + Math.floor(rnd() * 12);
  const files = Array.from({ length: nFiles }, (_, i) =>
    rnd() < 0.7 ? `src/f${i}.js` : rnd() < 0.5 ? `src/f${i}.test.js` : `data/f${i}.json`
  );
  const nodes: unknown[] = [];
  let nid = 0;
  for (const f of files) {
    const perFile = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < perFile; k++) nodes.push({ id: `n${nid++}`, label: `${f}#${k}`, source_file: f });
  }
  // some nodes with no file at all
  for (let k = 0; k < 3; k++) nodes.push({ id: `n${nid++}`, label: `ghost${k}` });
  const links: unknown[] = [];
  const nEdges = Math.floor(rnd() * nid * 2);
  for (let k = 0; k < nEdges; k++) {
    links.push({
      source: `n${Math.floor(rnd() * nid)}`,
      target: `n${Math.floor(rnd() * nid)}`,
      relation: RELATIONS[Math.floor(rnd() * RELATIONS.length)],
      confidence: TIERS[Math.floor(rnd() * TIERS.length)],
    });
  }
  // changed set: random subset of known files + sometimes files unknown to the graph
  const changed = files.filter(() => rnd() < 0.4);
  if (rnd() < 0.5) changed.push("src/not-in-graph.js");
  if (changed.length === 0) changed.push(files[0]!);
  const cfg = {
    extracted: Math.floor(rnd() * 8),
    inferred: Math.floor(rnd() * 4),
    ambiguous: Math.floor(rnd() * 2),
  };
  return { graph: parseGraph({ nodes, links }), changed, cfg, includeNonJs: rnd() < 0.5 };
}

describe("invariant: expandFiles output is a superset of changed files", () => {
  it("holds for 100 randomized scenarios", () => {
    const rnd = mulberry32(0xc0ffee);
    for (let i = 0; i < 100; i++) {
      const { graph, changed, cfg, includeNonJs } = randomScenario(rnd);
      const result = expandFiles(graph, changed, cfg, { includeNonJs });
      const out = new Set(result.files);
      for (const f of changed) {
        if (!out.has(f)) {
          throw new Error(`scenario ${i}: changed file '${f}' missing from expansion output`);
        }
      }
      // hits never contain changed files (they are "related", not "changed")
      for (const f of changed) expect(result.hits.has(f)).toBe(false);
    }
  });

  it("expansion terminates on cyclic graphs", () => {
    const graph = parseGraph({
      nodes: [
        { id: "a", source_file: "a.js" },
        { id: "b", source_file: "b.js" },
      ],
      links: [
        { source: "a", target: "b", relation: "imports_from", confidence: "EXTRACTED" },
        { source: "b", target: "a", relation: "imports_from", confidence: "EXTRACTED" },
      ],
    });
    const r = expandFiles(graph, ["a.js"], { extracted: 6, inferred: 2, ambiguous: 0 });
    expect(r.files.sort()).toEqual(["a.js", "b.js"]);
  });
});
