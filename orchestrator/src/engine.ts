// Workflow engine. A workflow is a graph of nodes joined by edges on named output
// ports (n8n / LangGraph shape). The engine runs one node at a time, follows the
// edge for the port the node returned, and saves the run state after every step,
// so a run can stop (waiting for the owner) and resume later from the same node.
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, type Config } from "./config.ts";
import { Models } from "./models.ts";
import { NODE_TYPES } from "./nodes/index.ts";
import { Router } from "./router.ts";
import { WAIT, type Mode, type Project, type RunResult, type RunState, type Task, type Workflow } from "./types.ts";
import { extractJson, now, ROOT, readJson } from "./util.ts";
import { Vault, type AgentProfile } from "./vault.ts";
import { Workspace } from "./workspace.ts";

export interface NodeCtx {
  engine: Engine;
  s: RunState;
  params: Record<string, unknown>;
  task(): Task;
  log(msg: string, data?: Record<string, unknown>): void;
}

export class Engine extends EventEmitter {
  readonly cfg: Config;
  readonly vault: Vault;
  readonly models: Models;
  readonly router: Router;
  readonly ws: Workspace;
  private aborts = new Set<string>();

  constructor(cfg: Config = loadConfig()) {
    super();
    this.cfg = cfg;
    this.vault = new Vault(cfg.vault);
    this.models = new Models(cfg, this.vault);
    this.router = new Router(cfg, this.models, this.vault);
    this.ws = new Workspace(cfg.worktreeRoot);
  }

  agents(): Record<string, AgentProfile> {
    return this.vault.agents();
  }

  workflow(name: string): Workflow {
    const file = [path.join(this.cfg.vault, "Workflows", `${name}.json`), path.join(ROOT, "workflows", `${name}.json`)].find((f) => fs.existsSync(f));
    if (!file) throw new Error(`no workflow "${name}"`);
    const wf = readJson<Workflow>(file, null as unknown as Workflow);
    const problems = validate(wf);
    if (problems.length) throw new Error(`workflow ${name} is invalid:\n- ${problems.join("\n- ")}`);
    return wf;
  }

  async start(projectName: string, request: string, workflowName = "default"): Promise<RunState> {
    return this.startWith({ project: this.vault.project(projectName), request, workflow: workflowName });
  }

  /** Starts a run with an explicit project and optionally preset tasks (benchmarks, imported plans). */
  async startWith(o: { project: Project; request: string; workflow: string; tasks?: Task[]; id?: string }): Promise<RunState> {
    const { project, request } = o;
    const workflowName = o.workflow;
    const projectName = project.name;
    const wf = this.workflow(workflowName);
    const id = o.id ?? this.vault.newRunId(request);
    const s: RunState = {
      id,
      project,
      request,
      workflow: workflowName,
      status: "running",
      cursor: wf.start,
      visits: {},
      tasks: o.tasks ?? [],
      integrationBranch: `orch/${id}`,
      costUsd: 0,
      createdAt: now(),
      updatedAt: now(),
    };
    this.vault.event(id, "created", { project: projectName, workflow: workflowName });
    this.emit("event", { run: id, type: "created", request });
    return this.loop(s, wf);
  }

  async resume(id: string, input?: { choice: string; note?: string }): Promise<RunState> {
    const s = this.vault.loadState(id);
    if (s.status === "done" || s.status === "aborted") throw new Error(`run ${id} is ${s.status}`);
    const owner = this.vault.runOwner(id);
    if (owner) throw new Error(`run ${id} is executing in process ${owner}`);
    if (s.status === "running") this.vault.event(id, "recover", { node: s.cursor }); // its process died mid-node
    if (s.status === "waiting" && !input) throw new Error(`run ${id} is waiting: ${s.waiting?.question}\noptions: ${s.waiting?.options.join(", ")}`);
    if (input && s.waiting && !s.waiting.options.includes(input.choice)) throw new Error(`choice must be one of: ${s.waiting.options.join(", ")}`);
    s.input = input;
    s.status = "running";
    this.vault.event(id, "resume", { ...input });
    return this.loop(s, this.workflow(s.workflow));
  }

