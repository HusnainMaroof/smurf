# TODO (next session)

State on 2026-10-22: everything lives in the drop-in `agents/` folder; the command is `./agents/orch`
(nothing to install; `./agents/orch setup` after a clone). Add `ORCH_CONFIG=agents/config/free-only.json` for runs.

Done on 2026-10-22: `orch abort`; research-not-docs plan rule; drop-in agents/ folder + `orch setup`; code map
for `tasks` runs; RELATED FILES for workers; LESSONS for the senior; git env leak fixed in `git()` and
`shell()`; senior questions as text with numbered resume choices; checks not run when nothing in
scope changed (`checksSkipped`); follow-ups about other tasks dropped; summary shows working tasks;
OpenHands cache reads stored apart (`tokensCached`, everywhere); coding/testing/debugging always
reviewed; retired models -> not_found, empty ACP reply -> no_response; Command Code parse mode.
Freebuff runs as an agent through a TUI driver (agents/engine/scripts/freebuff_drive.cjs); a 10-minute check-in stops
agents that loop or make no progress; skill launch-agents.
Done on 2026-10-23: an empty ACP reply (Cline over ACP hides provider errors) is re-checked with one
tiny turn through the backend's own CLI, so a 429 / retired model gets the right failure class and
cooldown (both bench failures that day were 429s, not missing credentials); `poststop` stops the
Cline hub when the engine exits (it used to outlive every run).
End-to-end tests on a cloned repo (`~/orch-e2e/clsx`): happy path and failure paths both pass.

## Next

- [ ] Command Code: parse mode done; needs credits on the account, then a small bench run before
      `enabled: true`.
- [ ] Undo of out-of-scope edits next to good work has only the mock test (`agents/engine/tests/guards.ts`): in every
      real run so far agents stayed in scope or went fully out of scope. Watch for it in run reports.
- [ ] Freebuff OPTIMIZED models (GLM 5.3 Flash, Muse Spark 1.3, GPT-6 Luna) are left out of routing
      because they spend daily hours; if they are wanted, the router needs a per-day hours budget.
- [ ] Benchmarks: run `./agents/orch bench --random 3 --per-task 2` (with
      `ORCH_CONFIG=agents/config/free-only.json`) now and then so the router keeps learning.
