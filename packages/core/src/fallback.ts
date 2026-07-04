/**
 * Fallback-to-full-suite triggers (SPEC §4). Pure: pattern-matching over
 * changed file paths + facts the CLI hands in. No I/O here.
 */
import type { FallbackConfig } from "./config.js";

export interface FallbackFacts {
  /** graph.json existed and parsed */
  graphOk: boolean;
  /** commits between graph's build commit and merge-base; undefined = unknown (not a trigger) */
  graphAgeCommits?: number;
  /** changed files that resolved to zero graph nodes (from ExpansionResult) */
  unmappedChanged?: readonly string[];
  /** user passed --fallback-full */
  forced?: boolean;
}

export interface FallbackDecision {
  triggered: boolean;
  reasons: string[];
}

const LOCKFILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);
const CONFIG_FILE = /(^|\/)(jest\.config\.[^/]+|babel\.config\.[^/]+|\.babelrc[^/]*|tsconfig[^/]*\.json)$/;
const ENV_FILE = /(^|\/)\.env[^/]*$/;
const CI_WORKFLOW = /^\.github\/workflows\//;

/** Minimal glob → RegExp: supports `**`, `*`, `?`. Enough for config extraGlobs. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++; // `**/` also matches zero directories
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

export function checkFallback(
  changedFiles: readonly string[],
  cfg: FallbackConfig,
  facts: FallbackFacts
): FallbackDecision {
  const reasons: string[] = [];

  if (facts.forced) reasons.push("--fallback-full was passed");
  if (!facts.graphOk) reasons.push("graph.json missing or unparsable");
  if (
    facts.graphAgeCommits !== undefined &&
    facts.graphAgeCommits > cfg.maxGraphAgeCommits
  ) {
    reasons.push(
      `graph.json is ${facts.graphAgeCommits} commits behind merge-base (max ${cfg.maxGraphAgeCommits})`
    );
  }
  for (const f of facts.unmappedChanged ?? []) {
    reasons.push(`changed file has zero nodes in the graph: ${f}`);
  }

  const extra = cfg.extraGlobs.map((g) => ({ glob: g, re: globToRegExp(g) }));
  for (const f of changedFiles) {
    const base = f.split("/").pop() ?? f;
    if (LOCKFILES.has(base)) reasons.push(`lockfile changed: ${f}`);
    else if (CONFIG_FILE.test(f)) reasons.push(`build/test config changed: ${f}`);
    else if (ENV_FILE.test(f)) reasons.push(`.env file changed: ${f}`);
    else if (CI_WORKFLOW.test(f)) reasons.push(`CI workflow changed: ${f}`);
    else {
      const m = extra.find((e) => e.re.test(f));
      if (m) reasons.push(`extraGlob '${m.glob}' matched: ${f}`);
    }
  }

  return { triggered: reasons.length > 0, reasons };
}
