const { price } = require("../src/pricing");

test("price applies tax rate then discount from rules.json", () => {
  expect(price(100)).toBeCloseTo(108);
});
