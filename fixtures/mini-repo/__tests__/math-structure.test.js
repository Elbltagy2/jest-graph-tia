// Structural test: reads math.js SOURCE TEXT via fs — no import, invisible to
// jest --findRelatedTests. The directive below is the deterministic fix:
// @tia-covers src/math.js
const { readFileSync } = require("fs");
const { join } = require("path");

test("math.js keeps its exports (source structure)", () => {
  const src = readFileSync(join(__dirname, "../src/math.js"), "utf8");
  expect(src).toContain("exports.add");
  expect(src).toContain("exports.mul");
});
