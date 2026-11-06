// Mutation testing: make one small, realistic edit to the ladder (the kind a rushed site change
// makes), then check whether the tests notice. A mutant is "killed" if any scenario fails.
// Compares the short site-check set (basic) with the full scenario suite.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Controller, parseRung, unparse } from "../logix/engine.js";
import { loadL5X } from "../logix/load.js";
import { makeScenarios, runScenario } from "../test/scenarios.js";

const L5X = new URL("../LS01_LiftStation.L5X", import.meta.url).pathname;
const FLIP = { XIC: "XIO", XIO: "XIC", GRT: "GEQ", GEQ: "GRT", LES: "LEQ", LEQ: "LES", EQU: "NEQ", NEQ: "EQU", OTE: "OTL", OTL: "OTE", OSF: "OSR" };
const INPUTS = new Set(["XIC", "XIO", "ONS", "GRT", "GEQ", "LES", "LEQ", "EQU", "NEQ", "LIM"]);

function* walk(els, path = []) { // yields [els, index, element]
  for (let i = 0; i < els.length; i++) { const e = els[i]; yield [els, i, e]; if (e.br) for (const leg of e.br) yield* walk(leg); }
}
export function mutants(project) {
  const out = [];
  project.programs.forEach((pr, pi) => pr.routines.forEach((ro, ri) => ro.rungs.forEach((g, gi) => {
    const base = { pi, ri, gi, where: `${pr.name}/${ro.name} rung ${gi}`, before: g.text };
    const n = [...walk(parseRung(g.text))].length;
    for (let k = 0; k < n; k++) {
      const variants = [];
      const els = parseRung(g.text); const [arr, i, e] = [...walk(els)][k];
      if (e.op && FLIP[e.op]) variants.push(["flip", () => { e.op = FLIP[e.op]; }]);
      if (e.op && INPUTS.has(e.op) && arr.length > 1) variants.push(["delete", () => { arr.splice(i, 1); }]);
      if (e.br) e.br.forEach((_, L) => variants.push(["drop-leg", () => { const legs = e.br.filter((__, j) => j !== L); if (legs.length === 1) arr.splice(i, 1, ...legs[0]); else e.br = legs; }]));
      if (e.op) e.args.forEach((a, ai) => { if (/^-?\d+(\.\d+)?$/.test(a) && !(e.op === "JSR")) variants.push(["constant", () => { e.args[ai] = String(+a === 0 ? 1 : +a * 2); }]); });
      for (const [op] of variants) {
        const els2 = parseRung(g.text); const [arr2, i2, e2] = [...walk(els2)][k];
        const fn = { flip: () => { e2.op = FLIP[e2.op]; }, delete: () => arr2.splice(i2, 1) }[op];
        if (fn) { fn(); out.push({ ...base, op, after: unparse(els2) + ";" }); }
      }
      if (e.br) e.br.forEach((_, L) => { const els2 = parseRung(g.text); const [arr2, i2, e2] = [...walk(els2)][k]; const legs = e2.br.filter((__, j) => j !== L); if (legs.length === 1) arr2.splice(i2, 1, ...legs[0]); else e2.br = legs; out.push({ ...base, op: "drop-leg", after: unparse(els2) + ";" }); });
      if (e.op) e.args.forEach((a, ai) => { if (/^-?\d+(\.\d+)?$/.test(a) && e.op !== "JSR") { const els2 = parseRung(g.text); const [, , e2] = [...walk(els2)][k]; e2.args[ai] = String(+a === 0 ? 1 : +a * 2); out.push({ ...base, op: "constant", after: unparse(els2) + ";" }); } });
    }
    if (!/^JSR/.test(g.text)) out.push({ ...base, op: "delete-rung", after: "NOP();" });
  })));
  project.tags.forEach((t, ti) => Object.entries(t.init || {}).forEach(([k, v]) => { if (/PRE$/.test(k) && v > 0) out.push({ tag: ti, key: k, where: `${t.name}.${k}`, op: "preset", before: String(v), after: String(v * 2) }); }));
  return out.map((m, id) => ({ id, ...m }));
}
export function apply(project, m) {
  const p = structuredClone(project);
  if (m.op === "preset") p.tags[m.tag].init[m.key] = +m.after;
  else p.programs[m.pi].routines[m.ri].rungs[m.gi].text = m.after;
  return p;
}

