// Smurf end to end with the mock provider: smurf-server + runner + engine, driven the way
// the desktop app drives them (HTTP + WebSocket). No tokens spent.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { Engine } from "../src/engine.ts";
import { Runner } from "../src/server/runner.ts";
import { SmurfServer } from "../src/server/server.ts";
import { git, writeJson } from "../src/util.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smurf-e2e-"));
const repo = path.join(tmp, "repo");
fs.mkdirSync(repo);
fs.writeFileSync(path.join(repo, "math.js"), "exports.add = (a, b) => a - b;\n");
fs.writeFileSync(path.join(repo, "test.js"), "const { add } = require('./math');\nif (add(2, 3) !== 5) process.exit(1);\nconsole.log('ok');\n");
git(repo, "init", "-q", "-b", "main");
git(repo, "add", ".");
git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");

const script = path.join(tmp, "mock.json");
writeJson(script, {
  models: [{ model: "senior", tier: "premium" }, { model: "coder", tier: "strong" }, { model: "rev", tier: "strong" }],
  understand: { goal: "Fix add()", constraints: [], successCriteria: ["node test.js passes"], assumptions: [], questions: [] },
  plan: { tasks: [{ id: "fix", title: "Fix add", category: "coding", risk: "high", brief: "Fix add().", files: ["math.js"], deps: [], checks: [{ name: "tests", cmd: "node test.js" }] }] },
  edits: { coder: [{ file: "math.js", find: "a - b", replace: "a + b" }], rev: [] },
  review: { score: 95, verdict: "correct", findings: [] },
});
process.env.ORCH_MOCK_SCRIPT = script;

const base = loadConfig();
const providers = Object.fromEntries(Object.keys(base.providers).map((k) => [k, { enabled: k === "mock" }]));
const cfg = loadConfig({
  vault: path.join(tmp, "vault"),
  worktreeRoot: path.join(tmp, "wt"),
  senior: { model: "mock:not-a-model", fallback: [], timeoutMin: 1 }, // only the session's pick can work
  router: { ...base.router, premium: "never" },
  providers: providers as any,
});
fs.cpSync(path.join(base.vault, "Agents"), path.join(cfg.vault, "Agents"), { recursive: true });

