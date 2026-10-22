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
git clone https://github.com/HusnainMaroof/smurf.git && cd smurf
npm install                 # dev tools only (typescript); the runtime has no dependencies
npm run setup               # creates config/local.json, lists which agent CLIs are installed
npm run setup -- --openhands --freebuff   # optional: OpenHands venv, node-pty for Freebuff (in ~/.orch)

node src/cli.ts init ../my-repo --allow "npm test,npx tsc,node " --link node_modules
node src/cli.ts models --refresh
ORCH_CONFIG=config/free-only.json node src/cli.ts run my-repo "the sales API takes 2 seconds, make it fast"
node src/cli.ts summary <run>               # one screen: tasks, evidence, question, diff, follow-ups
node src/cli.ts resume <run> --choice approve
node src/cli.ts merge <run>                 # re-runs every check on the merged code, commits if all pass
npm test                    # all tests with the mock provider (no tokens)
```

Needs Node 23.6+ (runs TypeScript directly) and Git Bash on Windows. `config/free-only.json`
restricts runs to free models. Everything runs from the repo root.

## The loop

```text
codemap -> understand -> plan -> owner approval (risky only) -> for each task (parallel lanes):
  prepare worktree + baseline -> route -> delegate -> verify evidence -> review -> decide
     accept   -> integrate into orch/<run>        retry    -> same model, with the exact fixes
     reassign -> next model (tier goes up)        escalate -> waits for you
