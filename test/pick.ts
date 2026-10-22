// pickReady: dependency handling without running anything.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickReady, ownFollowUps } from "../src/nodes/flow.ts";
import type { RunState, Task } from "../src/types.ts";
import { git, shell } from "../src/util.ts";

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

// a GIT_DIR leaked from an agent shell must not break the engine's git
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-git-env-"));
git(tmp, "init", "-q");
process.env.GIT_DIR = "/nonexistent";
assert.equal(git(tmp, "rev-parse", "--git-dir").ok, true, "git ignores a leaked GIT_DIR");
delete process.env.GIT_DIR;
fs.rmSync(tmp, { recursive: true, force: true });

// a leaked GIT_DIR must not break shell() commands, but an explicit env must still win
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "orch-shell-env-"));
git(tmp2, "init", "-q");
process.env.GIT_DIR = "/nonexistent";
const r1 = await shell("git rev-parse --git-dir", { cwd: tmp2, timeoutMs: 30_000 });
assert.equal(r1.code, 0, "shell ignores a leaked GIT_DIR");
const r2 = await shell("echo $GIT_DIR", { cwd: tmp2, timeoutMs: 30_000, env: { GIT_DIR: "/x" } });
assert.equal(r2.out.trim(), "/x", "an explicit env wins over the filter");
delete process.env.GIT_DIR;
fs.rmSync(tmp2, { recursive: true, force: true });

assert.deepEqual(ownFollowUps(["owned by task t4", "`t4` sets the script", "t40 is fine", "add a cache"], ["t4"]), ["t40 is fine", "add a cache"]);

console.log("pick PASS");
