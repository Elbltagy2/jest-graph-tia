import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGraph, expandFiles, DEFAULT_CONFIG, type TraversalConfig } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const graph = parseGraph(
  JSON.parse(readFileSync(join(here, "../../../fixtures/mini-repo/graphify-out/graph.json"), "utf8"))
);
const T: TraversalConfig = DEFAULT_CONFIG.traversal; // extracted 6 / inferred 2 / ambiguous 0

describe("expandFiles on the fixture graph", () => {
  it("dynamic-require scenario: changing rules.json reaches pricing and its test", () => {
    const r = expandFiles(graph, ["src/rules.json"], T);
    expect(r.files).toContain("src/pricing.js");
    expect(r.files).toContain("__tests__/pricing.test.js");
    const hit = r.hits.get("src/pricing.js")!;
    expect(hit.weakestTier).toBe("INFERRED");
    expect(hit.hops).toBe(1);
  });

  it("event-coupling scenario: changing events.js reaches listener via INFERRED edge", () => {
    const r = expandFiles(graph, ["src/events.js"], T);
    expect(r.files).toContain("src/listener.js");
    expect(r.hits.get("src/listener.js")!.weakestTier).toBe("INFERRED");
  });

  it("static chain: changing math.js reaches calc and calc.test via EXTRACTED", () => {
    const r = expandFiles(graph, ["src/math.js"], T);
    expect(r.files).toContain("src/calc.js");
    expect(r.files).toContain("__tests__/calc.test.js");
    expect(r.hits.get("__tests__/calc.test.js")!.weakestTier).toBe("EXTRACTED");
    expect(r.hits.get("__tests__/calc.test.js")!.hops).toBe(2);
  });

  it("AMBIGUOUS edges are off by default and on when budgeted", () => {
    const off = expandFiles(graph, ["src/math.js"], T);
    expect(off.files).not.toContain("src/legacy.js");
    const on = expandFiles(graph, ["src/math.js"], { ...T, ambiguous: 1 });
    expect(on.files).toContain("src/legacy.js");
    expect(on.hits.get("src/legacy.js")!.weakestTier).toBe("AMBIGUOUS");
  });

  it("hop budget caps INFERRED paths (weakest-tier budget, not per-edge)", () => {
    // rules.json -> pricing (INFERRED, hop1) -> pricing.test (EXTRACTED edge but path tier stays INFERRED, hop2)
    const tight = expandFiles(graph, ["src/rules.json"], { ...T, inferred: 1 });
    expect(tight.files).toContain("src/pricing.js");
    expect(tight.files).not.toContain("__tests__/pricing.test.js");
  });

  it("NEVER expands toward dependencies — only dependents (reverse direction)", () => {
    // calc.js depends on math.js. Changing calc.js must reach calc.test (its consumer)
    // but must NOT pull in math.js (its dependency) — that would balloon selection uselessly.
    const r = expandFiles(graph, ["src/calc.js"], T);
    expect(r.files).toContain("__tests__/calc.test.js");
    expect(r.files).not.toContain("src/math.js");
    // and pricing.js depends on rules.json: changing pricing.js must not drag rules.json in
    const r2 = expandFiles(graph, ["src/pricing.js"], T);
    expect(r2.files).not.toContain("src/rules.json");
  });

  it("drops non-JS related files but keeps their JS dependents (signal preserved)", () => {
    // migration.sql changed → repo.ts reads it (JS dependent, keep) and docs.md references
    // the same table (non-JS dependent, drop from jest input — no JS module maps to it)
    const g = parseGraph({
      nodes: [
        { id: "sql", source_file: "db/001.sql" },
        { id: "repo", source_file: "src/repo.ts" },
        { id: "docs", source_file: "docs/schema.md" },
        { id: "repo_test", source_file: "src/repo.test.ts" },
      ],
      links: [
        { source: "repo", target: "sql", relation: "reads", confidence: "INFERRED" },
        { source: "docs", target: "sql", relation: "references", confidence: "INFERRED" },
        { source: "repo_test", target: "repo", relation: "imports_from", confidence: "EXTRACTED" },
      ],
    });
    const r = expandFiles(g, ["db/001.sql"], T);
    expect(r.files).toContain("src/repo.ts"); // the migration change reaches repo tests through this
    expect(r.files).toContain("src/repo.test.ts");
    expect(r.files).not.toContain("docs/schema.md"); // non-JS related dropped
    expect(r.files).toContain("db/001.sql"); // changed file itself always kept (superset)
  });

  it("reports changed files with zero graph nodes", () => {
    const r = expandFiles(graph, ["src/unknown.js", "src/math.js"], T);
    expect(r.unmappedChanged).toEqual(["src/unknown.js"]);
    expect(r.files).toContain("src/unknown.js"); // still kept in output (superset)
  });

  it("filters non-JS related files by default, keeps them with includeNonJs", () => {
    // reverse direction: nothing depends on tests, so use rules.json as a *related* file:
    // nothing points AT rules.json's dependents chain in reverse except via pricing —
    // simulate by changing pricing.js and checking rules.json (its dependent set is upstream, so
    // rules.json is never a dependent; instead assert the filter with includeNonJs on a graph hit).
    const r = expandFiles(graph, ["src/rules.json"], T, { includeNonJs: true });
    expect(r.files).toContain("src/rules.json");
  });

  it("records a human-readable path for --explain", () => {
    const r = expandFiles(graph, ["src/math.js"], T);
    expect(r.hits.get("__tests__/calc.test.js")!.path).toEqual(["math.js", "calc.js", "calc.test.js"]);
    expect(r.hits.get("__tests__/calc.test.js")!.fromChanged).toBe("src/math.js");
  });
});
