# AGENTS.md: working on the orchestrator

This repo is an AI dev-team orchestrator. All of it lives in the drop-in `agents/` folder (one
command: `./agents/orch`, nothing to install; `./agents/orch setup` after a clone). A senior model plans
small tasks, the engine routes each task to a model, runs it in its own git worktree, verifies the
result itself (checks, scope, metrics), gets an independent review, and accepts, retries,
reassigns or escalates to the owner. Everything is recorded in an Obsidian vault.

## Commands (`./agents/orch` from the repo root; dev commands inside `agents/engine/`)

| Command | What it does |
|---|---|
| `cd agents/engine && npx tsc --noEmit` | Type-check (there is no build step: Node runs the .ts files directly) |
| `cd agents/engine && npm test` | All tests with the mock provider, no tokens: `agents/engine/tests/e2e.ts`, `parallel.ts`, `pick.ts`, `guards.ts` |
| `cd agents/engine && node tests/<name>.ts` | One test file |
| `./agents/orch` | CLI help |

Always run both `npx tsc --noEmit` and `npm test` (in `agents/engine/`) before you say a change is done.

## Layout

| Path | What |
|---|---|
| `agents/orch`, `agents/orch.cmd` | The one command (bash / cmd and PowerShell); runs `agents/engine/src/cli.ts` with Node |
| `agents/skills/` | Claude Code skills; `./agents/orch setup` copies them to `.claude/skills/` (generated, git-ignored) |
| `agents/tasks/` | Task batches for `run-tasks` |
| `agents/engine/src/engine.ts` | Walks the workflow graph; parallel task lanes; locks for git steps and checks; senior chain; `runModel` |
| `agents/engine/src/nodes/` | Node types (`flow.ts`: approval, tasks.next, escalation, report; `senior.ts`: understand, plan, decide; `agent.ts`: route, delegate, verify, review, integrate; `bench.ts`) |
| `agents/engine/src/prompts.ts` | Every prompt the senior, workers and reviewers get |
| `agents/engine/src/router.ts` | Model ranking from `agents/vault/Executions` (bench, correctness, tools, context, latency, cost) |
| `agents/engine/src/models.ts` | Model discovery, cooldowns, quotas, billing |
| `agents/engine/src/adapters/` | `cli.ts` (agent CLIs, prompt on stdin; Freebuff through `agents/engine/scripts/freebuff_drive.cjs`), `api.ts` (OpenAI-compatible APIs), `openhands.ts` (ACP), `mock.ts` (tests), `common.ts` (failure classes, report file name) |
| `agents/engine/src/workspace.ts` | Worktrees, branches, diff/scope, revert, integrate |
| `agents/engine/src/ship.ts` | Owner side of a run: `summary`, `merge` (checks re-run on the merged code), `run-tasks --check` |
| `agents/engine/src/vault.ts` | Reads and writes the vault notes |
| `agents/config/orchestrator.json` | Providers, router weights, limits, budget. `agents/config/free-only.json` is an override for free models only (`ORCH_CONFIG=agents/config/free-only.json`) |
| `agents/config/rules/*.md` | Strict rules every worker gets (edit / readonly) |
| `agents/engine/workflows/*.json` | Workflow graphs: `default` (senior plans), `tasks` (preset tasks), `bench` |
| `agents/vault/Agents/*.md` | Role profiles: frontmatter (mode, minTier, timeoutMin, review) + the role method workers get in their prompt |
| `agents/vault/Runs`, `Executions`, `Models`, `Projects` | Run data (gitignored) |

## Conventions

- TypeScript run by Node 24 directly: imports end in `.ts`, only erasable syntax (no enums, no namespaces, no parameter properties).
- No runtime dependencies. Do not add packages.
- LF line endings (`.gitattributes`). The owner works on Windows with Git Bash; shell commands must work there.
- Comments explain why, not what. Match the surrounding code: short names, small functions, no new abstractions for one use.
- Never trust an agent's claim: the engine decides from evidence (`verify.evidence`), so new logic should be checkable the same way.
- Every behaviour change gets a mock-provider test (see `agents/engine/tests/guards.ts` for the pattern: temp repo, script file in `ORCH_MOCK_SCRIPT`, `loadConfig` override, `engine.start`).
- Never put secrets in the vault or in prompts. Never push; the owner pushes.

## How a run flows

```
default: codemap -> understand -> plan -> approve (risky plans only) -> next
  next (parallel lanes, tasks that share no files and no unfinished deps run together):
    prepare -> route -> delegate -> verify -> review -> decide
      accept -> integrate -> next   retry -> delegate (same model)   reassign -> route (next model)
      escalate -> owner: accept, retry, reassign, skip (close -> next) or abort (report)
  next (none left) -> report        `./agents/orch workflow default` prints the real graph
```

Owner answers: `./agents/orch resume <run> --choice <option>`. Accepted work lands on `orch/<run>`; the owner merges it.

## Supervising agents

- Every ~10 minutes while agents run, check each one: `orch summary <run>`, the latest
  `"watch"` events in `agents/vault/Runs/<run>/events.jsonl`, and the agent's log tail. A loop or a
  silent agent is stopped, not waited out. The engine's own check-in (`limits.watchMin`) stops
  agents that loop or make no progress; the `launch-agents` skill has the routine and which agent
  to launch for which need.

## Reporting to the owner

- Long work (agent runs, multi-step changes): give a status update about every 15 minutes, and at
  every step that finishes: what is done, what is running, what is next, overall state.
- Final reports: a numbered list of how each task was done (steps, model, checks, decisions),
  then a table: task | model | result | checks | cost. Follow-ups and open questions last.
