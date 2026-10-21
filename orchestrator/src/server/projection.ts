// Engine RunState -> the desktop UI's run state (Clutch's ClutchState shape).
// Runs on the runner, next to the vault, because it reads attempt diffs and reports.
import fs from "node:fs";
import path from "node:path";
import type { Attempt, RunState, Task } from "../types.ts";

/* the subset of Clutch's shared-types the UI renders (see docs/SMURF.md) */
export type ToolKind = "explore" | "implement";
export interface DiffLine { lineNum: number; type: "addition" | "deletion" | "normal"; text: string }
export interface DiffFile { path: string; status: "A" | "M" | "D"; summary?: string; patch?: string; diffs?: DiffLine[] }
export interface ChatMessage {
  id: string;
  agent: string;
  avatar: string;
  time: string;
  status?: "COMPLETED" | "FAILED" | "RUNNING";
  text: string;
  executionTime?: string;
  tokens?: string;
  badgeText?: string;
  runtimeEngine?: string;
  filesChanged?: string[];
  planCard?: { title: string; steps: string[]; summary?: string; status: "pending" | "approved" | "cancelled" | "revised"; note?: string };
  questionCard?: { question: string; options: { id: string; label: string }[]; status: "pending" | "answered" | "cancelled"; allowCustom?: boolean; kind?: "question" };
  verificationReport?: { title: string; conclusion: "passed" | "failed"; steps: { id: string; name: string; status: "passed" | "failed" | "skipped"; detail?: string }[]; summary?: string; changedFiles?: string[] };
  diffSummary?: { title: string; summary?: string; files: DiffFile[]; inline?: boolean };
  subtaskCards?: { id: string; type: ToolKind; title: string; summary?: string; status: "running" | "done" | "failed"; error?: string }[];
}
export interface UiState {
  run_id: string;
  workflow_id: string;
  current_instruction: string;
  active_node_id: string;
  active_agent: string;
  status: "running" | "failed" | "passed" | "awaiting_human" | "idle";
  messages: ChatMessage[];
  terminal_logs: string[];
  changed_files: string[];
  agent_todos: { id: string; content: string; status: "pending" | "in_progress" | "completed" }[];
  pending_subtasks: NonNullable<ChatMessage["subtaskCards"]>;
  verification_report?: ChatMessage["verificationReport"];
  diff_summary?: ChatMessage["diffSummary"];
  session_tokens: number;
  session_cost_usd: number;
  token_input: number;
  token_output: number;
  usage_estimated: boolean;
  awaiting_continue: boolean;
  /* Smurf extras: the gate the owner must answer, and the raw engine status */
  waiting?: { kind: string; question: string; options: string[]; taskId?: string } | null;
  engine_status?: RunState["status"];
  error?: string;
}

export function emptyState(runId: string): UiState {
  return {
    run_id: runId,
    workflow_id: "",
    current_instruction: "",
    active_node_id: "",
    active_agent: "",
    status: "idle",
    messages: [],
    terminal_logs: [],
    changed_files: [],
    agent_todos: [],
    pending_subtasks: [],
    session_tokens: 0,
    session_cost_usd: 0,
    token_input: 0,
    token_output: 0,
    usage_estimated: false,
    awaiting_continue: false,
    waiting: null,
  };
}

const hhmm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "");
const read = (f?: string, max = 200_000) => (f && fs.existsSync(f) ? fs.readFileSync(f, "utf8").slice(0, max) : "");

/** Splits a unified git diff into per-file entries with numbered lines. */
export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const chunk of diff.split(/^(?=diff --git )/m).filter((c) => c.startsWith("diff --git"))) {
    const name = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const file = name ? name[2] : "?";
    const status: DiffFile["status"] = /^new file mode/m.test(chunk) ? "A" : /^deleted file mode/m.test(chunk) ? "D" : "M";
    const diffs: DiffLine[] = [];
    let n = 0;
    for (const line of chunk.split("\n")) {
      const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (h) {
        n = Number(h[1]);
        continue;
      }
      if (!n || line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) diffs.push({ lineNum: n++, type: "addition", text: line.slice(1) });
      else if (line.startsWith("-")) diffs.push({ lineNum: n, type: "deletion", text: line.slice(1) });
      else if (line.startsWith(" ")) diffs.push({ lineNum: n++, type: "normal", text: line.slice(1) });
    }
    const add = diffs.filter((d) => d.type === "addition").length;
    const del = diffs.filter((d) => d.type === "deletion").length;
    files.push({ path: file, status, summary: `+${add} -${del}`, patch: chunk.slice(0, 50_000), diffs: diffs.slice(0, 2000) });
  }
  return files;
}

