/** Jest invocations. Jest is a peer expectation of the TARGET repo, never bundled. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run, runInherit } from "./proc.js";

function jestCmd(repoRoot: string): { cmd: string; prefix: string[] } {
  const local = join(repoRoot, "node_modules", ".bin", "jest");
  if (existsSync(local)) return { cmd: local, prefix: [] };
  return { cmd: "npx", prefix: ["--no", "jest"] }; // fail rather than silently install
}

function parseListTests(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("/"));
}

/** `jest --findRelatedTests <files> --listTests` → absolute test paths. */
export function findRelatedTests(repoRoot: string, files: readonly string[]): string[] {
  if (files.length === 0) return [];
  const { cmd, prefix } = jestCmd(repoRoot);
  // jest exits non-zero when nothing matches; stdout is still the answer
  const r = run(cmd, [...prefix, "--findRelatedTests", ...files, "--listTests"], repoRoot);
  return parseListTests(r.stdout);
}

/** Full suite via `jest --listTests`. */
export function listAllTests(repoRoot: string): string[] {
  const { cmd, prefix } = jestCmd(repoRoot);
  const r = run(cmd, [...prefix, "--listTests"], repoRoot);
  return parseListTests(r.stdout);
}

/** Execute jest on exactly these test paths (or full suite when paths is undefined). */
export function runJest(
  repoRoot: string,
  testPaths: readonly string[] | undefined,
  extraArgs: readonly string[]
): number {
  const { cmd, prefix } = jestCmd(repoRoot);
  const args =
    testPaths === undefined
      ? [...prefix, ...extraArgs]
      : [...prefix, "--runTestsByPath", ...testPaths, ...extraArgs];
  return runInherit(cmd, args, repoRoot);
}
