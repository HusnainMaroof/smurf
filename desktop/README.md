# Smurf desktop

The desktop app for Smurf: a Tauri 2 + React 19 + Vite UI for the orchestrator. It is a
thin client of **smurf-server** (runs in Docker), which it reaches over HTTP + WebSocket.
The API contract is in `../orchestrator/docs/SMURF.md`.

## Ports

| Port  | What |
|-------|------|
| 47821 | smurf-server HTTP + WebSocket (default server URL) |
| 47823 | Vite dev server for this UI (dev only, `--strictPort`) |

## Connecting

On first start (no token saved), when the server is unreachable, or when the server answers
401, the app shows the **Connect** screen: server URL (default `http://127.0.0.1:47821`) and
token (print it with `./smurf.sh token` in the repo root). *Test* checks `/health` (including
whether the host runner is connected) and `GET /api/workspaces` with the token; *Save* stores
both in `localStorage` (`smurf.serverUrl`, `smurf.token`) and reloads. You can reopen it from
Settings → General → Server connection, or by clicking the server status in the sidebar.

## Develop

Requires Node 20+, pnpm, and (for the native shell) Rust + the Tauri 2 prerequisites.

```bash
cd desktop
pnpm install
pnpm dev            # browser UI on http://127.0.0.1:47823
pnpm tauri dev      # native window (starts pnpm dev itself)
pnpm test           # vitest
```

## Build

```bash
pnpm build                      # web assets -> dist/
pnpm tauri build --no-bundle    # native exe -> src-tauri/target/release/smurf-desktop(.exe)
pnpm tauri build                # installers (msi/nsis on Windows, dmg on macOS)
```

## Code map

- `src/services/serverUrl.ts` — server URL/token config, `serverFetch` (Bearer auth, 401 → Connect
  screen), `serverJson` (404-tolerant JSON helper), `serverWebSocketUrl`.
- `src/components/ServerGate.tsx`, `ConnectScreen.tsx` — connection gate and Connect screen.
- `shared-types/` — local package `@smurf/shared-types` (UI ↔ server contracts).

## Credits

Smurf desktop is derived from the desktop app of [Clutch](https://github.com/fancy1108/Clutch)
by fancy1108, used under the MIT License. The original license is kept in
[`LICENSE.clutch`](./LICENSE.clutch).