function taskCard(t: Task) {
  const last = t.attempts[t.attempts.length - 1];
  const status: "running" | "done" | "failed" = t.status === "accepted" ? "done" : t.status === "failed" || t.status === "skipped" ? "failed" : "running";
  return {
    id: t.id,
    type: (t.category === "research" || t.category === "review" || t.category === "architecture" ? "explore" : "implement") as ToolKind,
    title: `${t.title} [${t.category}, ${t.risk}]`,
    summary: last ? `#${last.n} ${last.model}: ${last.decision ?? "running"}${last.reason ? `, ${last.reason}` : ""}` : t.status,
    status,
    error: t.status === "failed" ? last?.reason : undefined,
  };
}

function attemptMessage(s: RunState, t: Task, a: Attempt): ChatMessage {
  const ev = a.evidence;
  const report = read(a.reportFile, 20_000);
  const files = ev ? parseDiff(read(ev.diffFile)) : [];
  const steps = ev
    ? [
        { id: "scope", name: "Scope", status: (ev.scopeOk ? "passed" : "failed") as "passed" | "failed", detail: ev.changed.map((c) => `${c.inScope ? "" : "OUT OF SCOPE "}${c.status} ${c.file}`).join("\n") || "no changes" },
        ...ev.checks.map((c) => ({
          id: c.name,
          name: c.value !== undefined ? `${c.name} (${c.baseline ?? "?"} -> ${c.value})` : c.name,
          status: (c.ok ? "passed" : "failed") as "passed" | "failed",
          detail: `$ ${c.cmd}\n${c.tail}`,
        })),
        ...(a.review ? [{ id: "review", name: `Review by ${a.review.model}: ${a.review.score}/100`, status: (a.review.score >= 80 ? "passed" : "failed") as "passed" | "failed", detail: [a.review.verdict, ...a.review.findings.map((f) => `[${f.severity}] ${f.file ?? ""} ${f.issue}`)].join("\n") }] : []),
      ]
    : [];
  const done = !!a.decision;
  return {
    id: `${t.id}-a${a.n}`,
    agent: a.model,
    avatar: "",
    time: hhmm(a.startedAt),
    status: !done ? "RUNNING" : a.decision === "accept" ? "COMPLETED" : "FAILED",
    text: [`**${t.title}**, attempt ${a.n}${a.failure ? ` (tool failure: ${a.failure})` : ""}`, a.decision ? `Decision: **${a.decision}**${a.reason ? `, ${a.reason}` : ""}` : "", report.trim()].filter(Boolean).join("\n\n"),
    executionTime: a.latencyMs ? `${Math.round(a.latencyMs / 1000)}s` : undefined,
    tokens: a.tokensIn || a.tokensOut ? `${a.tokensIn + a.tokensOut}` : undefined,
    badgeText: t.category.toUpperCase(),
    runtimeEngine: a.model,
    filesChanged: files.map((f) => f.path),
    verificationReport: ev ? { title: `Evidence for ${t.id} #${a.n}`, conclusion: ev.scopeOk && ev.checksOk ? "passed" : "failed", steps, changedFiles: files.map((f) => f.path) } : undefined,
    diffSummary: files.length ? { title: `Diff ${t.id} #${a.n}`, summary: `${files.length} file(s), ${ev?.diffLines ?? 0} lines`, files } : undefined,
  };
}

