const { calc } = require("../src/calc");

test("calc doubles then adds one", () => {
  expect(calc(2)).toBe(5);
});
