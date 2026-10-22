# smurf: AI dev-team orchestrator

A senior model plans small tasks and a team of AI agents (Claude Code, OpenCode, Kilo, Cline,
OpenHands, Freebuff, ...) does them in isolated git worktrees. The engine verifies every result
itself, gets an independent review, and accepts, retries, reassigns or asks you.

Everything lives in one drop-in folder, [`agents/`](agents/README.md): copy it into any git
project and it works on that project. Nothing to install.

```bash
./agents/orch setup                                    # once after a clone
ORCH_CONFIG=agents/config/free-only.json ./agents/orch run "what you want done"
./agents/orch summary <run>                            # check it, then: ./agents/orch merge <run>
```

- [`agents/README.md`](agents/README.md): how it works, providers, routing, benchmarks, layout
- [`AGENTS.md`](AGENTS.md): working on the orchestrator (for people and AI agents)
- [`TODO.md`](TODO.md): what is next
