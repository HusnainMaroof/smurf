# Tauri shell (`src-tauri`)

Hosts the React UI in a native window. It does not start any backend: the UI talks to
smurf-server (Docker, `http://127.0.0.1:47821`) directly. See `../README.md`.

Native commands exposed to the UI: host OS / CPU arch, macOS folder picker, open a path
with the OS default app. The dialog plugin provides the cross-platform folder picker.
