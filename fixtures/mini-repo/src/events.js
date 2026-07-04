const { EventEmitter } = require("events");
exports.bus = new EventEmitter();
// contract: emits "price.updated" with the new price
exports.publishPrice = (p) => exports.bus.emit("price.updated", p);
