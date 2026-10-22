# TODO (next session)

State on 2026-10-22: the orchestrator lives at the repo root. Commands run from the repo root; add
`ORCH_CONFIG=config/free-only.json` for runs. Fresh clone: `npm install && npm run setup`.

Done on 2026-10-22: `orch abort`; research-not-docs plan rule; flatten + `npm run setup`; code map
for `tasks` runs; workers get RELATED FILES from the code map; senior gets LESSONS from recent
runs; engine `git()` ignores a leaked GIT_DIR/GIT_WORK_TREE; project notes in `vault/Projects/orch.md`.

## Next

- [ ] `shell()` still passes a leaked GIT_DIR/GIT_WORK_TREE to check commands: filter it there too
      (adapters with `isolateGit` re-add their own through `opts.env`).
- [ ] RELATED FILES lists each link twice (`imports` and `imports_from`): keep one per file pair.
- [ ] `src/lessons.ts` has its own `followUps()`; reuse the one in `src/nodes/flow.ts`.
- [ ] Lessons repeat follow-ups that were already fixed: drop follow-ups of merged runs older than
      the newest merge, or let the owner mark them done.
- [ ] `orch summary` shows a task as "not started" while its agent is working.
- [ ] OpenHands `tokensIn` is cumulative per turn; store cache reads separately.
- [ ] Command Code and Freebuff are in the config but disabled. Freebuff has no headless mode
      (prompt argument rejected, stdin opens the TUI); Command Code is untested.
- [ ] Run `node src/cli.ts bench --random 3 --per-task 2` now and then so the router learns new models.
