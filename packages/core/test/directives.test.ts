import { parseDirectives, applyDirectives, parseGraph, expandFiles, auditCoverage, DEFAULT_CONFIG } from "../src/index.js";

describe("parseDirectives", () => {
  it("extracts targets from //, /* and # comments, dedupes", () => {
    const src = `
// @tia-covers src/app/lib/chat/orchestrator.ts
/* @tia-covers src/app/lib/nfp/** */
 * @tia-covers fixtures/data.csv
# @tia-covers scripts/build.sh
// @tia-covers src/app/lib/chat/orchestrator.ts
const x = "@tia-covers not/a/comment"; // not at line start after code — still matches? no: quoted line starts with const
`;
    expect(parseDirectives(src)).toEqual([
      "src/app/lib/chat/orchestrator.ts",
      "src/app/lib/nfp/**",
      "fixtures/data.csv",
      "scripts/build.sh",
    ]);
  });

  it("returns empty for files without directives", () => {
    expect(parseDirectives("import x from './y';\ntest('a', () => {});")).toEqual([]);
  });
});

function freshGraph() {
  return parseGraph({
    nodes: [
      { id: "orch", source_file: "src/chat/orchestrator.ts" },
      { id: "nfp_a", source_file: "src/nfp/a.ts" },
      { id: "nfp_b", source_file: "src/nfp/b.ts" },
      { id: "t_struct", source_file: "tests/orchestrator-structure.test.ts" },
    ],
    links: [],
  });
}

describe("applyDirectives", () => {
  it("injects reverse-walkable edges: changed target selects the directive test", () => {
    const g = freshGraph();
    const { applied, unresolved } = applyDirectives(g, [
      { testFile: "tests/orchestrator-structure.test.ts", target: "src/chat/orchestrator.ts" },
    ]);
    expect(applied).toBe(1);
    expect(unresolved).toEqual([]);
    // change orchestrator → expansion must reach the structure test
    const r = expandFiles(g, ["src/chat/orchestrator.ts"], DEFAULT_CONFIG.traversal);
    expect(r.files).toContain("tests/orchestrator-structure.test.ts");
    expect(r.hits.get("tests/orchestrator-structure.test.ts")!.weakestTier).toBe("EXTRACTED");
  });

  it("expands globs against graph files", () => {
    const g = freshGraph();
    const { applied } = applyDirectives(g, [
      { testFile: "tests/orchestrator-structure.test.ts", target: "src/nfp/**" },
    ]);
    expect(applied).toBe(2);
    const r = expandFiles(g, ["src/nfp/b.ts"], DEFAULT_CONFIG.traversal);
    expect(r.files).toContain("tests/orchestrator-structure.test.ts");
  });

  it("reports unresolved literal targets (typo protection)", () => {
    const g = freshGraph();
    const { applied, unresolved } = applyDirectives(g, [
      { testFile: "tests/orchestrator-structure.test.ts", target: "src/chat/orchestraTOR.ts" },
    ]);
    expect(applied).toBe(0);
    expect(unresolved).toHaveLength(1);
  });

  it("audit counts directive targets as covered", () => {
    const g = freshGraph();
    applyDirectives(g, [
      { testFile: "tests/orchestrator-structure.test.ts", target: "src/chat/orchestrator.ts" },
    ]);
    const r = auditCoverage(g, {
      traversal: DEFAULT_CONFIG.traversal,
      testFiles: ["tests/orchestrator-structure.test.ts"],
    });
    expect(r.covered.has("src/chat/orchestrator.ts")).toBe(true);
    expect(r.untested).toEqual(["src/nfp/a.ts", "src/nfp/b.ts"]);
  });
});
