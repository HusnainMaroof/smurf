# Smurf

Smurf is the desktop app for the orchestrator: Clutch's UI (MIT, github.com/fancy1108/Clutch)
on our engine. Local first.

```text
 Smurf desktop (Tauri + React, host)
        │  HTTP + WebSocket  127.0.0.1:47821
        ▼
 smurf-server (Docker)          control plane: API, sessions, RunState -> ClutchState
        ▲  WebSocket /runner (the runner dials out; nothing listens on the host)
        │
 smurf-runner (host)            execution plane: Engine, git worktrees, checks,
                                agent CLIs (OpenCode, Kilo, Cline, Claude) with your logins,
                                vault/ (Obsidian)
```

Why the split: agents, worktrees and acceptance checks need the host's repos, toolchains and
CLI logins. Everything the app talks to lives in the container; the runner only executes.

## Ports

| Port | What |
|---|---|
| 47821 | smurf-server HTTP + WebSocket (container, published on 127.0.0.1) |
| 47823 | Vite dev server for the desktop UI (dev only) |

## Auth

`SMURF_TOKEN` (shared secret in `.env`, generated on first start). The desktop app sends
`Authorization: Bearer <token>`; WebSockets pass `?token=`. The runner authenticates the same way.
`/health` is public.

## HTTP API (shapes follow Clutch where the UI already consumes them)

| Method + path | Body / query | Returns |
|---|---|---|
| GET `/health` | | `{status:"ok", api_version:"smurf-1", runner:{connected, host?, since?}}` |
| GET `/api/workspaces` | | `{workspaces:[{id, workspace_path, name}], active_id}` (projects) |
| POST `/api/workspaces` | `{path, name?, allow?: string, link?: string}` | the workspace (runs `orch init` on the runner; becomes active) |
| POST `/api/workspaces/:id/activate` | | `{active_id}` |
| DELETE `/api/workspaces/:id` | | `{status:"deleted"}` (vault note only; repo untouched) |
| GET `/api/workspace/tree` | `?workspace_id&path` | `{root, entries:[{name, path, type:"file"|"dir"}]}` |
| GET `/api/workspace/file` | `?workspace_id&path` | `{path, content, truncated}` |
| GET `/api/workspace/changes` | `?workspace_id` | `{files: UncommittedFile[]}` |
| GET `/api/workspace/git` | `?workspace_id` | `{branch, is_repo, ahead?, integration_branches:[...]}` |
| GET `/api/runs/history` | `?workspace_id` | `{sessions:[{run_id, title, status, workspace_id, created_at, updated_at}]}` |
| POST `/api/sessions` | `{workspace_id, title?}` | `{run_id}` (empty session; the first chat message starts the run) |
| GET `/api/runs/:id/state` | | `ClutchState` |
| GET `/api/runs/:id/agents` | | `{agents:[{id, kind: senior/worker/review, node (workflow node type it belongs to), task?, title, model, attempt?, status, startedAt, live}]}` oldest first |
| GET `/api/runs/:id/logs/:agentId` | `?offset` | `{text, offset, size, skipped}`: the agent's terminal output since `offset` (ANSI stripped, at most 64 KB; poll with the returned `offset`) |
| DELETE `/api/runs/:id` | | `{status:"deleted"}` |
| GET `/api/seniors` | | senior choices: `{default: string[], options:[{key, tier, billing, cooling}]}` (strong/premium models) |
| PUT `/api/sessions/:id/senior` | `{senior: string or string[]}` | `{senior}`; set before the first message (409 after the run starts) |
| GET `/api/workflows/user` | | `{workflows: WorkflowDef[]}` (our graphs, see mapping) |
| GET `/api/workflows/user/:id` | | `{workflow: WorkflowDef, graph: Workflow}` |
| PUT `/api/workflows/user/:id` | `{graph: Workflow}` | `{status:"saved", problems:[]}` (validated by engine) |
| GET `/api/nodes` | | node registry: `[{type,label,group,description,ports,params}]` |
| GET `/api/models` | `?refresh=1` | `{models:[{key, adapter, model, tier, free, modes, cooling?}], skipped}` |
| GET `/api/route` | `?category&mode` | router breakdown `{candidates:[{key, score, why, parts}], dropped}` |
| GET `/api/agents` | | agent profiles from `vault/Agents` (`[{id, name, category, mode, minTier, review, timeoutMin}]`) |
| GET `/api/benchmarks` | | latest benchmark notes `[{id, date, passed, total, rows:[...]}]` |
| POST `/api/benchmarks` | `{tasks?, models?, random?, perTask?}` | `{status:"started"}` (progress via `/ws/events`) |
| GET `/api/preferences` | | `{theme, language, ...}` (stored in the container volume) |
| POST `/api/preferences/:key` | `{value}` | `{status:"saved"}` |