-> report (you merge orch/<run> with `orch merge`)
```

| Rule | How it is enforced |
|---|---|
| Senior manages, agents work | Senior nodes only understand, plan and confirm high-risk accepts. |
| Never trust "it worked" | `verify.evidence`: the engine runs the checks itself and measures metrics before and after. Checks are not run (and nothing counts as passed) when nothing in scope changed. |
| No shared files between agents | One branch and worktree per task; stray edits outside the allowed files are undone; merged only after acceptance. |
| Independent review | Coding, testing and debugging work is always reviewed by a second model, routed separately; it is never the author. |
| Nobody loops unnoticed | Every 10 minutes (`limits.watchMin`) the engine checks each streaming agent: output that only repeats itself, or only heartbeats, stops the agent and the task is retried or reassigned. |
| Risky things need you | High risk, check commands outside the allow-list, agent `BLOCKED:` lines, failed merges. |
| Budget | Per-run and per-task USD limits; metered models over budget are filtered out. |

Owner commands: `status`, `summary <run>`, `resume <run> --choice <option>` (a senior question with
options takes `--choice 1|2|...`), `abort <run>`, `merge <run>`, `run-tasks <project> <file> --check`.

## Context for the agents

| Who | Gets |
|---|---|
| Senior (understand, plan) | Repo snapshot, Graphify `GRAPH_REPORT.md`, project notes (`vault/Projects/<name>.md`), and **lessons** from the project's recent runs: failed and retried tasks with their critiques, open follow-ups of the newest run |
| Worker | Its brief, allowed files, checks, the run's other tasks (so it neither does nor reports them), reports of the tasks it depends on, and **RELATED FILES** from the code map: what its files import and what uses them |

## Routing

The router filters (mode, tier, cooldown, context, budget), then ranks by
`config/orchestrator.json` weights: own benchmarks 30, correctness 25, tool
compatibility 15, context 10, latency 10, cost 10. Each signal is learned from
`vault/Executions` and shrunk toward a prior, so untested models still get a chance.
`orch route <category>` shows the breakdown.

Failures cool a model down by class (`router.cooldownMin`). Provider problems (`rate_limit`,
`auth`, `not_found` incl. retired models, `no_response` from an ACP backend that hides the error)
never count against a model's quality; crashes, timeouts and bad output do.

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
| `cli` | Claude Code, Cline, OpenCode, Kilo, Codex, Command Code, Freebuff, any other agent CLI | Command templates in config (`{model}`, `{promptFile}`, `{cwd}`, `{root}`, `{timeoutSec}`, ...); the prompt goes on stdin. Agents run with git disabled. Parse modes: `text`, `claude-json`, `commandcode-json`, `out-file`. |
| `api` | OpenRouter, OpenAI, Ollama, LM Studio, any OpenAI-compatible API | Model discovery reads context length and price. API models edit through a file-block protocol limited to allowed files. Keys come from env vars. |
| `openhands` | OpenCode, Kilo, Cline driven over ACP | OpenHands SDK is the agent runtime (conversation, events, stuck detection, usage), `LocalWorkspace`, no Docker. The CLI is the backend, with its own login and models, so no API key. Keys look like `openhands:opencode/opencode/glm-5.3-flash-free`. A model the backend rejects fails the run (`not_found`) instead of silently using the backend's default. |
| `mock` | Tests and UI development | Scripted, no tokens. |

OpenHands setup: a Python 3.12 venv at `~/.orch/openhands-venv` with `openhands-sdk`
and `openhands-tools` (`npm run setup -- --openhands`, runner `scripts/openhands_agent.py`).
Add a backend under `providers.openhands.backends`: its ACP command, optional env prefix, and the
ACP session mode for `readonly` and `edit`.

### Freebuff

Freebuff has no headless mode, so `scripts/freebuff_drive.cjs` drives its TUI through a ConPTY
(`node-pty`, installed with `npm run setup -- --freebuff`):

- picks the model in `/model` and confirms it in the status bar (keys use the picker names,
  `freebuff:Nemotron 3.5 Lightning`; `node scripts/freebuff_drive.cjs models` lists them);
- types the prompt, answers question menus and "continue" pauses, prints new screen text as
  `[screen]` lines for the engine's check-in;
- finishes on a stable `.orch-report.md`, or on the answer footer with no more "Thinking";
- never confirms paid hours unless `FREEBUFF_ALLOW_PAID=1`, and stops a session after
  `FREEBUFF_MAX_HOURS` (default 1) of the daily hours counter.

Only the UNLIMITED models (Nemotron 3.5 Lightning, Glyph Cluster) are in the routing list, so
automatic runs never spend daily hours. Debug: `probe` (screen), `pick --model "<name>"`.
Freebuff may use prompts for training unless that is turned off in its settings.

## Token saving (Caveman style)

`"terse": "off" | "lite" | "full" | "ultra"` makes agent-to-agent text (reports,
review findings, JSON fields) short, after the
[Caveman skill](https://github.com/JuliusBrussee/caveman). Code, commands, paths
and errors stay exact. Text you read (reports, questions) is never compressed.

## Code map (Graphify)

The first node of every run (`context.codemap`, in both the `default` and `tasks` workflows)
refreshes the project's [Graphify](https://github.com/Graphify-Labs/graphify) code map when the
repo has new commits: `graphify update` (AST only, no tokens), then one Obsidian note per
function/class/module in `vault/Code/<project>/notes`, plus `GRAPH_REPORT.md` for the senior and
`graph.json` for the workers' RELATED FILES. `orch graph <project>` does the same by hand.
Install: `pip install graphifyy`.

## Claude Code skills

For a Claude Code session acting as the supervisor (`.claude/skills/`):

| Skill | For |
|---|---|
| `orchestrator` | Operating and changing the orchestrator |
| `orch-ship` | Ship work through the agents: batch, check, run, review, merge |
| `orch-fix` | Turn a real run problem into an engine fix with a test |
| `launch-agents` | Which agent for which need, how to launch each one, the 10-minute check on running agents |

## Layout

```text
src/engine.ts        graph runner, parallel lanes, state save/resume, senior + model helpers
src/nodes/           node types (senior, flow, agent, bench): ports + params + run()
src/router.ts        six-signal router
src/models.ts        provider registry, discovery, cooldowns
src/adapters/        cli, api, openhands (ACP), mock; common.ts: failure classes
src/workspace.ts     integration branch, task worktrees, junctions, merge
src/ship.ts          owner side: summary, merge, batch check
src/graph.ts         Graphify code map + RELATED FILES
src/lessons.ts       lessons from recent runs for the senior
src/vault.ts         Obsidian notes: runs, tasks, executions, models, agents, projects
src/prompts.ts       every prompt
scripts/             setup.ts, openhands_agent.py, freebuff_drive.cjs, benchmark and Graphify helpers
config/              orchestrator.json, free-only.json, rules/
workflows/           workflow graphs (also loaded from vault/Workflows)
tasks/               task batches run with run-tasks
test/                mock-provider tests (npm test)
vault/               the Obsidian vault (run data is git-ignored)
AGENTS.md            how to work on this repo; TODO.md: what is next
```
