import type { Tier } from "./graphSchema.js";

export interface TraversalConfig {
  /** max hops allowed for a path whose weakest tier is the key; 0 = never follow that tier */
  extracted: number;
  inferred: number;
  ambiguous: number;
}

export interface FallbackConfig {
  maxGraphAgeCommits: number;
  extraGlobs: string[];
}

export interface TiaConfig {
  graphPath: string;
  traversal: TraversalConfig;
  fallback: FallbackConfig;
  includeNonJs: boolean;
  updateGraph: boolean;
  jestArgs: string[];
}

export const DEFAULT_CONFIG: TiaConfig = {
  graphPath: "graphify-out/graph.json",
  traversal: { extracted: 6, inferred: 2, ambiguous: 0 },
  fallback: { maxGraphAgeCommits: 50, extraGlobs: [] },
  includeNonJs: false,
  updateGraph: true,
  jestArgs: [],
};

/** Shallow-per-section merge of a partial user config over defaults. */
export function resolveConfig(user: unknown): TiaConfig {
  if (user === null || typeof user !== "object") return structuredClone(DEFAULT_CONFIG);
  const u = user as Partial<Record<keyof TiaConfig, unknown>>;
  const cfg = structuredClone(DEFAULT_CONFIG);
  if (typeof u.graphPath === "string") cfg.graphPath = u.graphPath;
  if (typeof u.includeNonJs === "boolean") cfg.includeNonJs = u.includeNonJs;
  if (typeof u.updateGraph === "boolean") cfg.updateGraph = u.updateGraph;
  if (Array.isArray(u.jestArgs)) cfg.jestArgs = u.jestArgs.filter((a): a is string => typeof a === "string");
  if (u.traversal !== null && typeof u.traversal === "object") {
    const t = u.traversal as Record<string, unknown>;
    for (const k of ["extracted", "inferred", "ambiguous"] as const) {
      const v = t[k];
      if (typeof v === "number" && Number.isInteger(v) && v >= 0) cfg.traversal[k] = v;
    }
  }
  if (u.fallback !== null && typeof u.fallback === "object") {
    const f = u.fallback as Record<string, unknown>;
    if (typeof f["maxGraphAgeCommits"] === "number") cfg.fallback.maxGraphAgeCommits = f["maxGraphAgeCommits"] as number;
    if (Array.isArray(f["extraGlobs"])) {
      cfg.fallback.extraGlobs = (f["extraGlobs"] as unknown[]).filter((g): g is string => typeof g === "string");
    }
  }
  return cfg;
}

export function budgetForTier(cfg: TraversalConfig, tier: Tier): number {
  switch (tier) {
    case "EXTRACTED":
      return cfg.extracted;
    case "INFERRED":
      return cfg.inferred;
    case "AMBIGUOUS":
      return cfg.ambiguous;
  }
}
