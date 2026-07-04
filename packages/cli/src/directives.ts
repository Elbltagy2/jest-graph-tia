/** Collect @tia-covers directives from all test files. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDirectives, type DirectiveEdge } from "@jest-graph-tia/core";

export function collectDirectives(repoRoot: string, testFilesRel: readonly string[]): DirectiveEdge[] {
  const out: DirectiveEdge[] = [];
  for (const t of testFilesRel) {
    let src: string;
    try {
      src = readFileSync(join(repoRoot, t), "utf8");
    } catch {
      continue;
    }
    for (const target of parseDirectives(src)) out.push({ testFile: t, target });
  }
  return out;
}
