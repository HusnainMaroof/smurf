// Team nodes: route a task to a model, prepare its workspace, delegate, gather
// evidence, get an independent review, and integrate accepted work.
import fs from "node:fs";
import path from "node:path";
import type { NodeType } from "./index.ts";
import type { NodeCtx } from "../engine.ts";
import { reviewPrompt, workerPrompt } from "../prompts.ts";
import type { Attempt, Evidence, Review, Task } from "../types.ts";
import { extractJson, now, shell, tail } from "../util.ts";

function profileOf(ctx: NodeCtx, t: Task) {
  const p = ctx.engine.agents()[t.category];
  if (!p) throw new Error(`no agent profile for category ${t.category} (vault/Agents)`);
  return p;
}

/** Rough token need: allowed files that exist + prompt overhead. */
function contextNeeded(t: Task) {
  const bytes = t.files.reduce((a, f) => {
    try {
      return a + fs.statSync(path.join(t.worktree || "", f)).size;
    } catch {
      return a;
    }
  }, 0);
  return Math.round(bytes / 3.5) + 12_000;
}

function lastNumber(out: string): number | undefined {
  const m = out.match(/-?\d+(?:\.\d+)?/g);
  return m ? Number(m[m.length - 1]) : undefined;
}

async function runCheck(cwd: string, cmd: string) {
  const r = await shell(cmd, { cwd, timeoutMs: 15 * 60_000 });
  return { code: r.timedOut ? null : r.code, out: r.out };
}