  private async loop(s: RunState, wf: Workflow): Promise<RunState> {
    // the lock says which process executes this run; a stale lock means it crashed
    this.vault.lockRun(s.id);
    try {
      return await this.walk(s, wf);
    } finally {
      this.vault.unlockRun(s.id);
    }
  }

  /** Stops a run: a waiting run at once, a running one when its current node returns. */
  abort(id: string) {
    const owner = this.vault.runOwner(id);
    if (owner === process.pid) {
      this.aborts.add(id);
      return "stopping";
    }
    if (owner) throw new Error(`run ${id} is executing in process ${owner}`);
    const s = this.vault.loadState(id);
    if (s.status === "done" || s.status === "aborted") return s.status;
    s.status = "aborted";
    s.waiting = undefined;
    this.vault.saveState(s);
    this.vault.event(id, "aborted", {});
    this.emit("state", s);
    this.emit("event", { run: id, type: "run:aborted" });
    return "aborted";
  }

  private async walk(s: RunState, wf: Workflow): Promise<RunState> {
    const save = () => {
      this.vault.saveState(s);
      this.emit("state", s);
    };
    save();
    while (s.status === "running") {
      if (this.aborts.delete(s.id)) {
        s.status = "aborted";
        this.vault.event(s.id, "aborted", { node: s.cursor });
        break;
      }
      const node = wf.nodes.find((n) => n.id === s.cursor);
      if (!node) {
        s.status = "failed";
        s.error = `no node ${s.cursor}`;
        break;
      }
      const visits = (s.visits[node.id] = (s.visits[node.id] || 0) + 1);
      if (visits > this.cfg.limits.maxNodeVisits) {
        s.status = "failed";
        s.error = `node ${node.id} visited ${visits} times (loop guard)`;
        break;
      }
      const type = NODE_TYPES[node.type];
      const params = { ...Object.fromEntries(type.params.map((p) => [p.name, p.default])), ...node.params };
      this.emit("event", { run: s.id, type: "node:start", node: node.id, nodeType: node.type, task: s.currentTask });
      this.vault.event(s.id, "node:start", { node: node.id, task: s.currentTask });
      let port: string;
      try {
        port = await type.run({
          engine: this,
          s,
          params,
          task: () => {
            const t = s.tasks.find((x) => x.id === s.currentTask);
            if (!t) throw new Error("no current task");
            return t;
          },
          log: (msg, data = {}) => {
            this.vault.event(s.id, "log", { node: node.id, msg, ...data });
            this.emit("event", { run: s.id, type: "log", node: node.id, msg, ...data });
          },
        });
      } catch (e) {
        s.status = "failed";
        s.error = `${node.id}: ${(e as Error).stack || e}`;
        this.vault.event(s.id, "error", { node: node.id, error: String(e) });
        this.emit("event", { run: s.id, type: "error", node: node.id, error: String(e) });
        break;
      }
      this.vault.event(s.id, "node:end", { node: node.id, port });
      this.emit("event", { run: s.id, type: "node:end", node: node.id, port });
      if (port === WAIT) {
        s.status = "waiting";
        s.visits[node.id]--; // re-entered on resume, not a loop
        break;
      }
      if (s.status !== "running") break; // a node finished or aborted the run
      const edge = wf.edges.find((e) => e.from === node.id && (e.port ?? "out") === port);
      if (!edge) {
        s.status = "done";
        break;
      }
      s.cursor = edge.to;
      save();
    }
    save();
    this.emit("event", { run: s.id, type: "run:" + s.status, waiting: s.waiting, error: s.error });
    return s;
  }

  /* ---------- helpers used by nodes ---------- */

