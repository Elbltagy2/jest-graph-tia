const path = require("path");
// DYNAMIC require with a computed path — invisible to jest --findRelatedTests.
// Only the knowledge graph knows pricing.js depends on rules.json.
const rulesFile = ["rules", "json"].join(".");
const rules = require(path.join(__dirname, rulesFile));
exports.price = (base) => base * (1 + rules.taxRate) - rules.discount;
