// Graphify code map -> vault/Code/<project>/. Uses `graphify update` (AST only,
// no LLM, no tokens), then exports one Obsidian note per code node and community.
import fs from "node:fs";
import path from "node:path";
import type { Project } from "./types.ts";
import { git, posix, ROOT, shell } from "./util.ts";

export async function buildCodeGraph(p: Project, vaultCode: string, graphify = "graphify") {
  const env = { PYTHONIOENCODING: "utf-8" };
  if (!(await shell(`command -v ${graphify}`, { cwd: p.repo, timeoutMs: 10_000 })).out.trim())
    throw new Error("Graphify not found. Install it (needs Python): pip install graphifyy");
  // keep graphify-out/ out of the owner's git status
  const exclude = path.join(p.repo, ".git", "info", "exclude");
  if (fs.existsSync(path.dirname(exclude)) && !(fs.existsSync(exclude) && fs.readFileSync(exclude, "utf8").includes("graphify-out/")))
    fs.appendFileSync(exclude, "\ngraphify-out/\n");
  const r = await shell(`${graphify} update . --force`, { cwd: p.repo, timeoutMs: 60 * 60_000, env });
  const src = path.join(p.repo, "graphify-out");
  if (!fs.existsSync(path.join(src, "graph.json"))) throw new Error(`graphify failed:\n${r.out.slice(-2000)}`);
  fs.rmSync(vaultCode, { recursive: true, force: true });
  fs.mkdirSync(vaultCode, { recursive: true });
  for (const f of ["GRAPH_REPORT.md", "graph.json", "graph.html"]) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(vaultCode, f));
  const script = posix(path.join(ROOT, "scripts", "graphify_obsidian.py"));
  const notes = await shell(`python -I '${script}' '${posix(path.join(vaultCode, "graph.json"))}' '${posix(path.join(vaultCode, "notes"))}'`, { cwd: vaultCode, timeoutMs: 10 * 60_000, env });
  const summary = r.out.match(/Rebuilt: ([^\r\n]+)/)?.[1] ?? "graph built";
  return { summary, notes: Number(notes.out.trim().split("\n").pop()) || 0, head: git(p.repo, "rev-parse", "--short", "HEAD").out };
}
