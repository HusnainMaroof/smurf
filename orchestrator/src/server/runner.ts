// smurf runner: the execution plane on the host. It dials out to smurf-server, answers its
// calls with the Engine (runs, worktrees, checks, agent CLIs with the host's logins) and the
// vault, and streams every run's UI state back. Nothing listens on the host.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runBenchmarks } from "../bench.ts";
import { Engine, validate } from "../engine.ts";
import { NODE_TYPES } from "../nodes/index.ts";
import { CATEGORIES, type Category, type Mode, type RunState, type Workflow } from "../types.ts";
import { stripAnsi } from "../adapters/common.ts";
import { git, ROOT, readJson, writeJson } from "../util.ts";
import { parseDiff, project, type UiState } from "./projection.ts";

type Params = Record<string, any>;

export class Runner {
  readonly engine: Engine;
  private logs = new Map<string, string[]>();
  private send: (msg: unknown) => void = () => {};

  constructor(engine = new Engine()) {
    this.engine = engine;
    engine.on("event", (e: { run: string; type: string; msg?: string; node?: string; port?: string; error?: string }) => {
      const line = e.type === "log" ? `[${e.node}] ${e.msg}` : e.type === "node:end" ? `[${e.node}] -> ${e.port}` : e.type === "error" ? `[${e.node}] ERROR ${e.error}` : e.type.startsWith("run:") ? `run ${e.type.slice(4)}` : "";
      if (!line) return;
      const l = this.logs.get(e.run) ?? [];
      l.push(`${new Date().toTimeString().slice(0, 8)} ${line}`);
      this.logs.set(e.run, l.slice(-500));
      this.send({ type: "event", event: { kind: "log", run: e.run, line: l[l.length - 1] } });
    });
    engine.on("state", (s: RunState) => this.send({ type: "event", event: { kind: "state", run: s.id, state: this.ui(s) } }));
  }

  ui(s: RunState): UiState {
    return project(s, this.engine.vault.runDir(s.id), this.logs.get(s.id) ?? []);
  }

  private repo(projectName: string) {
    return this.engine.vault.project(projectName).repo;
  }
  /** Resolves a path inside a project's repo; refuses anything outside it. */
  private inRepo(projectName: string, rel = "") {
    const root = path.resolve(this.repo(projectName));
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error("path outside the project");
    return { root, abs };
  }