  logFile(s: RunState, name: string) {
    const dir = path.join(this.vault.runDir(s.id), "logs");
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${name}.log`);
  }

  /** Runs one model and books its cost on the run. */
  async runModel(s: RunState, key: string, o: { mode: Mode; prompt: string; cwd: string; timeoutMin: number; logName: string; allowedFiles?: string[]; idle?: boolean }): Promise<RunResult> {
    const adapter = this.models.adapter(key);
    const model = key.slice(key.indexOf(":") + 1);
    const logFile = this.logFile(s, o.logName);
    // short, unique per attempt: shown by tools that take a title, and used to find the agent's processes
    const title = `orch-${createHash("sha1").update(s.id).digest("hex").slice(0, 8)}-${o.logName}`;
    const inWorktree = path.resolve(o.cwd).startsWith(path.resolve(this.cfg.worktreeRoot));
    // every prompt is kept next to its log, so any decision can be audited later
    fs.writeFileSync(logFile.replace(/\.log$/, ".prompt.txt"), o.prompt);
    const res = await adapter.run({
      model,
      mode: o.mode,
      prompt: o.prompt,
      cwd: o.cwd,
      timeoutMs: o.timeoutMin * 60_000,
      // only for providers that stream output; batch CLIs (claude -p --output-format json) are silent until done
      idleMs: o.idle !== false && this.cfg.providers[key.split(":")[0]]?.streamsOutput !== false ? (this.cfg.limits.idleMin ?? 8) * 60_000 : undefined,
      logFile,
      title,
      // the worktree path is in every agent's prompt argv; never use a shared path like the repo
      killMarkers: [title, ...(inWorktree ? [o.cwd.replace(/\\/g, "/")] : [])],
      allowedFiles: o.allowedFiles,
    });
    // only metered API spend counts against the budget; subscription CLIs report an
    // equivalent cost that is never billed per run, so it is tracked separately
    if (this.models.billing(key) === "metered") s.costUsd += res.costUsd;
    else s.usageUsd = (s.usageUsd ?? 0) + res.costUsd;
    if (res.failure) this.models.markFailure(key, res.failure);
    return res;
  }

  /** Asks the senior model (with fallbacks) for a JSON answer. Read-only, in the project repo. */
  async senior<T>(s: RunState, kind: string, prompt: string): Promise<{ data: T; key: string; text: string }> {
    const keys = [this.cfg.senior.model, ...this.cfg.senior.fallback];
    let lastErr = "";
    for (const key of keys) {
      if (this.models.coolingDown(key)) continue;
      for (let i = 0; i < 2; i++) {
        const res = await this.runModel(s, key, {
          mode: "readonly",
          prompt: i ? `${prompt}\n\nYour last answer was not valid JSON. Return only the JSON object.` : prompt,
          cwd: s.project.repo,
          timeoutMin: this.cfg.senior.timeoutMin,
          idle: false,
          logName: `senior-${kind}-${Date.now()}`,
        });
        if (res.failure) {
          lastErr = `${key}: ${res.failure}`;
          break;
        }
        const data = extractJson<T>(res.text);
        if (data) return { data, key, text: res.text };
        lastErr = `${key}: no JSON in answer`;
      }
    }
    throw new Error(`senior model unavailable (${lastErr})`);
  }
}

export function validate(wf: Workflow): string[] {
  const out: string[] = [];
  const ids = new Set(wf.nodes.map((n) => n.id));
  if (!ids.has(wf.start)) out.push(`start node ${wf.start} missing`);
  for (const n of wf.nodes) if (!NODE_TYPES[n.type]) out.push(`node ${n.id}: unknown type ${n.type}`);
  for (const e of wf.edges) {
    if (!ids.has(e.from)) out.push(`edge from unknown node ${e.from}`);
    if (!ids.has(e.to)) out.push(`edge to unknown node ${e.to}`);
    const n = wf.nodes.find((x) => x.id === e.from);
    const t = n && NODE_TYPES[n.type];
    if (t && !t.ports.includes(e.port ?? "out")) out.push(`edge ${e.from}.${e.port ?? "out"}: ${n!.type} has ports ${t.ports.join(", ")}`);
  }
  return out;
}
