// Semantic coupling: listens for "price.updated" but NEVER imports events.js —
// the bus instance is injected at runtime. Jest's static graph cannot connect
// listener.js to events.js; the knowledge graph links them via the event name.
exports.attach = (bus, log) => {
  bus.on("price.updated", (p) => log.push(`price is now ${p}`));
};
