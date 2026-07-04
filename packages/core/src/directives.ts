/**
 * @tia-covers directives — deterministic coverage edges, no LLM needed.
 *
 * A test that depends on a file through something no parser can see
 * (fs.readFileSync of source text, a fixture path, a CLI it shells to)
 * declares it explicitly in a comment:
 *
 *   // @tia-covers src/app/lib/chat/orchestrator.ts
 *   // @tia-covers src/app/lib/nfp/**            (globs allowed)
 *
 * The CLI collects these from test files and injects them as EXTRACTED-grade
 * edges (test depends on target) before expansion/audit. Explicit and
 * code-reviewed, so they get full trust — unlike INFERRED guesses.
 */
import type { GraphEdge, ParsedGraph } from "./graphSchema.js";
import { globToRegExp } from "./fallback.js";

const DIRECTIVE = /^\s*(?:\/\/|\/?\*+|#)\s*@tia-covers\s+(\S+)/gm;

/** Extract @tia-covers targets from one test file's source text. */
export function parseDirectives(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(DIRECTIVE)) out.push(m[1]!);
  return [...new Set(out)];
}

export interface DirectiveEdge {
  /** repo-relative test file containing the directive */
  testFile: string;
  /** literal path or glob it declares coverage of */
  target: string;
}

/**
 * Resolve directive targets (paths or globs) against the graph's known files
 * and inject synthetic edges: testFile --covers/EXTRACTED--> targetFile.
 * Mutates and returns the graph. Unknown-literal targets are returned so the
 * CLI can warn (typo protection).
 */
export function applyDirectives(
  graph: ParsedGraph,
  directives: readonly DirectiveEdge[]
): { applied: number; unresolved: DirectiveEdge[] } {
  const allFiles = [...graph.nodesOfFile.keys()];
  const unresolved: DirectiveEdge[] = [];
  let applied = 0;

  const nodeForFile = (file: string): string => {
    const existing = graph.nodesOfFile.get(file);
    if (existing && existing.length > 0) return existing[0]!;
    // file unknown to the graph (e.g. brand-new test) — synthesize a node
    const id = `tia_directive:${file}`;
    if (!graph.nodes.has(id)) {
      graph.nodes.set(id, { id, label: file, sourceFile: file });
      graph.nodesOfFile.set(file, [id]);
    }
    return id;
  };

  for (const d of directives) {
    const isGlob = /[*?]/.test(d.target);
    const targets = isGlob
      ? allFiles.filter((f) => globToRegExp(d.target).test(f))
      : graph.nodesOfFile.has(d.target)
        ? [d.target]
        : [];
    if (targets.length === 0) {
      unresolved.push(d);
      continue;
    }
    const sourceId = nodeForFile(d.testFile);
    for (const t of targets) {
      const targetId = nodeForFile(t);
      const edge: GraphEdge = { source: sourceId, target: targetId, relation: "covers", tier: "EXTRACTED" };
      const inc = graph.incoming.get(targetId);
      if (inc) inc.push(edge);
      else graph.incoming.set(targetId, [edge]);
      const out = graph.outgoing.get(sourceId);
      if (out) out.push(edge);
      else graph.outgoing.set(sourceId, [edge]);
      applied++;
    }
  }
  return { applied, unresolved };
}
