// GitHub Action entry (runs.using: node24).
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fmtBytes, parseBytes } from "./bytes.js";
import { formatMarkdown, formatText } from "./format.js";
import { mapPath } from "./run.js";

const input = (k: string, d = "") => (process.env[`INPUT_${k.replace(/ /g, "_").toUpperCase()}`] ?? "").trim() || d;
// Workflow-command escaping, per the toolkit: % CR LF in data, plus : and , in properties.
const esc = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const setOut = (k: string, v: string) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);

try {
  const path = resolve(process.env.GITHUB_WORKSPACE || process.cwd(), input("path", "."));
  const failOn = !/^(false|no|0|off)$/i.test(input("fail-on-permanent", "true"));
  const threshold = parseBytes(input("max-permanent", "0"));
  const r = mapPath(path, { thresholdBytes: threshold });
  console.log(formatText(r, { color: true, fix: true, width: 120 }));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, formatMarkdown(r) + "\n");
  setOut("permanent-bytes", String(r.totals.VE.bytes));
  setOut("permanent-places", String(r.totals.VE.places));
  setOut("slow-bytes", String(r.totals.AE.bytes));
  setOut("json", JSON.stringify({ root: r.root, totals: r.totals, permanent: r.findings.filter((f) => f.zone === "VE").slice(0, 20).map((f) => ({ path: f.path, bytes: f.bytes, why: f.why })) }));
  if (r.exitCode === 1) {
    for (const f of r.findings.filter((x) => x.zone === "VE").slice(0, 10))
      console.log(`::${failOn ? "error" : "warning"} title=undomap Zone VE (${fmtBytes(f.bytes)})::${esc(`${f.path} — ${f.why}${f.fix ? ". Fix: " + f.fix.say : ""}`)}`);
    if (failOn) process.exitCode = 1;
  }
} catch (e) {
  console.log(`::error title=undomap::${esc((e as Error).message)}`);
  process.exitCode = 2;
}
