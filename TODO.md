# TODO (next session)

State on 2026-10-21: the desktop/web app is removed; the work is the orchestrator in `orchestrator/`.
Start by loading the `orch-ship` skill (and `orchestrator`, `orch-fix` as needed). Commands below run
in `orchestrator/`; add `ORCH_CONFIG=config/free-only.json` for runs.

## 1. Merge the read-only path test

Run `2026-10-21-read-only-path-check-research-review-div` (batch `tasks/demo-readonly-check.json`) finished:
3/3 accepted in 2 min. Both read-only tasks (research, review) were accepted with no escalation, so
the report-as-final-answer fix works on real models (one rate-limit reassign, not a bug).

- [ ] Read the reports: `vault/Runs/<run>/explain-eq-a2-report.md`, `review-math-a1-report.md`.
- [ ] Read the `add-div` diff (`git -C C:/Users/husna/smurf-demo diff main...orch/<run>`), then
      `node src/cli.ts merge 2026-10-21-read-only-path-check-research-review-div`.

## 2. Clean up

- [ ] Run `2026-10-21-smurf-ui-batch-9-agent-terminals` shows "running" but was stopped when the
      app was removed. There is no `orch abort` command yet (Engine.abort exists): add one, then
      abort this run. Its branches and worktrees are already deleted.
- [ ] Delete leftovers by hand (my delete was blocked): `cmd /c "rmdir /s /q desktop"`,
      `del .env`, `rmdir /s /q references` in the repo root.

## 3. Next improvements (ideas, in order of value)

- [ ] `orch abort <run>` (see above).
- [ ] Senior plans read-only work as `research` tasks, not `docs`: the plan prompt turned
      "explain X (research only)" into a docs task in a real run.
- [ ] Token use on the OpenHands path is cumulative per turn (about 600k per task); not a bug,
      but `tokensIn` could store cache reads separately so the numbers are not misleading.
- [ ] Run `node src/cli.ts bench --random 3 --per-task 2` now and then so the router learns the
      newer free models (exploration only touches low-risk tasks).

## Done today (for context)

Parallel task lanes; free senior chain; prompts on stdin (Windows 32 KB limit); scope repair
(stray files undone, work kept); BLOCKED filtering and downgrade when checks pass; workers see the
run's other tasks; follow-ups in reports; `orch summary`, `orch merge`, `run-tasks --check`;
role methods in `vault/Agents`; `AGENTS.md`; skills `orchestrator`, `orch-ship`, `orch-fix`.