function evaluate(project, m, order) {
  const p = apply(project, m); let scen;
  try { scen = makeScenarios(Controller, p); new Controller(p); } catch (e) { return { id: m.id, verify: false }; }
  const res = { id: m.id, verify: true, basicKill: null, fullKill: null };
  for (const id of order) {
    const s = scen.find((x) => x.id === id); let r;
    try { r = runScenario(s); } catch (e) { r = { pass: false, msg: "runtime error: " + e.message }; }
    if (!r.pass) { if (s.basic && !res.basicKill) res.basicKill = id; if (!res.fullKill) res.fullKill = id; }
    if (res.fullKill && (res.basicKill || !order.slice(order.indexOf(id) + 1).some((x) => scen.find((y) => y.id === x).basic))) break;
  }
  return res;
}

if (isMainThread) {
  const project = loadL5X(L5X), all = mutants(project);
  // cheap scenarios first; basic ones first so the basic verdict is always known
  const timing = makeScenarios(Controller, project).map((s) => ({ id: s.id, basic: s.basic, ms: runScenario(s).ms }));
  const order = [...timing].sort((a, b) => (b.basic - a.basic) || a.ms - b.ms).map((s) => s.id);
  const nW = Math.max(1, Math.min(os.availableParallelism?.() || 2, 4)); const results = []; let next = 0; const t0 = Date.now();
  await new Promise((done) => {
    let live = nW;
    for (let w = 0; w < nW; w++) {
      const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { order } });
      const feed = () => { if (next < all.length) wk.postMessage(all[next++]); else { wk.terminate(); if (--live === 0) done(); } };
      wk.on("message", (r) => { results.push(r); if (results.length % 50 === 0) console.log(`${results.length}/${all.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`); feed(); });
      wk.on("error", (e) => { console.error(e); process.exit(1); });
      feed();
    }
  });
  results.sort((a, b) => a.id - b.id);
  const rows = all.map((m) => ({ ...m, ...results.find((r) => r.id === m.id) })).filter((r) => r.verify);
  const by = {};
  for (const r of rows) { const b = (by[r.op] ||= { n: 0, basic: 0, full: 0 }); b.n++; if (r.basicKill) b.basic++; if (r.fullKill) b.full++; }
  const out = { generated: all.length, rejected_by_verify: all.length - rows.length, valid: rows.length,
    killed_basic: rows.filter((r) => r.basicKill).length, killed_full: rows.filter((r) => r.fullKill).length, by_operator: by,
    killers: Object.fromEntries(order.map((id) => [id, rows.filter((r) => r.fullKill === id).length])),
    survivors: rows.filter((r) => !r.fullKill).map(({ id, op, where, before, after }) => ({ id, op, where, before, after })),
    basic_misses: rows.filter((r) => !r.basicKill && r.fullKill).map(({ id, op, where, before, after, fullKill }) => ({ id, op, where, before, after, caught_by: fullKill })),
    seconds: (Date.now() - t0) / 1000, workers: nW };
  mkdirSync("results", { recursive: true }); writeFileSync("results/mutation.json", JSON.stringify(out, null, 1));
  console.log(`valid ${out.valid} (verify rejected ${out.rejected_by_verify}); basic kills ${out.killed_basic} (${(100 * out.killed_basic / out.valid).toFixed(1)}%), full kills ${out.killed_full} (${(100 * out.killed_full / out.valid).toFixed(1)}%); ${out.survivors.length} survivors; ${out.seconds.toFixed(0)} s`);
} else {
  const project = loadL5X(L5X);
  parentPort.on("message", (m) => parentPort.postMessage(evaluate(project, m, workerData.order)));
}
