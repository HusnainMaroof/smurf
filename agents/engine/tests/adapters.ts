// Command Code's --output-format json: NDJSON, the last result line carries text, tokens and the real error.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { parseCommandCode } from "../src/adapters/cli.ts";

const ok = parseCommandCode(
  [
    '{"type":"system","subtype":"init","model":"deepseek/deepseek-v4-flash"}',
    '{"type":"result","subtype":"success","finalText":"done","usage":{"inputTokens":10,"outputTokens":5,"cacheReadTokens":3,"cacheWriteTokens":0}}',
  ].join("\n"),
);
assert.deepEqual(ok, { text: "done", isError: false, error: "", tokensIn: 10, tokensCached: 3, tokensOut: 5 });

const bad = parseCommandCode(
  [
    '{"type":"system","subtype":"init"}',
    '{"type":"result","subtype":"error","usage":{"inputTokens":0,"outputTokens":0,"cacheReadTokens":0,"cacheWriteTokens":0},"finalText":"","error":"Error: Insufficient credits for Command Code."}',
  ].join("\n"),
);
assert.equal(bad?.isError, true);
assert.equal(bad?.error, "Error: Insufficient credits for Command Code.");
assert.equal(bad?.tokensIn, 0);

// no result line: not parseable
assert.equal(parseCommandCode("not json"), null);

// the Freebuff driver always ends with a JSON line the claude-json parser reads, even when it cannot start
const fb = spawnSync(process.execPath, ["scripts/freebuff_drive.cjs", "run", "--cwd", ".", "--prompt-file", "nope.txt"], {
  encoding: "utf8",
  env: { ...process.env, FREEBUFF_BIN: "/no/such/freebuff" },
});
const last = JSON.parse(fb.stdout.trim().split("\n").pop()!);
assert.equal(last.is_error, true);
assert.match(fb.stdout, /error: crash: (Freebuff binary not found|node-pty not found)/);

console.log("adapters PASS");
