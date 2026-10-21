# AGENTS.md: working on the orchestrator

This repo is an AI dev-team orchestrator. The code lives in `orchestrator/`. A senior model plans
small tasks, the engine routes each task to a model, runs it in its own git worktree, verifies the
result itself (checks, scope, metrics), gets an independent review, and accepts, retries,
reassigns or escalates to the owner. Everything is recorded in an Obsidian vault.

## Commands (run inside `orchestrator/`)

| Command | What it does |
|---|---|
| `npx tsc --noEmit` | Type-check (there is no build step: Node runs the .ts files directly) |
| `npm test` | All tests with the mock provider, no tokens: `test/e2e.ts`, `parallel.ts`, `pick.ts`, `guards.ts` |
| `node test/<name>.ts` | One test file |
| `node src/cli.ts` | CLI help |

Always run both `npx tsc --noEmit` and `npm test` before you say a change is done.

## Layout

| Path | What |
|---|---|
| `src/engine.ts` | Walks the workflow graph; parallel task lanes; locks for git steps and checks; senior chain; `runModel` |
| `src/nodes/` | Node types (`flow.ts`: approval, tasks.next, escalation, report; `senior.ts`: understand, plan, decide; `agent.ts`: route, delegate, verify, review, integrate; `bench.ts`) |
| `src/prompts.ts` | Every prompt the senior, workers and reviewers get |
| `src/router.ts` | Model ranking from `vault/Executions` (bench, correctness, tools, context, latency, cost) |
| `src/models.ts` | Model discovery, cooldowns, quotas, billing |
| `src/adapters/` | `cli.ts` (agent CLIs, prompt on stdin), `api.ts` (OpenAI-compatible APIs), `openhands.ts` (ACP), `mock.ts` (tests), `common.ts` (failure classes, report file name) |
| `src/workspace.ts` | Worktrees, branches, diff/scope, revert, integrate |
| `src/ship.ts` | Owner side of a run: `summary`, `merge` (checks re-run on the merged code), `run-tasks --check` |
| `src/vault.ts` | Reads and writes the vault notes |
| `config/orchestrator.json` | Providers, router weights, limits, budget. `config/free-only.json` is an override for free models only (`ORCH_CONFIG=config/free-only.json`) |
| `config/rules/*.md` | Strict rules every worker gets (edit / readonly) |
| `workflows/*.json` | Workflow graphs: `default` (senior plans), `tasks` (preset tasks), `bench` |
| `vault/Agents/*.md` | Role profiles: frontmatter (mode, minTier, timeoutMin, review) + the role method workers get in their prompt |
| `vault/Runs`, `Executions`, `Models`, `Projects` | Run data (gitignored) |

## Conventions

- TypeScript run by Node 24 directly: imports end in `.ts`, only erasable syntax (no enums, no namespaces, no parameter properties).
- No runtime dependencies. Do not add packages.
- LF line endings (`.gitattributes`). The owner works on Windows with Git Bash; shell commands must work there.
- Comments explain why, not what. Match the surrounding code: short names, small functions, no new abstractions for one use.
- Never trust an agent's claim: the engine decides from evidence (`verify.evidence`), so new logic should be checkable the same way.
- Every behaviour change gets a mock-provider test (see `test/guards.ts` for the pattern: temp repo, script file in `ORCH_MOCK_SCRIPT`, `loadConfig` override, `engine.start`).
- Never put secrets in the vault or in prompts. Never push; the owner pushes.

## How a run flows

```
default: codemap -> understand -> plan -> approve (risky plans only) -> next
  next (parallel lanes, tasks that share no files and no unfinished deps run together):
    prepare -> route -> delegate -> verify -> review -> decide
      accept -> integrate -> next   retry -> delegate (same model)   reassign -> route (next model)
      escalate -> owner: accept, retry, reassign, skip (close -> next) or abort (report)
  next (none left) -> report        `node src/cli.ts workflow default` prints the real graph
```

Owner answers: `node src/cli.ts resume <run> --choice <option>`. Accepted work lands on `orch/<run>`; the owner merges it.
