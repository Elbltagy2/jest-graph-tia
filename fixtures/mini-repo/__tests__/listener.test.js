const { bus, publishPrice } = require("../src/events");
const { attach } = require("../src/listener");

test("listener reacts to price.updated", () => {
  const log = [];
  attach(bus, log);
  publishPrice(42);
  expect(log).toEqual(["price is now 42"]);
});
