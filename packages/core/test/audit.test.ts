import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGraph, auditCoverage, DEFAULT_CONFIG } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const graph = parseGraph(
  JSON.parse(readFileSync(join(here, "../../../fixtures/mini-repo/graphify-out/graph.json"), "utf8"))
);
const T = DEFAULT_CONFIG.traversal;
const ALL_TESTS = ["__tests__/calc.test.js", "__tests__/pricing.test.js", "__tests__/listener.test.js"];

describe("auditCoverage on the fixture graph", () => {
  it("marks files reachable from tests as covered, the rest untested", () => {
    const r = auditCoverage(graph, { traversal: T, testFiles: ALL_TESTS });
    // calc.test -> calc -> math ; pricing.test -> pricing ; listener.test -> listener, events
    for (const f of ["src/calc.js", "src/math.js", "src/pricing.js", "src/listener.js", "src/events.js"]) {
      expect(r.covered.has(f)).toBe(true);
    }
    // legacy.js is only linked by an AMBIGUOUS edge (off by default) → untested
    expect(r.untested).toEqual(["src/legacy.js"]);
    expect(r.totalSourceFiles).toBe(6);
  });

  it("coverage follows DEPENDENCIES of tests, never dependents", () => {
    // legacy.js depends on math.js (legacy -> math). Tests reach math as a dependency,
    // but nothing depends-on legacy from a test side — enabling AMBIGUOUS must NOT
    // fake-cover it: a file is covered only if a test transitively imports/uses it.
    const r = auditCoverage(graph, { traversal: { ...T, ambiguous: 2 }, testFiles: ALL_TESTS });
    expect(r.untested).toContain("src/legacy.js");
  });

  it("losing a test loses its whole dependency subtree", () => {
    const r = auditCoverage(graph, {
      traversal: T,
      testFiles: ["__tests__/calc.test.js", "__tests__/listener.test.js"], // pricing.test removed
    });
    expect(r.untested).toContain("src/pricing.js");
    expect(r.untested).not.toContain("src/rules.json"); // non-JS files are outside the audit universe
  });

  it("reports tests missing from the graph (staleness signal)", () => {
    const r = auditCoverage(graph, { traversal: T, testFiles: [...ALL_TESTS, "__tests__/new.test.js"] });
    expect(r.testsNotInGraph).toEqual(["__tests__/new.test.js"]);
  });

  it("respects excludeGlobs", () => {
    const r = auditCoverage(graph, { traversal: T, testFiles: ALL_TESTS, excludeGlobs: ["src/legacy.js"] });
    expect(r.untested).toEqual([]);
    expect(r.totalSourceFiles).toBe(5);
  });

  it("misnamed-test scenario: a test importing the wrong module leaves the intended module untested", () => {
    // like agilitas' math-utils.test.ts importing money-utils: coverage follows IMPORTS, not filenames
    const g = parseGraph({
      nodes: [
        { id: "money", source_file: "src/money-utils.ts" },
        { id: "math", source_file: "src/math-utils.ts" },
        { id: "t", source_file: "tests/math-utils.test.ts" },
      ],
      links: [{ source: "t", target: "money", relation: "imports_from", confidence: "EXTRACTED" }],
    });
    const r = auditCoverage(g, { traversal: T, testFiles: ["tests/math-utils.test.ts"] });
    expect(r.covered.has("src/money-utils.ts")).toBe(true);
    expect(r.untested).toEqual(["src/math-utils.ts"]);
  });
});
