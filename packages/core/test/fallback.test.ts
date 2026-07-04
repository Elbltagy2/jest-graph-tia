import { checkFallback, globToRegExp, DEFAULT_CONFIG } from "../src/index.js";

const CFG = DEFAULT_CONFIG.fallback;
const OK = { graphOk: true };

describe("checkFallback", () => {
  it("no triggers on ordinary source changes", () => {
    const d = checkFallback(["src/a.ts", "src/b.test.ts"], CFG, OK);
    expect(d.triggered).toBe(false);
    expect(d.reasons).toEqual([]);
  });

  it.each([
    ["package-lock.json"],
    ["yarn.lock"],
    ["sub/dir/pnpm-lock.yaml"],
    ["jest.config.mjs"],
    ["packages/x/jest.config.ts"],
    ["babel.config.js"],
    ["tsconfig.build.json"],
    [".env.production"],
    [".github/workflows/ci.yml"],
  ])("triggers on %s", (f) => {
    expect(checkFallback([f], CFG, OK).triggered).toBe(true);
  });

  it("triggers when graph is missing/unparsable", () => {
    const d = checkFallback(["src/a.ts"], CFG, { graphOk: false });
    expect(d.triggered).toBe(true);
    expect(d.reasons[0]).toMatch(/graph\.json missing/);
  });

  it("triggers on stale graph beyond maxGraphAgeCommits, not below", () => {
    expect(checkFallback(["src/a.ts"], CFG, { ...OK, graphAgeCommits: 51 }).triggered).toBe(true);
    expect(checkFallback(["src/a.ts"], CFG, { ...OK, graphAgeCommits: 50 }).triggered).toBe(false);
  });

  it("triggers on unmapped changed files and on --fallback-full", () => {
    expect(checkFallback(["src/a.ts"], CFG, { ...OK, unmappedChanged: ["src/a.ts"] }).triggered).toBe(true);
    expect(checkFallback([], CFG, { ...OK, forced: true }).triggered).toBe(true);
  });

  it("honors extraGlobs", () => {
    const cfg = { ...CFG, extraGlobs: ["db/migrations/**"] };
    expect(checkFallback(["db/migrations/001.sql"], cfg, OK).triggered).toBe(true);
    expect(checkFallback(["db/seeds/001.sql"], cfg, OK).triggered).toBe(false);
  });
});

describe("globToRegExp", () => {
  it.each([
    ["*.md", "README.md", true],
    ["*.md", "docs/README.md", false],
    ["**/*.sql", "a/b/c.sql", true],
    ["**/*.sql", "c.sql", true],
    ["config/?.json", "config/a.json", true],
    ["config/?.json", "config/ab.json", false],
  ])("%s vs %s → %s", (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
});
