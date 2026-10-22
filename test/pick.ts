// pickReady: dependency handling without running anything.
import assert from "node:assert/strict";
import { pickReady } from "../src/nodes/flow.ts";
import type { RunState, Task } from "../src/types.ts";

const task = (id: string, deps: string[] = [], status: Task["status"] = "pending"): Task => ({
  id, title: id, category: "coding", risk: "low", brief: "", files: [], deps, checks: [], status, attempts: [], excluded: [], reassigns: 0,
});
const run = (tasks: Task[]) => ({ tasks }) as unknown as RunState;
const logs: string[] = [];
const log = (m: string) => logs.push(m);

// ready task with accepted deps is picked
let s = run([task("a", [], "accepted"), task("b", ["a"])]);
assert.equal(pickReady(s, () => true, log)?.id, "b");

// a cycle (c <-> d) with nothing running: both are skipped instead of hanging
s = run([task("c", ["d"]), task("d", ["c"])]);
assert.equal(pickReady(s, () => true, log), undefined);
assert.deepEqual(s.tasks.map((t) => t.status), ["skipped", "skipped"]);
assert.ok(logs.some((l) => l.includes("can never be accepted")));

// while another task is still running, waiting tasks are left alone
s = run([task("e", [], "running"), task("f", ["e"])]);
assert.equal(pickReady(s, () => true, log), undefined);
assert.equal(s.tasks[1].status, "pending");

console.log("pick PASS");
