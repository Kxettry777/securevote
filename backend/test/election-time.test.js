const { test } = require("node:test");
const assert = require("node:assert/strict");

test("countdown handles start/end boundaries, days, subsecond rounding, and elapsed time", async () => {
  const { electionPhase, countdownParts } = await import("../../frontend/src/electionTime.ts");
  const starts = "2030-01-01T00:00:00.000Z", ends = "2030-01-03T01:02:03.000Z";
  const start = Date.parse(starts), end = Date.parse(ends);
  assert.equal(electionPhase(starts, ends, start - 1), "upcoming");
  assert.equal(electionPhase(starts, ends, start), "active");
  assert.equal(electionPhase(starts, ends, end - 1), "active");
  assert.equal(electionPhase(starts, ends, end), "ended");
  assert.deepEqual(countdownParts(ends, start), { days: 2, hours: 1, minutes: 2, seconds: 3 });
  assert.deepEqual(countdownParts(ends, end - 1), { days: 0, hours: 0, minutes: 0, seconds: 1 });
  assert.deepEqual(countdownParts(ends, end + 10000), { days: 0, hours: 0, minutes: 0, seconds: 0 });
});
