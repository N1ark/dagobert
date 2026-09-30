import assert from "node:assert/strict";
import { parseQuery } from "../src/lib/query.ts";
assert.deepEqual(parseQuery("#backend sch"), { text: "sch", tag: "backend" });
assert.deepEqual(parseQuery("plain"), { text: "plain", tag: null });
assert.deepEqual(parseQuery("  #Api"), { text: "", tag: "api" });
console.log("query ok");