  /** Every method the server may call. */
  readonly methods: Record<string, (p: Params) => unknown> = {
    hello: () => ({ host: os.hostname(), platform: process.platform, root: ROOT }),
    projects: () =>
      fs.readdirSync(this.engine.vault.p("Projects")).filter((f) => f.endsWith(".md")).map((f) => {
        const p = this.engine.vault.project(f.replace(/\.md$/, ""));
        return { id: p.name, name: p.name, workspace_path: p.repo, baseBranch: p.baseBranch, allowedCommands: p.allowedCommands };
      }),
    initProject: ({ path: repoPath, name, allow, link }: Params) => {
      const repo = path.resolve(String(repoPath || ""));
      if (!fs.existsSync(repo)) throw new Error(`no folder ${repo}`);
      if (!git(repo, "rev-parse", "--git-dir").ok) throw new Error(`${repo} is not a git repository`);
      const n = String(name || path.basename(repo)).replace(/[^\w.-]+/g, "-");
      const split = (v: unknown) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
      this.engine.vault.saveProject({
        name: n,
        repo: repo.replace(/\\/g, "/"),
        baseBranch: git(repo, "rev-parse", "--abbrev-ref", "HEAD").out || "main",
        allowedCommands: split(allow),
        linkDirs: split(link),
        context: `# ${n}\n\nWrite here what the senior model should know: stack, conventions, how to test, what not to touch.`,
      });
      return { id: n, name: n, workspace_path: repo.replace(/\\/g, "/") };
    },
    seniors: async () => {
      const { models } = await this.engine.models.list();
      const def = [this.engine.cfg.senior.model, ...this.engine.cfg.senior.fallback];
      // planning needs a capable model: strong and premium tiers, read-only mode
      const options = models
        .filter((m) => (m.tier === "strong" || m.tier === "premium") && m.modes.includes("readonly"))
        .map((m) => ({ key: m.key, tier: m.tier, billing: this.engine.models.billing(m.key), cooling: !!this.engine.models.coolingDown(m.key) }));
      return { default: def, options };
    },
    start: ({ id, project: name, request, workflow, senior }: Params) => {
      const proj = this.engine.vault.project(String(name));
      // runs take minutes to hours: answer now, stream progress as events
      this.engine.startWith({ project: proj, request: String(request), workflow: String(workflow || "default"), id: String(id), senior: Array.isArray(senior) ? senior.map(String) : senior ? [String(senior)] : undefined }).catch((e) => this.failed(String(id), e));
      return { status: "started" };
    },
    resume: ({ id, choice, note }: Params) => {
      this.engine.resume(String(id), choice ? { choice: String(choice), note: note ? String(note) : undefined } : undefined).catch((e) => this.failed(String(id), e));
      return { status: "resumed" };
    },
    abort: ({ id }: Params) => ({ status: this.engine.abort(String(id)) }),
    state: ({ id }: Params) => {
      try {
        return this.ui(this.engine.vault.loadState(String(id)));
      } catch {
        return null;
      }
    },
    runAgents: ({ id }: Params) => {
      try {
        return { agents: runAgents(this.engine.vault.loadState(String(id)), path.join(this.engine.vault.runDir(String(id)), "logs")) };
      } catch {
        return { agents: [] };
      }
    },
    diff: ({ id, name }: Params) => {
      // a worker attempt's changes as the engine recorded them (Runs/<id>/<task>-a<n>.diff)
      if (!/^[\w.-]+$/.test(String(name))) throw new Error("bad agent id");
      const file = path.join(this.engine.vault.runDir(String(id)), `${name}.diff`);
      if (!fs.existsSync(file)) return { diff: "", files: [] };
      const diff = fs.readFileSync(file, "utf8").slice(0, 400_000);
      return { diff, files: parseDiff(diff).map((f) => ({ path: f.path, status: f.status })) };
    },
    log: ({ id, name, offset }: Params) => {
      if (!/^[\w.-]+$/.test(String(name))) throw new Error("bad log name");
      const file = path.join(this.engine.vault.runDir(String(id)), "logs", `${name}.log`);
      if (!fs.existsSync(file)) return { text: "", offset: 0, size: 0 };
      const size = fs.statSync(file).size;
      // a terminal that polls: send what is new since `offset`, at most the last 64 KB
      let from = Math.max(0, Math.min(Number(offset) || 0, size));
      if (size - from > 65_536) from = size - 65_536;
      const fd = fs.openSync(file, "r");
      const buf = Buffer.alloc(size - from);
      fs.readSync(fd, buf, 0, buf.length, from);
      fs.closeSync(fd);
      return { text: stripAnsi(buf.toString("utf8")), offset: size, size, skipped: from > (Number(offset) || 0) ? from - (Number(offset) || 0) : 0 };
    },
    runs: () =>
      this.engine.vault.runs().map((s) => ({ run_id: s.id, title: s.request.slice(0, 80), status: s.status, workspace_id: s.project.name, workflow: s.workflow, created_at: s.createdAt, updated_at: s.updatedAt, tasks: s.tasks.length, accepted: s.tasks.filter((t) => t.status === "accepted").length })),
    tree: ({ project: name, path: rel }: Params) => {
      const { root, abs } = this.inRepo(String(name), String(rel || ""));
      const skip = new Set([".git", "node_modules", ".venv", "graphify-out"]);
      const entries = fs.readdirSync(abs, { withFileTypes: true }).filter((d) => !skip.has(d.name)).map((d) => ({ name: d.name, path: path.relative(root, path.join(abs, d.name)).replace(/\\/g, "/"), type: d.isDirectory() ? "dir" : "file" }));
      entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
      return { root: root.replace(/\\/g, "/"), entries };
    },
    file: ({ project: name, path: rel }: Params) => {
      const { abs } = this.inRepo(String(name), String(rel || ""));
      const max = 400_000;
      const buf = fs.readFileSync(abs);
      return { path: rel, content: buf.subarray(0, max).toString("utf8"), truncated: buf.length > max };
    },
    changes: ({ project: name }: Params) => {
      const repo = this.repo(String(name));
      const files = parseDiff(git(repo, "diff", "HEAD", "--no-color").out);
      const untracked = git(repo, "ls-files", "--others", "--exclude-standard").out.split("\n").filter(Boolean).slice(0, 200);
      return {
        files: [
          ...files.map((f) => ({ name: f.path, status: f.status, diffs: f.diffs ?? [] })),
          ...untracked.map((f) => ({ name: f, status: "A", diffs: [] })),
        ],
      };
    },
    git: ({ project: name }: Params) => {
      const repo = this.repo(String(name));
      const isRepo = git(repo, "rev-parse", "--git-dir").ok;
      return {
        is_repo: isRepo,
        branch: isRepo ? git(repo, "rev-parse", "--abbrev-ref", "HEAD").out : "",
        integration_branches: isRepo ? git(repo, "branch", "--list", "orch/*", "--format=%(refname:short)").out.split("\n").filter(Boolean) : [],
      };
    },
    nodes: () => Object.values(NODE_TYPES).map(({ run: _run, ...n }) => n),
    workflows: () => this.workflowFiles().map((f) => ({ id: path.basename(f, ".json"), ...readJson<Workflow>(f, null as unknown as Workflow), file: f })),
    workflow: ({ id }: Params) => this.engine.workflow(String(id)),
    saveWorkflow: ({ id, graph }: Params) => {
      const wf = graph as Workflow;
      const problems = validate(wf);
      if (problems.length) return { status: "invalid", problems };
      // user edits live in the vault and override the built-in graphs of the same name
      writeJson(this.engine.vault.p("Workflows", `${String(id).replace(/[^\w.-]+/g, "-")}.json`), wf);
      return { status: "saved", problems: [] };
    },
    models: async ({ refresh }: Params) => {
      const reg = await this.engine.models.list(!!refresh);
      return { refreshed: reg.refreshed, skipped: reg.skipped, models: reg.models.map((m) => ({ ...m, cooling: this.engine.models.coolingDown(m.key) || undefined, billing: this.engine.models.billing(m.key) })) };
    },
    route: async ({ category, mode }: Params) => {
      const cat = (CATEGORIES as readonly string[]).includes(String(category)) ? (category as Category) : "coding";
      const p = this.engine.agents()[cat];
      return this.engine.router.rank({ category: cat, mode: (mode as Mode) || p?.mode || "edit", risk: "medium", minTier: p?.minTier ?? "light", exclude: [], contextNeeded: 20_000, budgetUsd: this.engine.cfg.budget.perTaskUsd, escalated: false });
    },
    agents: () => Object.values(this.engine.agents()).map(({ body, ...a }) => ({ id: a.category, ...a, description: body.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? "" })),
    benchmarks: () => {
      const dir = this.engine.vault.p("Benchmarks");
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().reverse().slice(0, 30).map((f) => {
        const n = this.engine.vault.read(`Benchmarks/${f}`)!;
        const rows = [...n.body.matchAll(/^\| ([\w-]+) \| (\w+) \| \[\[[^|]+\|([^\]]+)\]\] \| (PASS|FAIL) \| (\d+) \|/gm)].map((r) => ({ task: r[1], category: r[2], model: r[3], pass: r[4] === "PASS", sec: Number(r[5]) }));
        return { id: f.replace(/\.md$/, ""), date: String(n.data.date ?? ""), passed: rows.filter((r) => r.pass).length, total: rows.length, rows };
      });
    },
    bench: (p: Params) => {
      const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : undefined);
      runBenchmarks(
        this.engine,
        { random: Number(p.random || 3), tasks: list(p.tasks), perTask: Number(p.perTask || 2), models: list(p.models), adapters: list(p.adapters), parallel: Number(p.parallel || 3), seed: Date.now() % 100000, premium: false, timeoutMin: Number(p.timeoutMin || 12) },
        (line) => this.send({ type: "event", event: { kind: "bench", line } }),
      )
        .then((rows) => this.send({ type: "event", event: { kind: "bench_done", passed: rows.filter((r) => r.pass).length, total: rows.length } }))
        .catch((e) => this.send({ type: "event", event: { kind: "bench", line: `error: ${e}` } }));
      return { status: "started" };
    },
  };

  private workflowFiles() {
    const files = new Map<string, string>();
    for (const dir of [path.join(ROOT, "workflows"), this.engine.vault.p("Workflows")])
      if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) files.set(f, path.join(dir, f));
    return [...files.values()];
  }

  private failed(id: string, e: unknown) {
    const line = `run error: ${(e as Error).message || e}`;
    this.send({ type: "event", event: { kind: "log", run: id, line } });
    try {
      this.send({ type: "event", event: { kind: "state", run: id, state: this.ui(this.engine.vault.loadState(id)) } });
    } catch {
      /* the run never started */
    }
  }

  async handle(msg: { type: string; id?: number; method?: string; params?: Params }) {
    if (msg.type !== "call" || !msg.method) return;
    const fn = this.methods[msg.method];
    try {
      if (!fn) throw new Error(`unknown method ${msg.method}`);
      this.send({ type: "result", id: msg.id, ok: true, data: (await fn(msg.params ?? {})) ?? null });
    } catch (e) {
      this.send({ type: "result", id: msg.id, ok: false, error: (e as Error).message || String(e) });
    }
  }

  /** Keeps a connection to the server, reconnecting with backoff. Returns only when a newer runner replaced this one. */
  async connect(url: string, token: string, log = (s: string) => console.log(s)) {
    let delay = 1000;
    for (;;) {
      const code = await new Promise<number>((done) => {
        const ws = new WebSocket(`${url.replace(/\/$/, "")}/runner?token=${encodeURIComponent(token)}`);
        ws.onopen = () => {
          delay = 1000;
          this.send = (m) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
          this.send({ type: "hello", ...(this.methods.hello({}) as object), version: 1 });
          log(`runner connected to ${url}`);
        };
        ws.onmessage = (ev) => {
          try {
            void this.handle(JSON.parse(String(ev.data)));
          } catch {
            /* ignore malformed */
          }
        };
        ws.onclose = (ev) => {
          this.send = () => {};
          done(ev.code);
        };
        ws.onerror = () => {};
      });
      // 4000 = the server switched to a newer runner; reconnecting would just kick that one off again
      if (code === 4000) {
        log("another runner connected to this server; stopping this one");
        return;
      }
      log(`runner disconnected; retrying in ${delay / 1000}s`);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30_000);
    }
  }
}

