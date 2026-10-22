# TODO (next session)

State on 2026-10-22: the orchestrator lives at the repo root. Commands run from the repo root; add
`ORCH_CONFIG=config/free-only.json` for runs. Fresh clone: `npm install && npm run setup`.

Done on 2026-10-22: `orch abort`; research-not-docs plan rule; flatten + `npm run setup`; code map
for `tasks` runs; RELATED FILES for workers; LESSONS for the senior; git env leak fixed in `git()` and
`shell()`; senior questions as text with numbered resume choices; checks not run when nothing in
scope changed (`checksSkipped`); follow-ups about other tasks dropped; summary shows working tasks;
OpenHands cache reads stored apart (`tokensCached`); coding/testing/debugging always reviewed.
End-to-end tests on a cloned repo (`~/orch-e2e/clsx`): happy path and failure paths both pass.

## Next

- [ ] Undo of out-of-scope edits next to good work was never triggered by a real model (agents
      stayed in scope); only the mock test covers it.
- [ ] Command Code: configured but disabled (no credits). Its `--output-format json` is an NDJSON
      event stream (`{"type":"result",...,"finalText"}`) and it exits 0 on errors: add a parse mode
      before enabling. Freebuff: no headless mode.
- [ ] `kilo:kilo/minimax/minimax-m3.1-flash:free` returned `not_found` twice on 2026-10-22: check
      whether the model is gone (`orch models --refresh`).
- [ ] Bench, senior and bench nodes do not record `tokensCached` yet (only delegate and review do).
- [ ] Run `node src/cli.ts bench --random 3 --per-task 2` now and then so the router learns new models.