const token = "test-token";
const port = 47900 + Math.floor(Math.random() * 90);
const server = new SmurfServer({ port, host: "127.0.0.1", token, dataDir: path.join(tmp, "data"), log: () => {} });
await server.listen();
const http = `http://127.0.0.1:${port}`;
const api = async (method: string, p: string, body?: unknown, tok = token) => {
  const r = await fetch(http + p, { method, headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { code: r.status, body: await r.json() };
};

// without a runner the API says so; auth is enforced
assert.equal((await api("GET", "/api/workspaces")).code, 503);
assert.equal((await api("GET", "/api/workspaces", undefined, "wrong")).code, 401);
assert.equal((await fetch(`${http}/health`).then((r) => r.json())).runner.connected, false);

const runner = new Runner(new Engine(cfg));
void runner.connect(`ws://127.0.0.1:${port}`, token, () => {});
for (let i = 0; i < 50 && !(await fetch(`${http}/health`).then((r) => r.json())).runner.connected; i++) await new Promise((r) => setTimeout(r, 100));

const ws = await api("POST", "/api/workspaces", { path: repo, name: "demo", allow: "node " });
assert.equal(ws.code, 200, JSON.stringify(ws.body));
assert.equal((await api("GET", "/api/workspaces")).body.active_id, "demo");
const tree = (await api("GET", "/api/workspace/tree")).body;
assert.deepEqual(tree.entries.map((e: any) => e.name).sort(), ["math.js", "test.js"]);
assert.equal((await api("GET", "/api/workspace/file?path=../../etc/passwd")).code, 400, "no path escape");
assert.ok((await api("GET", "/api/nodes")).body.some((n: any) => n.type === "senior.plan"));
assert.ok((await api("GET", "/api/workflows/user")).body.workflows.some((w: any) => w.id === "default"));
assert.ok((await api("GET", "/api/models")).body.models.some((m: any) => m.key === "mock:coder"));

const seniors = (await api("GET", "/api/seniors")).body;
assert.deepEqual(seniors.default, ["mock:not-a-model"]);
assert.ok(seniors.options.some((o: any) => o.key === "mock:senior"), JSON.stringify(seniors));
const { run_id } = (await api("POST", "/api/sessions", { workspace_id: "demo" })).body;
assert.deepEqual((await api("PUT", `/api/sessions/${run_id}/senior`, { senior: "mock:senior" })).body.senior, ["mock:senior"]);
const states: any[] = [];
const events: string[] = [];
const sock = new WebSocket(`ws://127.0.0.1:${port}/ws/runs/${run_id}?token=${token}`);
const waitFor = (pred: (s: any) => boolean, ms = 60_000) =>
  new Promise<any>((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const s = states.findLast(pred);
      if (s) return resolve(s);
      if (Date.now() - t0 > ms) return reject(new Error(`timeout; last status ${states.at(-1)?.status}, events ${events.join(",")}`));
      setTimeout(tick, 100);
    };
    tick();
  });
sock.onmessage = (e) => {
  const env = JSON.parse(String(e.data));
  events.push(env.event);
  if (env.event === "state_patch") states.push(env.data.patch);
};
await new Promise((r) => (sock.onopen = r));
await waitFor((s) => s.status === "idle");

sock.send(JSON.stringify({ text: "add() returns wrong numbers" }));
const gate = await waitFor((s) => s.status === "awaiting_human");
assert.equal(gate.waiting.kind, "approval", "high-risk plan waits for the owner");
assert.equal(gate.messages.find((m: any) => m.planCard)?.planCard.status, "pending");
assert.ok(events.includes("human_required"));

sock.send(JSON.stringify({ action: "human_decision", decision: "approve" }));
const done = await waitFor((s) => s.status === "passed" || s.status === "failed");
assert.equal(done.status, "passed", done.error);
assert.deepEqual(done.senior, ["mock:senior"], "the session's senior ran the run");
const attempt = done.messages.find((m: any) => m.verificationReport);
assert.equal(attempt.verificationReport.conclusion, "passed");
assert.deepEqual(attempt.filesChanged, ["math.js"]);
assert.ok(attempt.diffSummary.files[0].diffs.some((d: any) => d.type === "addition" && d.text.includes("a + b")));
assert.ok(done.messages.some((m: any) => m.id === "report"));
assert.ok(done.terminal_logs.length > 0);
assert.ok(events.includes("run_completed"));

const hist = (await api("GET", "/api/runs/history?workspace_id=demo")).body.sessions;
assert.equal(hist[0].run_id, run_id);
assert.equal((await api("GET", `/api/runs/${run_id}/state`)).body.status, "passed");
assert.match(git(repo, "show", `orch/${run_id}:math.js`).out, /a \+ b/);

// agents the run launched, linked to workflow nodes, each with a readable terminal log
const agents = (await api("GET", `/api/runs/${run_id}/agents`)).body.agents;
const worker = agents.find((a: any) => a.kind === "worker" && a.status === "accept");
assert.ok(worker && worker.node === "agent.delegate" && worker.model === "mock:coder", JSON.stringify(agents));
assert.ok(agents.some((a: any) => a.kind === "senior" && a.node === "senior.plan"), "senior calls are agents too");
const log = (await api("GET", `/api/runs/${run_id}/logs/${worker.id}`)).body;
assert.ok(log.size > 0 && log.text.includes("mock coder"), JSON.stringify(log));
assert.equal((await api("GET", `/api/runs/${run_id}/logs/${worker.id}?offset=${log.offset}`)).body.text, "", "polling from the end returns nothing new");
assert.equal((await api("GET", `/api/runs/${run_id}/logs/..%2F..%2Fstate`)).code, 404, "no path escape");
const changes = (await api("GET", `/api/runs/${run_id}/agents/${worker.id}/diff`)).body;
assert.deepEqual(changes.files.map((f: any) => f.path), ["math.js"], JSON.stringify(changes).slice(0, 300));
assert.ok(changes.diff.includes("a + b"));

sock.close();
server.close();
console.log(`smurf e2e PASS (run ${run_id})`);
process.exit(0);