export interface RunAgent {
  id: string; // log name: GET /api/runs/:id/logs/:id
  kind: "senior" | "worker" | "review";
  node: string; // workflow node type the agent belongs to (the canvas links it there)
  task?: string;
  title: string;
  model: string;
  attempt?: number;
  status: string;
  startedAt: string;
  live: boolean; // its log grew in the last 15 s while the run is running
}

const SENIOR_NODE: Record<string, string> = { understand: "senior.understand", plan: "senior.plan", confirm: "senior.decide" };

/** Every agent the run launched (senior calls, worker attempts, reviews), oldest first, from the state and the log files. */
export function runAgents(s: RunState, logDir: string): RunAgent[] {
  const logs = fs.existsSync(logDir) ? fs.readdirSync(logDir).filter((f) => f.endsWith(".log")).map((f) => f.slice(0, -4)) : [];
  const mtime = (name: string) => {
    try {
      return fs.statSync(path.join(logDir, `${name}.log`)).mtimeMs;
    } catch {
      return 0;
    }
  };
  const live = (name: string) => s.status === "running" && Date.now() - mtime(name) < 15_000;
  const has = new Set(logs);
  const out: RunAgent[] = [];
  for (const name of logs) {
    const m = name.match(/^senior-(\w+)-(\d+)$/);
    if (!m) continue;
    const head = fs.readFileSync(path.join(logDir, `${name}.log`), "utf8").slice(0, 600);
    const model = head.match(/(?:-m|--model)\s+'?([^\s']+)/)?.[1] ?? "senior";
    out.push({ id: name, kind: "senior", node: SENIOR_NODE[m[1]] ?? "senior.plan", title: `Senior: ${m[1]}`, model, status: live(name) ? "running" : "done", startedAt: new Date(Number(m[2])).toISOString(), live: live(name) });
  }
  for (const t of s.tasks) {
    for (const a of t.attempts) {
      const worker = `${t.id}-a${a.n}`;
      const last = a === t.attempts[t.attempts.length - 1];
      const running = last && !a.decision && !a.failure && s.status === "running" && t.status === "running";
      if (has.has(worker))
        out.push({
          id: worker, kind: "worker", node: "agent.delegate", task: t.id, title: `${t.id} #${a.n}: ${t.title}`, model: a.model, attempt: a.n,
          status: a.failure ? `failed (${a.failure})` : last && t.status === "accepted" && a.decision !== "accept" ? "accept (owner)" : a.decision ?? (running ? (a.evidence ? "checked" : "running") : "done"),
          startedAt: a.startedAt, live: live(worker),
        });
      const review = `${worker}-review`;
      if (has.has(review))
        out.push({
          id: review, kind: "review", node: "agent.review", task: t.id, title: `Review ${t.id} #${a.n}`, model: a.review?.model ?? "reviewer", attempt: a.n,
          status: a.review ? `score ${a.review.score}` : running ? "running" : "no review", startedAt: new Date(mtime(review) || Date.parse(a.startedAt)).toISOString(), live: live(review),
        });
    }
  }
  return out.sort((x, y) => x.startedAt.localeCompare(y.startedAt));
}
