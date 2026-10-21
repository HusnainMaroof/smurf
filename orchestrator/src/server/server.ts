// smurf-server: the control plane (runs in Docker). HTTP + WebSocket API for the Smurf
// desktop app; forwards work to the host runner over /runner and relays its events.
// Contract: docs/SMURF.md.
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { emptyState, type UiState } from "./projection.ts";
import { accept, type Socket } from "./ws.ts";

export interface ServerOptions {
  port: number;
  host: string;
  token: string;
  dataDir: string;
  log?: (s: string) => void;
}

interface Session {
  run_id: string;
  workspace_id: string;
  title: string;
  created_at: string;
  started: boolean;
  senior?: string[];
}

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
};

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let n = 0;
    const parts: Buffer[] = [];
    req.on("data", (d: Buffer) => {
      n += d.length;
      if (n > 5_000_000) reject(new Error("body too large"));
      else parts.push(d);
    });
    req.on("end", () => {
      const t = Buffer.concat(parts).toString("utf8");
      try {
        resolve(t ? JSON.parse(t) : {});
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

class HttpError extends Error {
  code: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.code = code;
  }
}

/** A model key or list of keys from a request; undefined when empty. */
function toList(v: unknown): string[] | undefined {
  const l = (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);
  return l.length ? l : undefined;
}

export function newRunId() {
  const d = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `s-${d}-${randomBytes(3).toString("hex")}`;
}

export class SmurfServer {
  private o: ServerOptions;
  private runner: { sock: Socket; info: Record<string, unknown>; since: string } | null = null;
  private calls = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private nextId = 1;
  private clients = new Map<string, Set<Socket>>(); // run id -> UI sockets
  private eventClients = new Set<Socket>(); // /ws/events: benchmarks, runner status
  private states = new Map<string, UiState>();
  private sessions: Record<string, Session>;
  private prefs: Record<string, unknown>;
  private active: string | null;
  readonly http: http.Server;

  constructor(o: ServerOptions) {
    this.o = o;
    fs.mkdirSync(o.dataDir, { recursive: true });
    this.sessions = this.load("sessions.json", {});
    this.prefs = this.load("preferences.json", { theme: "pristine-light", language: "en", onboarding_completed: "false" });
    this.active = this.load<{ id: string | null }>("active.json", { id: null }).id;
    this.http = http.createServer((req, res) => void this.route(req, res));
    this.http.on("upgrade", (req, sock) => this.upgrade(req, sock));
  }

  private load<T>(f: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.o.dataDir, f), "utf8"));
    } catch {
      return fallback;
    }
  }
  private save(f: string, v: unknown) {
    const file = path.join(this.o.dataDir, f);
    fs.writeFileSync(file + ".tmp", JSON.stringify(v, null, 2));
    fs.renameSync(file + ".tmp", file);
  }
  private log(s: string) {
    (this.o.log ?? console.log)(`${new Date().toISOString().slice(11, 19)} ${s}`);
  }

  listen(): Promise<void> {
    return new Promise((r) => this.http.listen(this.o.port, this.o.host, () => r()));
  }
  close() {
    this.runner?.sock.close();
    for (const set of this.clients.values()) for (const c of set) c.close();
    for (const c of this.eventClients) c.close();
    this.http.close();
  }

  private authorized(req: http.IncomingMessage, url: URL) {
    const given = (req.headers.authorization?.replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "").trim();
    const a = Buffer.from(given);
    const b = Buffer.from(this.o.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /* ---------- runner RPC ---------- */
  call<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<T> {
    if (!this.runner) return Promise.reject(new HttpError(503, "the Smurf runner is not connected (start it on the host: smurf-runner)"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new HttpError(504, `runner timed out on ${method}`));
      }, timeoutMs);
      this.calls.set(id, { resolve, reject, timer });
      this.runner!.sock.send({ type: "call", id, method, params });
    });
  }

  private onRunner(msg: any) {
    if (msg?.type === "hello") {
      if (this.runner) this.runner.info = msg;
      this.broadcastEvents({ event: "runner", data: { connected: true, host: msg.host } });
    } else if (msg?.type === "result") {
      const c = this.calls.get(msg.id);
      if (!c) return;
      clearTimeout(c.timer);
      this.calls.delete(msg.id);
      if (msg.ok) c.resolve(msg.data);
      else c.reject(new HttpError(400, msg.error));
    } else if (msg?.type === "event") {
      const e = msg.event;
      if (e.kind === "state") {
        const prev = this.states.get(e.run);
        this.states.set(e.run, e.state);
        this.toRun(e.run, { event: "state_patch", data: { run_id: e.run, timestamp: new Date().toISOString(), patch: e.state } });
        if (e.state.status === "awaiting_human" && prev?.status !== "awaiting_human") this.toRun(e.run, { event: "human_required", data: { run_id: e.run, ...(e.state.waiting ?? {}) } });
        if (["passed", "failed"].includes(e.state.status) && prev?.status !== e.state.status) this.toRun(e.run, { event: "run_completed", data: { run_id: e.run, status: e.state.status } });
      } else if (e.kind === "log") {
        const st = this.states.get(e.run);
        if (st) st.terminal_logs = [...st.terminal_logs, e.line].slice(-500);
        this.toRun(e.run, { event: "log", data: { run_id: e.run, message: e.line } });
      } else {
        this.broadcastEvents({ event: e.kind, data: e });
      }
    }
  }

  private toRun(run: string, env: unknown) {
    for (const c of this.clients.get(run) ?? []) c.send(env);
  }
  private broadcastEvents(env: unknown) {
    for (const c of this.eventClients) c.send(env);
  }

  /* ---------- WebSockets ---------- */
  private upgrade(req: http.IncomingMessage, sock: import("node:stream").Duplex) {
    const url = new URL(req.url || "/", "http://x");
    if (!this.authorized(req, url)) {
      sock.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    if (url.pathname === "/runner") {
      const ws = accept(req, sock);
      if (!ws) return;
      if (this.runner) this.runner.sock.close(4000); // newest runner wins
      const me = { sock: ws, info: {}, since: new Date().toISOString() };
      this.runner = me;
      this.log("runner connected");
      ws.on("message", (m) => this.onRunner(m));
      ws.on("close", () => {
        if (this.runner !== me) return;
        this.runner = null;
        for (const [id, c] of this.calls) {
          clearTimeout(c.timer);
          c.reject(new HttpError(503, "runner disconnected"));
          this.calls.delete(id);
        }
        this.log("runner disconnected");
        this.broadcastEvents({ event: "runner", data: { connected: false } });
      });
      return;
    }
    if (url.pathname === "/ws/events") {
      const ws = accept(req, sock);
      if (!ws) return;
      this.eventClients.add(ws);
      ws.send({ event: "runner", data: { connected: !!this.runner } });
      ws.on("close", () => this.eventClients.delete(ws));
      return;
    }
    const m = url.pathname.match(/^\/ws\/runs\/([\w.-]+)$/);
    if (!m) {
      sock.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    const run = m[1];
    const ws = accept(req, sock);
    if (!ws) return;
    const set = this.clients.get(run) ?? new Set();
    set.add(ws);
    this.clients.set(run, set);
    ws.on("close", () => set.delete(ws));
    ws.on("message", (msg) => void this.onClient(run, ws, msg));
    void this.stateOf(run).then((st) => ws.send({ event: "state_patch", data: { run_id: run, timestamp: new Date().toISOString(), patch: st } }));
  }

  private async stateOf(run: string): Promise<UiState> {
    const cached = this.states.get(run);
    if (cached) return cached;
    const st = (await this.call<UiState | null>("state", { id: run }).catch(() => null)) ?? emptyState(run);
    if (st.status !== "idle") this.states.set(run, st);
    return st;
  }

  private async onClient(run: string, ws: Socket, msg: any) {
    const fail = (e: unknown) => ws.send({ event: "log", data: { run_id: run, message: `error: ${(e as Error).message || e}` } });
    try {
      if (msg && typeof msg.text === "string" && !msg.action) return await this.chat(run, msg.text.trim(), msg.workflow_id, msg.senior ?? msg.model_id);
      if (msg?.action === "human_decision") return await this.decide(run, String(msg.decision || ""), msg.instructions ?? msg.note);
      if (msg?.action === "stop_run") return void (await this.call("abort", { id: run }));
    } catch (e) {
      fail(e);
    }
  }

  /** First message starts the run; later ones answer the senior's questions. */
  private async chat(run: string, text: string, workflow?: string, seniorPick?: string | string[]) {
    if (!text) return;
    const s = this.sessions[run];
    const st = await this.stateOf(run);
    if (!s?.started && st.status === "idle") {
      const workspace = s?.workspace_id || this.active;
      if (!workspace) throw new Error("choose a workspace (project) first");
      const senior = toList(seniorPick) ?? s?.senior;
      this.sessions[run] = { run_id: run, workspace_id: workspace, title: text.slice(0, 80), created_at: s?.created_at ?? new Date().toISOString(), started: true, senior };
      this.save("sessions.json", this.sessions);
      const pending = { ...emptyState(run), status: "running" as const, current_instruction: text, messages: [{ id: "request", agent: "User", avatar: "", time: "", text }] };
      this.states.set(run, pending);
      this.toRun(run, { event: "state_patch", data: { run_id: run, timestamp: new Date().toISOString(), patch: pending } });
      await this.call("start", { id: run, project: workspace, request: text, workflow: workflow || "default", senior });
      return;
    }
    if (st.waiting?.kind === "question") return void (await this.call("resume", { id: run, choice: "answer", note: text }));
    if (st.waiting) return void (await this.call("resume", { id: run, choice: st.waiting.options.includes("retry") ? "retry" : st.waiting.options[0], note: text }));
    throw new Error(st.status === "running" ? "the team is working; wait for a question or a decision point" : "this run has finished; start a new chat");
  }

  /** Maps the UI's buttons onto the run's actual options. */
  private async decide(run: string, decision: string, note?: string) {
    const st = await this.stateOf(run);
    const opts = st.waiting?.options ?? [];
    if (!opts.length) throw new Error("this run is not waiting for a decision");
    const alias: Record<string, string[]> = { approve: ["approve", "accept"], reject: ["reject", "abort"], retry: ["retry"], allow: ["approve", "accept"] };
    const choice = (alias[decision] ?? [decision]).find((c) => opts.includes(c));
    if (!choice) throw new Error(`"${decision}" is not an option here: ${opts.join(", ")}`);
    await this.call("resume", { id: run, choice, note });
  }

  /* ---------- HTTP ---------- */
  private async route(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || "/", "http://x");
    const p = url.pathname;
    const q = (k: string) => url.searchParams.get(k) ?? undefined;
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE" });
      return res.end();
    }
    try {
      if (p === "/health") return json(res, 200, { status: "ok", api_version: "smurf-1", runner: { connected: !!this.runner, host: this.runner?.info.host, since: this.runner?.since } });
      if (!this.authorized(req, url)) return json(res, 401, { detail: "unauthorized" });
      const body = req.method === "POST" || req.method === "PUT" || req.method === "PATCH" ? await readBody(req) : {};
      const r = await this.api(req.method || "GET", p, q, body);
      return json(res, 200, r);
    } catch (e) {
      const code = e instanceof HttpError ? e.code : 500;
      return json(res, code, { detail: (e as Error).message || String(e) });
    }
  }

  private ws(q: (k: string) => string | undefined) {
    const id = q("workspace_id") || this.active;
    if (!id) throw new HttpError(400, "no workspace selected");
    return id;
  }

  private async api(method: string, p: string, q: (k: string) => string | undefined, body: any): Promise<unknown> {
    const M = (m: string, re: RegExp) => (method === m ? p.match(re) : null);
    let m: RegExpMatchArray | null;

    if (M("GET", /^\/api\/workspaces$/)) {
      const list = await this.call<any[]>("projects");
      if (this.active && !list.some((w) => w.id === this.active)) this.active = null;
      return { workspaces: list, active_id: this.active };
    }
    if (M("POST", /^\/api\/workspaces$/)) {
      const w = await this.call("initProject", body);
      this.active = (w as any).id;
      this.save("active.json", { id: this.active });
      return w;
    }
    if ((m = M("POST", /^\/api\/workspaces\/([\w.-]+)\/activate$/))) {
      const w = (await this.call<any[]>("projects")).find((x) => x.id === m![1]);
      if (!w) throw new HttpError(404, `no workspace ${m[1]}`);
      this.active = w.id;
      this.save("active.json", { id: this.active });
      return { ...w, active_id: this.active };
    }
    if (M("GET", /^\/api\/workspace\/tree$/)) return this.call("tree", { project: this.ws(q), path: q("path") ?? "" });
    if (M("GET", /^\/api\/workspace\/file$/)) return this.call("file", { project: this.ws(q), path: q("path") ?? "" });
    if (M("GET", /^\/api\/workspace\/changes$/)) return this.call("changes", { project: this.ws(q) });
    if (M("GET", /^\/api\/workspace\/git$/)) return this.call("git", { project: this.ws(q) });

    if (M("GET", /^\/api\/runs\/history$/)) {
      const runs = await this.call<any[]>("runs").catch(() => []);
      const byId = new Map(runs.map((r) => [r.run_id, r]));
      for (const s of Object.values(this.sessions)) if (!byId.has(s.run_id)) byId.set(s.run_id, { run_id: s.run_id, title: s.title || "New session", status: "idle", workspace_id: s.workspace_id, created_at: s.created_at, updated_at: s.created_at });
      const ws = q("workspace_id");
      const sessions = [...byId.values()].filter((r) => !ws || r.workspace_id === ws).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      return { sessions };
    }
    if (M("POST", /^\/api\/sessions$/)) {
      const run_id = newRunId();
      this.sessions[run_id] = { run_id, workspace_id: body.workspace_id || this.active || "", title: body.title || "", created_at: new Date().toISOString(), started: false, senior: toList(body.senior) };
      this.save("sessions.json", this.sessions);
      return { run_id };
    }
    if ((m = M("GET", /^\/api\/runs\/([\w.-]+)\/state$/))) return this.stateOf(m[1]);
    if ((m = M("GET", /^\/api\/runs\/([\w.-]+)\/agents$/))) return this.call("runAgents", { id: m[1] });
    if ((m = M("GET", /^\/api\/runs\/([\w.-]+)\/agents\/([\w.-]+)\/diff$/))) return this.call("diff", { id: m[1], name: m[2] });
    if ((m = M("GET", /^\/api\/runs\/([\w.-]+)\/logs\/([\w.-]+)$/))) return this.call("log", { id: m[1], name: m[2], offset: Number(q("offset") || 0) });
    if ((m = M("DELETE", /^\/api\/runs\/([\w.-]+)$/))) {
      delete this.sessions[m[1]];
      this.states.delete(m[1]);
      this.save("sessions.json", this.sessions);
      return { status: "deleted" };
    }

    if (M("GET", /^\/api\/workflows\/user$/)) return { workflows: await this.call("workflows") };
    if ((m = M("GET", /^\/api\/workflows\/user\/([\w.-]+)$/))) return { graph: await this.call("workflow", { id: m[1] }) };
    if ((m = M("PUT", /^\/api\/workflows\/user\/([\w.-]+)$/))) return this.call("saveWorkflow", { id: m[1], graph: body.graph });
    if (M("GET", /^\/api\/nodes$/)) return this.call("nodes");
    if (M("GET", /^\/api\/seniors$/)) return this.call("seniors", {}, 600_000);
    if ((m = M("PUT", /^\/api\/sessions\/([\w.-]+)\/senior$/))) {
      const s = this.sessions[m[1]];
      if (!s) throw new HttpError(404, `no session ${m[1]}`);
      if (s.started) throw new HttpError(409, "the run has started; the senior is fixed for this session");
      s.senior = toList(body.senior);
      this.save("sessions.json", this.sessions);
      return { senior: s.senior ?? null };
    }
    if (M("GET", /^\/api\/models$/)) return this.call("models", { refresh: q("refresh") === "1" }, 600_000);
    if (M("GET", /^\/api\/route$/)) return this.call("route", { category: q("category"), mode: q("mode") }, 600_000);
    if (M("GET", /^\/api\/agents$/)) return this.call("agents");
    if (M("GET", /^\/api\/benchmarks$/)) return this.call("benchmarks");
    if (M("POST", /^\/api\/benchmarks$/)) return this.call("bench", body);

    if (M("GET", /^\/api\/preferences$/)) return this.prefs;
    if ((m = M("GET", /^\/api\/preferences\/([\w-]+)$/))) {
      const k = m[1].replace(/-/g, "_");
      return { [k]: this.prefs[k] ?? null, value: this.prefs[k] ?? null };
    }
    // Clutch features Smurf does not have: empty, not 404, so the UI renders "none"
    if (method === "GET" && /^\/api\/(skills|scheduled-tasks|shell-snapshots|repository-groups)$/.test(p)) return [];
    if ((m = M("POST", /^\/api\/preferences\/([\w-]+)$/))) {
      this.prefs[m[1].replace(/-/g, "_")] = body.value ?? body[m[1]] ?? true;
      this.save("preferences.json", this.prefs);
      return { status: "saved" };
    }
    throw new HttpError(404, `no route ${method} ${p}`);
  }
}

/** Token from SMURF_TOKEN, else `<dataDir>/token` (created on first start). */
export function loadToken(dataDir: string) {
  if (process.env.SMURF_TOKEN) return process.env.SMURF_TOKEN.trim();
  const f = path.join(dataDir, "token");
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
  fs.mkdirSync(dataDir, { recursive: true });
  const t = randomBytes(24).toString("hex");
  fs.writeFileSync(f, t, { mode: 0o600 });
  return t;
}
