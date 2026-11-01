import assert from "node:assert/strict";
import { untouched } from "../src/lib/workflows.ts";

assert.ok(untouched("", ""));
assert.ok(untouched(" \n\n​ ", ""));
assert.ok(!untouched("a", ""));
assert.ok(untouched("## Notes\n\n- [ ] ", "## Notes\n\n\n- [ ] \n"));
assert.ok(!untouched("## Notes\n\n- [ ] x", "## Notes\n\n- [ ] "));
assert.ok(untouched("Created 2024-01-31", "Created {{date}}"));
assert.ok(untouched("Created 2024-01-31", "Created {{ date }}"));
assert.ok(!untouched("Created yesterday", "Created {{date}}"));
assert.ok(untouched("# Plan", "# {{title}}", "Plan"));
assert.ok(untouched("#", "# {{title}}", "Plan"));
assert.ok(!untouched("# Other", "# {{title}}", "Plan"));
assert.ok(untouched("# a.b (c)", "# {{title}}", "a.b (c)"));
assert.ok(!untouched("# aXb", "# {{title}}", "a.b"));
console.log("workflows ok");