## WebSocket `/ws/runs/:run_id?token=`

Server → client envelopes `{event, data}` (Clutch's): `state_patch` `{run_id, timestamp, patch}`,
`message` (ChatMessage), `log` `{run_id, line}`, `human_required` `{run_id, kind, question, options}`,
`run_completed` `{run_id, status}`.

Client → server:

| Payload | Meaning |
|---|---|
| `{text, senior?, workflow_id?}` | first message: start a run with this request; later: answer to a waiting question (note) |
| `{action:"human_decision", decision, instructions?}` | answer a gate. `approve`/`reject` for the plan gate, `accept`/`retry`/`reassign`/`skip`/`abort` for escalations (the UI shows the run's `options`) |
| `{action:"stop_run"}` | abort the run |

## Projection: engine RunState -> ClutchState

| ClutchState | From |
|---|---|
| `status` | running→`running`, waiting→`awaiting_human`, done→`passed` (all tasks accepted) or `failed`, failed/aborted→`failed` |
| `active_node_id`, `active_agent` | `cursor`; model key of the current task's last attempt |
| `messages` | user request; senior understanding (assistant); plan as `planCard` (status from approval); questions as `questionCard`; one message per attempt with `subtaskCards`, `verificationReport` (evidence checks + scope), `diffSummary` (attempt diff), `runtimeEngine` = model key; final report |
| `pending_subtasks` | tasks → `{id, type: readonly? "explore":"implement", title, status, summary: decision reason}` |
| `agent_todos` | tasks → todo items (pending / in_progress / completed) |
| `terminal_logs` | engine `log` events |
| `changed_files`, `diff_summary` | latest attempt evidence |
| `session_cost_usd`, `token_input`, `token_output` | run cost and attempts' tokens |

## Workflow mapping (canvas)

Our graph (`workflows/*.json`) is the source of truth. `WorkflowDef.steps` = nodes
(`nodeType`: senior.* / agent.* → `agent_task`, human.* → `human_gate`, verify.* → `check`),
`nextSteps` + `edgeWhen` from edges (port name). The canvas saves the native graph back with
`PUT /api/workflows/user/:id`; the engine validates it.

## Runner protocol (`/runner?token=`), JSON-RPC-ish

Runner → server: `{type:"hello", host, version}`, `{type:"event", event}` (engine events, plus
`{type:"run_state", state}` after each step), `{type:"result", id, ok, data|error}`.
Server → runner: `{type:"call", id, method, params}` with methods:
`start`, `resume`, `abort`, `state`, `runs`, `projects`, `initProject`, `tree`, `file`, `changes`,
`git`, `workflows`, `workflow`, `saveWorkflow`, `nodes`, `models`, `route`, `agents`, `benchmarks`, `bench`.

## Senior model per session

Each session picks its senior model(s) (understand, plan, confirm) when it starts: `PUT /api/sessions/:id/senior`
or `senior` on the first chat message. A picked senior never falls back to the config default, so a free
pick can't silently spend a paid subscription; if it fails the run fails and says so. No pick = config
`senior.model` + `senior.fallback`.
