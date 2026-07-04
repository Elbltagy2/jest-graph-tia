import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGraph, GraphSchemaError } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_GRAPH = join(here, "../../../fixtures/mini-repo/graphify-out/graph.json");

describe("parseGraph", () => {
  const raw = JSON.parse(readFileSync(FIXTURE_GRAPH, "utf8"));

  it("parses the fixture graph (graphify node-link shape)", () => {
    const g = parseGraph(raw);
    expect(g.nodeCount).toBe(10);
    expect(g.edgeCount).toBe(8);
    expect(g.nodesOfFile.get("src/math.js")).toEqual(["src_math"]);
  });

  it("builds reverse adjacency: dependents = incoming edges (source depends on target)", () => {
    const g = parseGraph(raw);
    const deps = (g.incoming.get("src_math") ?? []).map((e) => e.source).sort();
    expect(deps).toEqual(["src_calc", "src_legacy"]); // calc imports math; legacy ~ math
  });

  it("normalizes unknown confidence to EXTRACTED and tolerates `edges` key", () => {
    const g = parseGraph({
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ source: "a", target: "b", relation: "x", confidence: "weird" }],
    });
    expect(g.incoming.get("b")![0]!.tier).toBe("EXTRACTED");
  });

  it("throws GraphSchemaError on shape mismatch", () => {
    expect(() => parseGraph(null)).toThrow(GraphSchemaError);
    expect(() => parseGraph({ nodes: "nope", links: [] })).toThrow(GraphSchemaError);
    expect(() => parseGraph({ nodes: [{ id: "a" }], links: [{ source: "a" }] })).toThrow(GraphSchemaError);
    expect(() => parseGraph({ nodes: [{}], links: [] })).toThrow(GraphSchemaError);
  });
});
