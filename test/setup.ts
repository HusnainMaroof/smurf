// setup: the fresh-clone bootstrap helpers (local config, tool report).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolReport, writeLocal } from "../scripts/setup.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-setup-"));
fs.mkdirSync(path.join(tmp, "config"));
const local = path.join(tmp, "config", "local.json");

// first call creates config/local.json, later calls leave it alone
assert.equal(writeLocal(tmp), true);
assert.ok(fs.existsSync(local));
assert.equal(writeLocal(tmp), false);

// a file the owner edited in between is never overwritten
fs.writeFileSync(local, "{}\n");
assert.equal(writeLocal(tmp), false);
assert.equal(fs.readFileSync(local, "utf8"), "{}\n");

// only enabled cli providers get a line
const lines = toolReport({
  a: { kind: "cli", enabled: true, command: "node" },
  b: { kind: "cli", enabled: true, command: "no-such-tool-xyz" },
  c: { kind: "cli", enabled: false, command: "node" },
  d: { kind: "api", enabled: true },
});
assert.equal(lines.length, 2, lines.join("\n"));
assert.ok(lines[0].startsWith("ok"), lines[0]);
assert.ok(lines[1].startsWith("missing"), lines[1]);
assert.match(lines[1], /no-such-tool-xyz/);

console.log("setup PASS");
