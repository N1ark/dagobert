import assert from "node:assert/strict";
import { addDays, dayKey, daysBetween, dueState, groupByDay, isLater, joinDue, moveDue, parseDue } from "../src/lib/calendar.ts";

assert.deepEqual(parseDue("2026-10-05"), { date: "2026-10-05", time: null });
assert.deepEqual(parseDue("2026-10-05T09:30"), { date: "2026-10-05", time: "09:30" });
for (const bad of [
  null,
  undefined,
  "",
  "2026-02-30",
  "2026-13-01",
  "2026-10-05T24:00",
  "2026-10-05T10:60",
  "5 Oct",
  "2026-10-05T09:30:00Z",
])
  assert.equal(parseDue(bad), null, String(bad));

assert.equal(joinDue("2026-10-05", null), "2026-10-05");
assert.equal(joinDue("2026-10-05", "08:00"), "2026-10-05T08:00");
assert.equal(moveDue("2026-10-05T08:00", "2026-10-09"), "2026-10-09T08:00");
assert.equal(moveDue("2026-10-05", "2026-10-09"), "2026-10-09");

assert.equal(dayKey(new Date(2026, 0, 3)), "2026-01-03");
assert.equal(addDays("2026-12-30", 3), "2027-01-02");
assert.equal(addDays("2026-03-01", -1), "2026-02-28");
assert.equal(daysBetween("2026-03-28", "2026-04-02"), 5);
assert.equal(daysBetween("2026-10-05", "2026-10-01"), -4);

const now = new Date(2026, 9, 5, 14, 0);
assert.equal(dueState("2026-10-04", false, now), "overdue");
assert.equal(dueState("2026-10-05", false, now), "today");
assert.equal(dueState("2026-10-05T13:59", false, now), "overdue");
assert.equal(dueState("2026-10-05T14:00", false, now), "overdue");
assert.equal(dueState("2026-10-05T14:01", false, now), "today");
assert.equal(dueState("2026-10-12", false, now), "soon");
assert.equal(dueState("2026-10-13", false, now), null);
assert.equal(dueState("2026-10-01", true, now), null, "done is never late");
assert.equal(dueState(null, false, now), null);

assert.equal(isLater("2026-10-06", "2026-10-05T23:00"), true);
assert.equal(isLater("2026-10-05T10:00", "2026-10-05T09:00"), true);
assert.equal(isLater("2026-10-05", "2026-10-05T09:00"), false, "same day, all-day fits");
assert.equal(isLater("2026-10-04", "2026-10-05"), false);
assert.equal(isLater("nope", "2026-10-05"), false);

const items = [
  { id: "a", due: "2026-10-06T09:00" },
  { id: "b", due: null },
  { id: "c", due: "2026-10-05" },
  { id: "d", due: "2026-10-06" },
  { id: "e", due: "garbage" },
];
const days = groupByDay(items, (i) => i.due);
assert.deepEqual([...days.keys()], ["2026-10-05", "2026-10-06"]);
assert.deepEqual(
  days.get("2026-10-06").map((i) => i.id),
  ["d", "a"],
  "all-day before timed",
);

console.log("calendar: ok");
