# TODO (next session)

State on 2026-10-22: the orchestrator lives at the repo root. Commands run from the repo root; add
`ORCH_CONFIG=config/free-only.json` for runs. Fresh clone: `npm install && npm run setup`.

Done on 2026-10-22: `orch abort`; research-not-docs plan rule; flatten + `npm run setup`; code map
for `tasks` runs; RELATED FILES for workers; LESSONS for the senior; git env leak fixed in `git()` and
`shell()`; senior questions as text with numbered resume choices; checks not run when nothing in
scope changed (`checksSkipped`); follow-ups about other tasks dropped; summary shows working tasks;
OpenHands cache reads stored apart (`tokensCached`, everywhere); coding/testing/debugging always
reviewed; retired models -> not_found, empty ACP reply -> no_response; Command Code parse mode.
Freebuff runs as an agent through a TUI driver (scripts/freebuff_drive.cjs); a 10-minute check-in stops
agents that loop or make no progress; skill launch-agents.
End-to-end tests on a cloned repo (`~/orch-e2e/clsx`): happy path and failure paths both pass.

## Next

- [ ] Command Code: parse mode done; needs credits on the account, then a small bench run before
      `enabled: true`.
- [ ] Undo of out-of-scope edits next to good work has only the mock test (`test/guards.ts`): in every
      real run so far agents stayed in scope or went fully out of scope. Watch for it in run reports.
- [ ] Freebuff OPTIMIZED models (GLM 5.3 Flash, Muse Spark 1.3, GPT-6 Luna) are left out of routing
      because they spend daily hours; if they are wanted, the router needs a per-day hours budget.
- [ ] Benchmarks: run `node src/cli.ts bench --random 3 --per-task 2` (with
      `ORCH_CONFIG=config/free-only.json`) now and then so the router keeps learning.