/** Full UI state for a run. `logs` are recent engine log lines kept by the runner. */
export function project(s: RunState, vaultRunDir: string, logs: string[] = []): UiState {
  const m: ChatMessage[] = [{ id: "request", agent: "User", avatar: "", time: hhmm(s.createdAt), text: s.request }];
  const u = s.understanding;
  if (u)
    m.push({
      id: "understanding",
      agent: "Senior",
      avatar: "",
      time: hhmm(s.createdAt),
      status: "COMPLETED",
      badgeText: "UNDERSTAND",
      text: [`**Goal:** ${u.goal}`, u.constraints.length ? `**Constraints:**\n${u.constraints.map((c) => `- ${c}`).join("\n")}` : "", u.successCriteria.length ? `**Success criteria:**\n${u.successCriteria.map((c) => `- ${c}`).join("\n")}` : "", u.assumptions.length ? `**Assumptions:**\n${u.assumptions.map((c) => `- ${c}`).join("\n")}` : ""].filter(Boolean).join("\n\n"),
    });
  const w = s.waiting;
  if (w?.kind === "question")
    m.push({ id: "question", agent: "Senior", avatar: "", time: hhmm(s.updatedAt), text: "I need answers before planning.", questionCard: { question: w.question, options: [], status: "pending", allowCustom: true, kind: "question" } });
  if (s.tasks.length) {
    const approval = w?.kind === "approval";
    const started = s.tasks.some((t) => t.attempts.length);
    m.push({
      id: "plan",
      agent: "Senior",
      avatar: "",
      time: hhmm(s.createdAt),
      status: "COMPLETED",
      badgeText: "PLAN",
      text: `Planned ${s.tasks.length} task(s).`,
      planCard: {
        title: "Plan",
        steps: s.tasks.map((t) => `${t.id} [${t.category}, ${t.risk}] ${t.title}${t.approvalReason ? ` (needs approval: ${t.approvalReason})` : ""}${t.checks.length ? `\n  checks: ${t.checks.map((c) => c.cmd).join(" ; ")}` : ""}`),
        status: approval ? "pending" : s.status === "aborted" && !started ? "cancelled" : "approved",
      },
      subtaskCards: s.tasks.map(taskCard),
    });
  }
  for (const t of s.tasks) for (const a of t.attempts) m.push(attemptMessage(s, t, a));
  if (w && w.kind !== "question" && w.kind !== "approval")
    m.push({ id: `escalation-${w.taskId ?? ""}`, agent: "Senior", avatar: "", time: hhmm(s.updatedAt), status: "FAILED", badgeText: "NEEDS YOU", text: w.question, questionCard: { question: w.question, options: w.options.map((o) => ({ id: o, label: o })), status: "pending" } });
  const report = read(path.join(vaultRunDir, "report.md"), 40_000);
  if ((s.status === "done" || s.status === "aborted") && report) m.push({ id: "report", agent: "Senior", avatar: "", time: hhmm(s.updatedAt), status: "COMPLETED", badgeText: "REPORT", text: report.replace(/^---[\s\S]*?---\s*/, "") });
  if (s.error) m.push({ id: "error", agent: "System", avatar: "", time: hhmm(s.updatedAt), status: "FAILED", text: `Run failed: ${s.error.split("\n")[0]}` });

  const cur = s.tasks.find((t) => t.id === s.currentTask);
  const lastAttempt = cur?.attempts[cur.attempts.length - 1];
  const latest = [...s.tasks].flatMap((t) => t.attempts).filter((a) => a.evidence).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).pop();
  const latestMsg = latest ? m.find((x) => x.runtimeEngine === latest.model && x.verificationReport && x.id.endsWith(`-a${latest.n}`)) : undefined;
  const attempts = s.tasks.flatMap((t) => t.attempts);
  const allAccepted = s.tasks.length > 0 && s.tasks.every((t) => t.status === "accepted" || t.status === "skipped");
  return {
    ...emptyState(s.id),
    workflow_id: s.workflow,
    current_instruction: s.request,
    active_node_id: s.cursor,
    active_agent: lastAttempt?.model ?? (cur ? cur.id : "Senior"),
    status: s.status === "running" ? "running" : s.status === "waiting" ? "awaiting_human" : s.status === "done" && allAccepted ? "passed" : "failed",
    messages: m,
    terminal_logs: logs.slice(-500),
    changed_files: latestMsg?.filesChanged ?? [],
    agent_todos: s.tasks.map((t) => ({ id: t.id, content: t.title, status: t.status === "accepted" || t.status === "skipped" || t.status === "failed" ? "completed" : t.attempts.length ? "in_progress" : "pending" })),
    pending_subtasks: s.tasks.map(taskCard),
    verification_report: latestMsg?.verificationReport,
    diff_summary: latestMsg?.diffSummary,
    session_cost_usd: +(s.costUsd + (s.usageUsd ?? 0)).toFixed(4),
    token_input: attempts.reduce((x, a) => x + a.tokensIn, 0),
    token_output: attempts.reduce((x, a) => x + a.tokensOut, 0),
    session_tokens: attempts.reduce((x, a) => x + a.tokensIn + a.tokensOut, 0),
    waiting: w ? { kind: w.kind, question: w.question, options: w.options, taskId: w.taskId } : null,
    engine_status: s.status,
    error: s.error,
  };
}
