const { add, mul } = require("./math");
// plain static require chain — Jest's own graph sees this
exports.calc = (x) => add(mul(x, 2), 1);
