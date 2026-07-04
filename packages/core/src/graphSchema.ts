/**
 * ALL graph.json schema assumptions live in this file (SPEC §3, §9).
 *
 * Verified against graphify 0.8.39 output:
 * - networkx node-link JSON: top-level { directed, multigraph, graph, nodes, links }
 * - edges live under `links` (NOT `edges`)
 * - node: { id, label, source_file (repo-relative), source_location, file_type, community }
 * - edge: { source, target, relation, confidence, confidence_score, weight }
 * - direction: source DEPENDS ON target → dependents-of-X = incoming edges of X
 */

export type Tier = "EXTRACTED" | "INFERRED" | "AMBIGUOUS";

export interface GraphNode {
  id: string;
  label?: string;
  sourceFile?: string;
  fileType?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  tier: Tier;
}

export interface ParsedGraph {
  /** nodeId → node */
  nodes: Map<string, GraphNode>;
  /** repo-relative file path → nodeIds whose source_file is that path */
  nodesOfFile: Map<string, string[]>;
  /** nodeId → incoming edges (edges whose target is this node); edge.source is the dependent */
  incoming: Map<string, GraphEdge[]>;
  nodeCount: number;
  edgeCount: number;
}

export class GraphSchemaError extends Error {
  constructor(message: string) {
    super(
      `graph.json schema error: ${message}. ` +
        `Expected graphify node-link format (verified against graphify 0.8.39). ` +
        `If graphify changed its output format, update packages/core/src/graphSchema.ts.`
    );
    this.name = "GraphSchemaError";
  }
}

const TIERS: ReadonlySet<string> = new Set(["EXTRACTED", "INFERRED", "AMBIGUOUS"]);

function normalizeTier(raw: unknown): Tier {
  const t = typeof raw === "string" ? raw.toUpperCase() : "EXTRACTED";
  return (TIERS.has(t) ? t : "EXTRACTED") as Tier;
}

/** Parse the raw JSON.parse()'d contents of graph.json. Throws GraphSchemaError on shape mismatch. */
export function parseGraph(raw: unknown): ParsedGraph {
  if (raw === null || typeof raw !== "object") {
    throw new GraphSchemaError("top level is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const rawNodes = obj["nodes"];
  const rawLinks = obj["links"] ?? obj["edges"]; // `links` is canonical; `edges` tolerated
  if (!Array.isArray(rawNodes)) throw new GraphSchemaError("`nodes` is not an array");
  if (!Array.isArray(rawLinks)) throw new GraphSchemaError("`links` is not an array");

  const nodes = new Map<string, GraphNode>();
  const nodesOfFile = new Map<string, string[]>();
  for (const n of rawNodes) {
    if (n === null || typeof n !== "object") throw new GraphSchemaError("node is not an object");
    const rec = n as Record<string, unknown>;
    const id = rec["id"];
    if (typeof id !== "string" || id.length === 0) {
      throw new GraphSchemaError("node without a string `id`");
    }
    const sourceFile = typeof rec["source_file"] === "string" ? (rec["source_file"] as string) : undefined;
    const node: GraphNode = { id };
    if (typeof rec["label"] === "string") node.label = rec["label"] as string;
    if (sourceFile !== undefined) node.sourceFile = sourceFile;
    if (typeof rec["file_type"] === "string") node.fileType = rec["file_type"] as string;
    nodes.set(id, node);
    if (sourceFile !== undefined) {
      const list = nodesOfFile.get(sourceFile);
      if (list) list.push(id);
      else nodesOfFile.set(sourceFile, [id]);
    }
  }

  const incoming = new Map<string, GraphEdge[]>();
  let edgeCount = 0;
  for (const e of rawLinks) {
    if (e === null || typeof e !== "object") throw new GraphSchemaError("edge is not an object");
    const rec = e as Record<string, unknown>;
    const source = rec["source"];
    const target = rec["target"];
    if (typeof source !== "string" || typeof target !== "string") {
      throw new GraphSchemaError("edge without string `source`/`target`");
    }
    const edge: GraphEdge = {
      source,
      target,
      relation: typeof rec["relation"] === "string" ? (rec["relation"] as string) : "unknown",
      tier: normalizeTier(rec["confidence"]),
    };
    const list = incoming.get(target);
    if (list) list.push(edge);
    else incoming.set(target, [edge]);
    edgeCount++;
  }

  return { nodes, nodesOfFile, incoming, nodeCount: nodes.size, edgeCount };
}
