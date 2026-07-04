/**
 * End-to-end: fixture repo copied to a temp dir, git history simulated,
 * CLI run as a real subprocess. Requires `npm run build` first (uses dist/).
 */
import { cpSync, mkdtempSync, rmSync, symlinkSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "../../..");
const CLI = join(ROOT, "packages/cli/dist/main.js");
const FIXTURE = join(ROOT, "fixtures/mini-repo");

function sh(cwd: string, cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8" });
}

function runCliCmd(cwd: string, command: string, args: string[]) {
  const r = spawnSync("node", [CLI, command, "--changed-since", "main", "--no-update-graph", ...args], {
    cwd,
    encoding: "utf8",
  });
  return { status: r.status ?? -1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
const runCli = (cwd: string, args: string[]) => runCliCmd(cwd, "run", args);

describe("jest-graph-tia e2e on the fixture repo", () => {
  let repo: string;

  beforeAll(() => {
    expect(existsSync(CLI)).toBe(true); // run `npm run build` before tests
    repo = join(mkdtempSync(join(tmpdir(), "jgt-e2e-")), "repo");
    cpSync(FIXTURE, repo, { recursive: true });
    symlinkSync(join(ROOT, "node_modules"), join(repo, "node_modules"));
    sh(repo, "git", ["init", "-q"]);
    sh(repo, "git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "seed"]);
    sh(repo, "git", ["add", "-A"]);
    sh(repo, "git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
    sh(repo, "git", ["branch", "-m", "main"]);
    sh(repo, "git", ["checkout", "-qb", "feature"]);
  });

  afterAll(() => {
    if (repo) rmSync(dirname(repo), { recursive: true, force: true });
  });

  it("selects the pricing test when only rules.json changes (jest alone finds nothing)", () => {
    sh(repo, "bash", ["-c", `sed -i '' 's/"discount": 2/"discount": 3/' src/rules.json || sed -i 's/"discount": 2/"discount": 3/' src/rules.json`]);
    const r = runCli(repo, ["--dry-run", "--explain"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("jest baseline 0");
    expect(r.out).toContain("pricing.test.js");
    expect(r.out).toContain("INFERRED");
    expect(r.out).toContain("rules.json → pricing.js");
    expect(r.out).not.toContain("calc.test.js");
  });

  it("propagates jest's failure exit code, then success after fixing the test", () => {
    const fail = runCli(repo, []);
    expect(fail.status).toBe(1); // discount changed → pricing expectation now wrong
    sh(repo, "bash", ["-c", `sed -i '' 's/toBeCloseTo(108)/toBeCloseTo(107)/' __tests__/pricing.test.js || sed -i 's/toBeCloseTo(108)/toBeCloseTo(107)/' __tests__/pricing.test.js`]);
    const pass = runCli(repo, []);
    expect(pass.status).toBe(0);
    expect(pass.out).toContain("pricing.test.js");
  });

  it("@tia-covers: fs-read structure test selected when its target changes", () => {
    sh(repo, "bash", ["-c", `printf '\\n// touched\\n' >> src/math.js && git -c user.email=t@t -c user.name=t commit -qam "touch math"`]);
    const r = runCli(repo, ["--dry-run", "--explain"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("@tia-covers: injected");
    expect(r.out).toContain("math-structure.test.js");
    // structure test has no import of math.js — only the directive links them
    const structRow = r.out.split("\n").find((l) => l.includes("math-structure.test.js") && !l.includes("$"));
    expect(structRow).toContain("graphify");
    // calc.test still arrives via jest's own static chain
    expect(r.out).toContain("calc.test.js");
  });

  it("--summary-md writes a PR-ready selection summary", () => {
    const md = join(dirname(repo), "summary.md");
    const r = runCli(repo, ["--dry-run", "--summary-md", md]);
    expect(r.status).toBe(0);
    const body = readFileSync(md, "utf8");
    expect(body).toContain("jest-graph-tia — test selection");
    expect(body).toMatch(/\*\*\d+ \/ \d+\*\* tests selected/);
  });

  it("verify: escape when a failing test isn't selected (exit 1), caught once directive added (exit 0)", () => {
    // baseline WITHOUT the directive must live on main — otherwise the directive
    // edit itself shows up as a changed file and the test self-selects
    sh(repo, "bash", ["-c", `git checkout -q main && (sed -i '' '/@tia-covers/d' __tests__/math-structure.test.js 2>/dev/null || sed -i '/@tia-covers/d' __tests__/math-structure.test.js) && git -c user.email=t@t -c user.name=t commit -qam "main without directive"`]);
    // PR branch: break math.js in the way the fs-read structure test asserts on
    sh(repo, "bash", ["-c", `git checkout -qb escape-pr && (sed -i '' '/exports.mul/d' src/math.js 2>/dev/null || sed -i '/exports.mul/d' src/math.js) && git -c user.email=t@t -c user.name=t commit -qam "drop mul export"`]);

    const escaped = runCliCmd(repo, "verify", []);
    expect(escaped.status).toBe(1);
    expect(escaped.out).toContain("ESCAPES: 1");
    expect(escaped.out).toContain("math-structure.test.js");

    // dev adds the directive in the PR → the same failure is now caught
    sh(repo, "bash", ["-c", `(sed -i '' '3i\\
// @tia-covers src/math.js
' __tests__/math-structure.test.js 2>/dev/null || sed -i '3i // @tia-covers src/math.js' __tests__/math-structure.test.js) && git -c user.email=t@t -c user.name=t commit -qam "add directive"`]);
    const caught = runCliCmd(repo, "verify", []);
    expect(caught.status).toBe(0);
    expect(caught.out).toContain("ESCAPES: 0");

    // restore state for the remaining tests
    sh(repo, "bash", ["-c", `git checkout -q feature`]);
  });

  it("falls back to the full suite when a lockfile changes", () => {
    sh(repo, "bash", ["-c", "echo '{}' > package-lock.json && git add package-lock.json"]);
    const r = runCli(repo, ["--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("FALLBACK → full suite");
    expect(r.out).toContain("lockfile changed");
    expect(r.out).toContain("calc.test.js");
    expect(r.out).toContain("listener.test.js");
    expect(r.out).toContain("pricing.test.js");
    sh(repo, "bash", ["-c", "git rm -q --cached package-lock.json && rm package-lock.json"]);
  });
});
