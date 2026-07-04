import { git } from "./proc.js";

export interface ChangedFiles {
  /** repo-relative paths: added/modified/renamed(new path) AND deleted(old path) */
  all: string[];
  /** subset that still exists on disk (safe to hand to jest --findRelatedTests) */
  existing: string[];
  mergeBase: string;
}

export function getChangedFiles(repoRoot: string, baseRef: string): ChangedFiles {
  const mergeBase = git(["merge-base", baseRef, "HEAD"], repoRoot);
  const out = git(["diff", "--name-status", "-M", `${mergeBase}...HEAD`, "--"], repoRoot);
  const all: string[] = [];
  const deleted = new Set<string>();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0] ?? "";
    if (status.startsWith("R")) {
      // rename: old path acts like a delete (graph may still know it), new path like an add
      if (parts[1]) {
        all.push(parts[1]);
        deleted.add(parts[1]);
      }
      if (parts[2]) all.push(parts[2]);
    } else if (status.startsWith("D")) {
      if (parts[1]) {
        all.push(parts[1]);
        deleted.add(parts[1]);
      }
    } else if (parts[1]) {
      all.push(parts[1]);
    }
  }
  // uncommitted changes on top of HEAD count too
  const dirty = git(["diff", "--name-only", "HEAD", "--"], repoRoot);
  for (const f of dirty.split("\n")) if (f.trim()) all.push(f.trim());
  const unique = [...new Set(all)];
  return {
    all: unique,
    existing: unique.filter((f) => !deleted.has(f)),
    mergeBase,
  };
}

/** Commits between the graph's recorded build commit and merge-base; undefined if unknowable. */
export function graphAgeCommits(
  repoRoot: string,
  graphCommit: string | undefined,
  mergeBase: string
): number | undefined {
  if (!graphCommit) return undefined;
  try {
    return parseInt(git(["rev-list", "--count", `${graphCommit}..${mergeBase}`], repoRoot), 10);
  } catch {
    return undefined; // graph commit not in history (shallow clone etc.) — not a trigger
  }
}
