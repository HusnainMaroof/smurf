# TODO (next session)

State on 2026-10-22: the orchestrator lives at the repo root. Commands run from the repo root; add
`ORCH_CONFIG=config/free-only.json` for runs. Fresh clone: `npm install && npm run setup`.

Done on 2026-10-22: `orch abort`; research-not-docs plan rule; flatten + `npm run setup`; code map
for `tasks` runs; RELATED FILES for workers; LESSONS for the senior; git env leak fixed in `git()` and
`shell()`; senior questions as text with numbered resume choices; checks not run when nothing in
scope changed (`checksSkipped`); follow-ups about other tasks dropped; summary shows working tasks;
OpenHands cache reads stored apart (`tokensCached`, everywhere); coding/testing/debugging always
reviewed; retired models -> not_found, empty ACP reply -> no_response; Command Code parse mode.
End-to-end tests on a cloned repo (`~/orch-e2e/clsx`): happy path and failure paths both pass.

## Next

- [ ] Freebuff as a hand-run agent: a "manual" provider kind. The engine prepares the worktree and
      prompt file, the run waits ("open Freebuff in <worktree>, paste prompt.txt, then resume"), and
      on resume the work is verified, reviewed and routed like any agent. Freebuff has no headless
      mode (0.2.34: prompt argument rejected, stdin opens the TUI); ask them for `freebuff -p`.
- [ ] Command Code: parse mode done; needs credits, then a small bench run before `enabled: true`.
- [ ] Undo of out-of-scope edits next to good work: only the mock test covers it (real agents stayed
      in scope in every run so far).
- [ ] Benchmarks are thin (1-2 runs per model): run `node src/cli.ts bench --random 3 --per-task 2`
      now and then (with `ORCH_CONFIG=config/free-only.json`).
