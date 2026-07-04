import { explainSelection, formatExplanation, type FileHit } from "../src/index.js";

const hit = (file: string, hops: number): FileHit => ({
  file,
  hops,
  weakestTier: "INFERRED",
  path: ["rules.json", "pricing.js"],
  fromChanged: "src/rules.json",
});

describe("explainSelection", () => {
  const baseline = ["/r/__tests__/a.test.js"];
  const selected = ["/r/__tests__/a.test.js", "/r/__tests__/pricing.test.js"];
  const hits = new Map([["src/pricing.js", hit("src/pricing.js", 1)]]);
  const attribution = new Map([["/r/__tests__/pricing.test.js", ["src/pricing.js"]]]);

  it("labels baseline tests jest, added tests graphify with path attribution", () => {
    const x = explainSelection({ baselineTests: baseline, selectedTests: selected, hits, attribution });
    expect(x.rows).toHaveLength(2);
    const jest = x.rows.find((r) => r.test.endsWith("a.test.js"))!;
    const graph = x.rows.find((r) => r.test.endsWith("pricing.test.js"))!;
    expect(jest.source).toBe("jest");
    expect(graph.source).toBe("graphify");
    expect(graph.viaFile).toBe("src/pricing.js");
    expect(graph.hops).toBe(1);
    expect(graph.weakestTier).toBe("INFERRED");
  });

  it("computes footer counts and % of full suite", () => {
    const x = explainSelection({
      baselineTests: baseline,
      selectedTests: selected,
      hits,
      attribution,
      fullSuiteCount: 8,
    });
    expect(x.footer).toMatchObject({ jestCount: 1, graphifyCount: 1, selectedCount: 2, percentOfFullSuite: 25 });
  });

  it("formats a table with footer line", () => {
    const x = explainSelection({ baselineTests: baseline, selectedTests: selected, hits, attribution });
    const out = formatExplanation(x, { relTo: "/r" });
    expect(out).toContain("TEST");
    expect(out).toContain("__tests__/pricing.test.js");
    expect(out).toContain("rules.json → pricing.js");
    expect(out).toContain("selected 2 tests (jest: 1, graphify: +1)");
    expect(out).not.toContain("/r/"); // paths relativized
  });
});