export const agentNodes: NodeType[] = [
  {
    type: "router.select",
    label: "Select model",
    group: "agent",
    description: "Ranks live models for the task (own benchmarks, correctness, tool compatibility, context, latency, cost) after filtering by mode, tier, cooldown and budget.",
    ports: ["ok", "none"],
    params: [{ name: "top", type: "number", default: 5, description: "Candidates kept on the task." }],
    async run(ctx) {
      const { engine, s, params, task, log } = ctx;
      const t = task();
      const p = profileOf(ctx, t);
      const L = engine.cfg.limits;
      if (t.forceModel) {
        t.candidates = [{ key: t.forceModel, score: 1, why: "forced (benchmark)" }];
        return "ok";
      }
      const req = {
        category: t.category,
        mode: p.mode,
        risk: t.risk,
        minTier: t.minTier ?? p.minTier,
        exclude: t.excluded,
        contextNeeded: contextNeeded(t),
        budgetUsd: Math.min(engine.cfg.budget.perTaskUsd, engine.cfg.budget.perRunUsd - s.costUsd),
        escalated: t.risk === "high" || t.reassigns >= L.reassignsBeforeTierUp,
      };
      let { candidates, dropped } = await engine.router.rank(req);
      if (!candidates.length && t.minTier && t.minTier !== p.minTier) {
        // nothing stronger is left: fall back to the profile's tier rather than stall
        log(`no model at tier ${t.minTier} for ${t.id}; falling back to ${p.minTier}`);
        ({ candidates, dropped } = await engine.router.rank({ ...req, minTier: p.minTier }));
      }
      // a free quota already in use by a parallel task would rate-limit both: those models go last (order kept otherwise)
      const ordered = [...candidates.filter((c) => !engine.quotaBusy(c.key)), ...candidates.filter((c) => engine.quotaBusy(c.key))];
      t.candidates = ordered.slice(0, Number(params.top)).map(({ key, score, why }) => ({ key, score, why }));
      log(`route ${t.id} (${t.category}): ${t.candidates.map((c) => `${c.key}=${c.score}`).join(", ") || "none"}`, { dropped });
      if (!t.candidates.length) {
        t.approvalReason = `no model fits (${Object.entries(dropped).map(([k, v]) => `${v} ${k}`).join(", ") || "no models discovered"})`;
        return "none";
      }
      return "ok";
    },
  },
  {
    type: "workspace.prepare",
    label: "Prepare workspace",
    group: "workspace",
    description: "Creates the run's integration branch and an isolated git worktree + branch for the task, then measures baselines for metric checks.",
    ports: ["out"],
    params: [],
    async run({ engine, s, task, log }) {
      const t = task();
      engine.ws.ensureIntegration(s);
      engine.ws.createTask(s, t);
      if (!t.baseline) {
        t.baseline = {};
        for (const c of t.checks.filter((x) => x.measure)) {
          const r = await runCheck(t.worktree!, c.cmd);
          const v = lastNumber(r.out);
          if (r.code === 0 && v !== undefined) t.baseline[c.name] = v;
          log(`baseline ${c.name} = ${v ?? "n/a"}`);
        }
      }
      return "out";
    },
  },
  {
    type: "agent.delegate",
    label: "Delegate to agent",
    group: "agent",
    description: "Sends the task brief (rules, role, allowed files, checks, earlier reports, correction) to the chosen model and records the attempt. A retry keeps the same model and its work; a new model starts from a clean worktree.",
    ports: ["out", "none"],
    params: [],
    async run(ctx) {
      const { engine, s, task, log } = ctx;
      const t = task();
      const p = profileOf(ctx, t);
      const last = t.attempts[t.attempts.length - 1];
      let key: string | undefined;
      if (last?.decision === "retry" && !engine.models.coolingDown(last.model)) key = last.model;
      else key = t.candidates?.find((c) => !t.excluded.includes(c.key) && !engine.models.coolingDown(c.key))?.key;
      if (!key) {
        t.approvalReason = "every candidate model is excluded or cooling down";
        return "none";
      }
      if (s.costUsd >= engine.cfg.budget.perRunUsd) {
        t.approvalReason = `run budget $${engine.cfg.budget.perRunUsd} used up`;
        return "none";
      }
      if (last && last.model !== key) engine.ws.reset(t);
      const adapter = engine.models.adapter(key);
      const depReports = t.deps
        .map((d) => s.tasks.find((x) => x.id === d))
        .map((d) => {
          const a = d?.attempts.find((x) => x.decision === "accept");
          return a && fs.existsSync(a.reportFile) ? `### ${d!.id}: ${d!.title}\n${fs.readFileSync(a.reportFile, "utf8").slice(0, 6000)}` : "";
        })
        .filter(Boolean);
      const n = t.attempts.length + 1;
      const prompt = workerPrompt({ s, t, profile: p, cwd: t.worktree!, terse: engine.cfg.terse, apiEdit: adapter.kind === "api" && p.mode === "edit", depReports });
      log(`delegate ${t.id} #${n} -> ${key}`);
      const startedAt = now();
      const res = await engine.runModel(s, key, { mode: p.mode, prompt, cwd: t.worktree!, timeoutMin: t.timeoutMin ?? p.timeoutMin, logName: `${t.id}-a${n}`, allowedFiles: t.files });
      const reportFile = path.join(engine.vault.runDir(s.id), `${t.id}-a${n}-report.md`);
      fs.writeFileSync(reportFile, res.text || "(no report)");
      const attempt: Attempt = {
        n,
        model: key,
        startedAt,
        latencyMs: res.latencyMs,
        exitCode: res.exitCode,
        failure: res.failure,
        costUsd: res.costUsd,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        reportFile,
        // "BLOCKED: none" / "n/a" means the agent was NOT blocked
        blocked: res.text.split("\n").filter((l) => /^\s*(?:[-*]\s*)?BLOCKED:/i.test(l) && !/BLOCKED:\W*(?:none|no|n\/?a|nothing)?\W*$/i.test(l)).map((l) => l.trim()),
      };
      t.attempts.push(attempt);
      log(`${t.id} #${n} finished in ${Math.round(res.latencyMs / 1000)}s${res.failure ? `, failure ${res.failure}` : ""}`);
      return "out";
    },
  },
  {
    type: "verify.evidence",
    label: "Verify (evidence)",
    group: "verify",
    description: "The engine, not the agent, checks the work: changed files vs allowed scope, then runs every acceptance check in the worktree and compares metrics with the baseline.",
    ports: ["out"],
    params: [],
    async run(ctx) {
      const { engine, s, task, log } = ctx;
      const t = task();
      const a = t.attempts[t.attempts.length - 1];
      if (a.failure) return "out";
      const p = profileOf(ctx, t);
      const diffFile = path.join(engine.vault.runDir(s.id), `${t.id}-a${a.n}.diff`);
      const { changed, diffLines } = engine.ws.changes(s, t, diffFile);
      // read-only agents must not change anything at all
      const marked = p.mode === "readonly" ? changed.map((c) => ({ ...c, inScope: false })) : changed;
      const checks: Evidence["checks"] = [];
      // an edit agent that changed nothing fails without spending minutes on the test suite
      const skip = p.mode === "edit" && diffLines === 0;
      for (const c of skip ? [] : t.checks) {
        const r = await runCheck(t.worktree!, c.cmd);
        const value = c.measure ? lastNumber(r.out) : undefined;
        const baseline = t.baseline?.[c.name];
        let ok = r.code === 0;
        if (ok && c.measure && value !== undefined && baseline !== undefined) ok = c.expect === "higher" ? value > baseline : value < baseline;
        if (ok && c.measure && value === undefined) ok = false;
        checks.push({ name: c.name, cmd: c.cmd, ok, exitCode: r.code, value, baseline, tail: tail(r.out, 20) });
      }
      a.evidence = { changed: marked, scopeOk: marked.every((c) => c.inScope), checks, checksOk: checks.every((c) => c.ok), diffLines, diffFile };
      log(`evidence ${t.id} #${a.n}: ${marked.length} file(s), scope ${a.evidence.scopeOk ? "ok" : "VIOLATED"}, checks ${checks.filter((c) => c.ok).length}/${checks.length}`);
      return "out";
    },
  },
  {
    type: "agent.review",
    label: "Independent review",
    group: "verify",
    description: "A different model reviews the diff against the task and the evidence (correctness, regressions, security, scope, simplicity). Runs when the agent profile asks for it, for risky tasks, or for big diffs.",
    ports: ["out"],
    params: [{ name: "minDiffLines", type: "number", default: 150, description: "Diffs this big are always reviewed." }],
    async run(ctx) {
      const { engine, s, params, task, log } = ctx;
      const t = task();
      const a = t.attempts[t.attempts.length - 1];
      const ev = a.evidence;
      const p = profileOf(ctx, t);
      if (a.failure || !ev || !ev.scopeOk || !ev.checksOk || a.blocked.length || ev.diffLines === 0) return "out";
      const needed = p.review === "always" || (p.review === "risky" && (t.risk !== "low" || ev.diffLines >= Number(params.minDiffLines)));
      if (!needed) return "out";
      const reviewer = engine.agents().review;
      const { candidates } = await engine.router.rank({
        category: "review",
        mode: "readonly",
        risk: t.risk,
        minTier: reviewer?.minTier ?? "standard",
        exclude: [a.model], // independence: never the author
        contextNeeded: 30_000,
        budgetUsd: Math.min(engine.cfg.budget.perTaskUsd, engine.cfg.budget.perRunUsd - s.costUsd),
        escalated: t.risk === "high",
      });
      const diff = fs.readFileSync(ev.diffFile, "utf8");
      const report = fs.existsSync(a.reportFile) ? fs.readFileSync(a.reportFile, "utf8") : "";
      const prompt = reviewPrompt({ s, t, ev, diff, report, terse: engine.cfg.terse });
      for (const c of candidates.slice(0, 3)) {
        const res = await engine.runModel(s, c.key, { mode: "readonly", prompt, cwd: t.worktree!, timeoutMin: reviewer?.timeoutMin ?? 15, logName: `${t.id}-a${a.n}-review` });
        const data = res.failure ? null : extractJson<Review>(res.text);
        engine.vault.recordExecution({
          run: s.id, task: `${t.id}-review`, attempt: a.n, model: c.key, adapter: c.key.split(":")[0], category: "review", risk: t.risk, source: "run",
          success: !!data, checksPassed: !!data, latencySec: Math.round(res.latencyMs / 1000), costUsd: +res.costUsd.toFixed(5),
          tokensIn: Math.round(res.tokensIn), tokensOut: Math.round(res.tokensOut), retryIndex: 0, reviewScore: null, toolFailure: res.failure ?? "",
          decision: data ? "review" : "review-failed", date: now(),
        });
        if (data && typeof data.score === "number") {
          a.review = { model: c.key, score: data.score, verdict: String(data.verdict ?? ""), findings: Array.isArray(data.findings) ? data.findings : [] };
          log(`review ${t.id} #${a.n} by ${c.key}: ${data.score}`);
          return "out";
        }
      }
      a.reason = "review unavailable";
      log(`review ${t.id}: no reviewer produced a valid review`);
      return "out";
    },
  },
  {
    type: "workspace.integrate",
    label: "Integrate",
    group: "workspace",
    description: "Commits the accepted task on its branch and merges it into the run's integration branch (never into the owner's branch). Read-only tasks just close their worktree.",
    ports: ["out", "conflict"],
    params: [],
    async run(ctx) {
      const { engine, s, task, log } = ctx;
      const t = task();
      t.status = "accepted";
      if (profileOf(ctx, t).mode === "readonly") {
        engine.ws.reset(t);
        engine.ws.removeTask(s, t);
        return "out";
      }
      const r = engine.ws.integrate(s, t);
      if (!r.ok) {
        t.status = "running";
        t.approvalReason = `merge into ${s.integrationBranch} failed: ${r.err}`;
        log(t.approvalReason);
        return "conflict";
      }
      log(`merged ${t.branch} into ${s.integrationBranch}`);
      return "out";
    },
  },
];

