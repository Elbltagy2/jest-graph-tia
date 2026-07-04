/** graphify invocation + graph.json loading. Graphify is an external CLI, never vendored. */
import { readFileSync } from "node:fs";
import { parseGraph, GraphSchemaError, type ParsedGraph } from "@jest-graph-tia/core";
import { run } from "./proc.js";

export interface LoadedGraph {
  graph?: ParsedGraph;
  ok: boolean;
  error?: string;
  /** commit recorded in graph.json metadata, if graphify wrote one */
  builtAtCommit?: string;
}

export function updateGraph(repoRoot: string): { ok: boolean; message: string } {
  try {
    const r = run("graphify", ["update", repoRoot], repoRoot);
    return r.status === 0
      ? { ok: true, message: "graph updated" }
      : { ok: false, message: `graphify update exited ${r.status}: ${r.stderr.slice(0, 400)}` };
  } catch (e) {
    return { ok: false, message: `graphify not runnable: ${(e as Error).message}` };
  }
}

export function loadGraph(graphJsonPath: string): LoadedGraph {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(graphJsonPath, "utf8"));
  } catch (e) {
    return { ok: false, error: `cannot read/parse ${graphJsonPath}: ${(e as Error).message}` };
  }
  try {
    const graph = parseGraph(raw);
    const meta = (raw as { graph?: Record<string, unknown> }).graph;
    const commit = meta && typeof meta["commit"] === "string" ? (meta["commit"] as string) : undefined;
    const result: LoadedGraph = { graph, ok: true };
    if (commit !== undefined) result.builtAtCommit = commit;
    return result;
  } catch (e) {
    if (e instanceof GraphSchemaError) return { ok: false, error: e.message };
    throw e;
  }
}
