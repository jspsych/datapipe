// Chakra UI v3 uses structuredClone which jest-environment-jsdom may not expose.
if (typeof structuredClone === "undefined") {
  const v8 = require("v8");
  global.structuredClone = (val) => v8.deserialize(v8.serialize(val));
}
