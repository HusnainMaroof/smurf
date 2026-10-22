# TODO (next session)

State on 2026-10-22: the orchestrator lives at the repo root (the old `orchestrator/` folder and
`agents workflows/` are gone). Commands run from the repo root; add
`ORCH_CONFIG=config/free-only.json` for runs. Fresh clone: `npm install && npm run setup`.

## Next

- [ ] Context from Graphify and the vault:
  - `tasks` workflow builds the code map too (it has no `codemap` node today).
  - Each worker gets its files' neighbours from `vault/Code/<project>/graph.json`.
  - Senior gets lessons from the project's last runs (failures, review findings, open follow-ups).
  - Fill `vault/Projects/orch.md` (stack, commands, what not to touch).
- [ ] `orch summary` shows a task as "not started" while its agent is working (delegate running).
- [ ] Senior chain: `src/util.ts` `git()` could drop `GIT_DIR`/`GIT_WORK_TREE` from the child env
      (follow-up from a run: a leaked `isolateGit` env breaks git steps).
- [ ] OpenHands `tokensIn` is cumulative per turn; store cache reads separately.
- [ ] Command Code and Freebuff are in the config but disabled. Freebuff has no headless mode
      (prompt argument rejected, stdin opens the TUI); Command Code is untested.
- [ ] Run `node src/cli.ts bench --random 3 --per-task 2` now and then so the router learns new models.
