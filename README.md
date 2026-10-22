# Agents orchestrator

A senior model manages a team of AI agents from many providers. It understands
the request, plans small tasks, routes each task to the best model for that kind
of work, delegates it in an isolated git worktree, verifies the result with real
evidence (tests, metrics, scope), gets an independent review, and then accepts,
retries, reassigns or escalates to you. Everything is recorded in an Obsidian
vault, and the router learns from it.

The workflow is a graph of nodes (`workflows/default.json`), n8n style: edit the
JSON to change the flow (`node src/cli.ts nodes` lists the node types). The CLI drives the engine.

## Quick start

```bash
npm install                 # dev tools only (typescript); runtime has no dependencies
node src/cli.ts init ../my-repo --allow "npm test,npx tsc,node " --link node_modules
node src/cli.ts models --refresh
node src/cli.ts run my-repo "the sales API takes 2 seconds, make it fast"
node src/cli.ts status <run>
node src/cli.ts resume <run> --choice approve
npm test                    # end-to-end test with the mock provider (no tokens)
```

Needs Node 23.6+ (runs TypeScript directly) and Git Bash on Windows.

## The loop

```text
understand -> plan -> owner approval (risky only) -> for each task:
  prepare worktree + baseline -> route -> delegate -> verify evidence -> review -> decide
     accept   -> integrate into orch/<run>        retry    -> same model, with the exact fixes
     reassign -> next model (tier goes up)        escalate -> waits for you
-> report (you merge orch/<run> yourself)
```

| Rule | How it is enforced |
|---|---|
| Senior manages, agents work | Senior nodes only understand, plan and confirm high-risk accepts. |
| Never trust "it worked" | `verify.evidence`: the engine runs the checks itself and measures metrics before and after. |
| No shared files between agents | One branch and worktree per task; merged only after acceptance. |
| Independent review | The reviewer is routed separately and can never be the author. |
| Risky things need you | High risk, check commands outside the allow-list, agent `BLOCKED:` lines, failed merges. |
| Budget | Per-run and per-task USD limits; metered models over budget are filtered out. |

## Routing

The router filters (mode, tier, cooldown, context, budget), then ranks by
`config/orchestrator.json` weights: own benchmarks 30, correctness 25, tool
compatibility 15, context 10, latency 10, cost 10. Each signal is learned from
`vault/Executions` and shrunk toward a prior, so untested models still get a chance.
`orch route <category>` shows the breakdown.

## Benchmarks (the router's 30%)

`benchmarks/<id>/` holds small, self-contained tasks: a fixture repo, checks, and
a reference solution. Coding, debugging, testing (tests must kill mutants),
performance (metric must drop), research and review (report must contain the
real finding), and docs.

```bash
node src/cli.ts bench --selftest                 # each fixture fails, each solution passes
node src/cli.ts bench --random 3 --per-task 2    # random tasks x least-tested free models
node src/cli.ts bench --tasks fast-fib --models opencode:opencode/deepseek-v4.1-flash-free
```

Each job gets its own temp repo and worktree, one attempt, a time limit, and a
pass/fail from engine evidence only. Results go to `vault/Executions` (source:
benchmark) and a summary note in `vault/Benchmarks/`. Jobs run in parallel, but
only one at a time per provider, because free tiers share quotas. Add a task:
edit `scripts/make_benchmarks.py`, run it, then run `bench --selftest`.

## Providers

| Adapter | Covers | Notes |
|---|---|---|
| `cli` | Claude Code, Cline, OpenCode, Kilo, Codex, any other agent CLI | Command templates in config. Agents run with git disabled. |
| `api` | OpenRouter, OpenAI, Ollama, LM Studio, any OpenAI-compatible API | Model discovery reads context length and price. API models edit through a file-block protocol limited to allowed files. Keys come from env vars. |
| `openhands` | OpenCode, Kilo, Cline driven over ACP | OpenHands SDK is the agent runtime (conversation, events, stuck detection, usage), `LocalWorkspace`, no Docker. The CLI is the backend, with its own login and models, so no API key. Keys look like `openhands:opencode/opencode/glm-5.3-flash-free`. A model the backend rejects fails the run (`not_found`) instead of silently using the backend's default. |
| `mock` | Tests and UI development | Scripted, no tokens. |

OpenHands setup: a Python 3.12 venv at `~/.orch/openhands-venv` with `openhands-sdk`
and `openhands-tools` (runner: `scripts/openhands_agent.py`). Add a backend under
`providers.openhands.backends`: its ACP command, optional env prefix, and the ACP
session mode for `readonly` and `edit`.

## Token saving (Caveman style)

`"terse": "off" | "lite" | "full" | "ultra"` makes agent-to-agent text (reports,
review findings, JSON fields) short, after the
[Caveman skill](https://github.com/JuliusBrussee/caveman). Code, commands, paths
and errors stay exact. Text you read (reports, questions) is never compressed.

## Code map (Graphify)

The first node of every run (`context.codemap`) refreshes the project's
[Graphify](https://github.com/Graphify-Labs/graphify) code map when the repo has
new commits: `graphify update` (AST only, no tokens), then one Obsidian note per
function/class/module in `vault/Code/<project>/notes`, plus `GRAPH_REPORT.md`,
which the senior reads when it understands and plans. `orch graph <project>`
does the same by hand. Install: `pip install graphifyy`.

## Layout

```text
src/engine.ts        graph runner, state save/resume, senior + model helpers
src/nodes/           node types (senior, flow, agent): ports + params + run()
src/router.ts        six-signal router
src/models.ts        provider registry, discovery, cooldowns
src/adapters/        cli, api, mock
src/workspace.ts     integration branch, task worktrees, junctions, merge
src/vault.ts         Obsidian notes: runs, tasks, executions, models, agents, projects
src/prompts.ts       every prompt
config/              orchestrator.json, rules/
workflows/           workflow graphs (also loaded from vault/Workflows)
vault/               the Obsidian vault
```
