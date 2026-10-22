// Command Code's --output-format json: NDJSON, the last result line carries text, tokens and the real error.
import assert from "node:assert/strict";
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

console.log("adapters PASS");
