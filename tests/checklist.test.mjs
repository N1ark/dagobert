import assert from "node:assert/strict";
import { tasks, taskProgress, toggleTask } from "../src/lib/checklist.ts";

const body = "# Groceries\n\n- [ ] milk\n- [x] eggs\n  * [X] nested\n1. [ ] numbered\n- plain item\n- [ ] \n-[ ] no space";
assert.deepEqual(tasks(body), [
  { line: 2, text: "milk", done: false },
  { line: 3, text: "eggs", done: true },
  { line: 4, text: "nested", done: true },
  { line: 5, text: "numbered", done: false },
]);
assert.deepEqual(taskProgress(body), { done: 2, total: 4 });

// Fenced code is skipped, with the same fence rules as the block splitter.
const fenced = "- [ ] a\n```md\n- [ ] in code\n~~~\n- [x] still code\n```\n~~~~\n- [ ] tilde\n~~~~\n- [x] b";
assert.deepEqual(
  tasks(fenced).map((t) => t.text),
  ["a", "b"],
);
assert.deepEqual(taskProgress(fenced), { done: 1, total: 2 });

// The empty item a new checklist starts with doesn't count.
assert.deepEqual(taskProgress("- [ ] "), { done: 0, total: 0 });
assert.deepEqual(taskProgress(""), { done: 0, total: 0 });
assert.deepEqual(taskProgress("[x] not a list"), { done: 0, total: 0 });
assert.equal(tasks("- [x]text").length, 0);

assert.equal(toggleTask(body, 2), body.replace("- [ ] milk", "- [x] milk"));
assert.equal(toggleTask(body, 4), body.replace("* [X] nested", "* [ ] nested"));
assert.equal(toggleTask(toggleTask(body, 5), 5), body);
assert.equal(toggleTask(body, 0), body, "not a task line");
assert.equal(toggleTask(body, 99), body);
assert.equal(toggleTask("- [ ] a [ ] b", 0), "- [x] a [ ] b");

console.log("checklist ok");
