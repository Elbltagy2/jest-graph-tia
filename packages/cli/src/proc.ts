/** Process helpers — ALL spawning for git/graphify/jest lives in the cli package. */
import { execFileSync, spawnSync } from "node:child_process";

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run a command, capture output, never throw on non-zero exit. */
export function run(cmd: string, args: string[], cwd: string): RunResult {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Run a command with stdio inherited (for the final jest execution). Returns exit code. */
export function runInherit(cmd: string, args: string[], cwd: string): number {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

/** git helper that throws on failure (git failures are fatal misconfig). */
export function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
