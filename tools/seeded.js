// Troubleshooting study: six classic site edits seeded into the working program, one at a time.
// For each: does the linter flag it, which scenarios fail, and what the operator would see.
import { writeFileSync, mkdirSync } from "node:fs";
import { Controller } from "../logix/engine.js";
import { loadL5X } from "../logix/load.js";
import { lint } from "./lint.js";
import { makeScenarios, runScenario } from "../test/scenarios.js";
import { Rig } from "../sim/plant.js";

const clean = loadL5X(new URL("../LS01_LiftStation.L5X", import.meta.url).pathname);
const routine = (p, name) => p.programs.flatMap((pr) => pr.routines).find((r) => r.name === name);
const idx = (r, re) => { const i = r.rungs.findIndex((g) => re.test(g.text)); if (i < 0) throw new Error(`no rung ${re}`); return i; };
const addTag = (p, name, type, desc) => p.tags.push({ name, type, desc, ...(type === "TIMER" ? { init: { PRE: 1000 } } : {}) });

export const BUGS = [
  { id: "B-1", title: "Alternator rewritten as a one-rung toggle",
    symptom: "After the first cycle P2 leads every time; P1 sits idle and P2 wears out.",
    fix: "Toggle with a value (ADD and wrap, or XOR), or split into separate rungs; never OTU then OTL the same bit in parallel legs.",
    edit(p) { const r = routine(p, "R03_LeadLag"); addTag(p, "Lead_IsP2", "BOOL", "Lead is P2");
      const i = idx(r, /ADD\(Lead_Idx,1,Lead_Idx\)/);
      r.rungs.splice(i, 2, { comment: "Toggle lead", text: "XIC(Alt_Pulse)[XIC(Lead_IsP2)OTU(Lead_IsP2),XIO(Lead_IsP2)OTL(Lead_IsP2)];" },
        { comment: null, text: "[XIC(Lead_IsP2)MOV(1,Lead_Idx),XIO(Lead_IsP2)MOV(0,Lead_Idx)];" }); } },
  { id: "B-2", title: "Jog rung added for commissioning and left in",
    symptom: "Pump 1 never runs in AUTO: the jog rung, scanned later, writes the output off every scan.",
    fix: "One OTE per output: put the jog in the command logic (branch) or use a mode, not a second output rung.",
    edit(p) { const r = routine(p, "R30_Outputs"); addTag(p, "HMI_P1_Jog", "BOOL", "HMI jog P1");
      r.rungs.splice(1, 0, { comment: "Temporary jog for testing", text: "XIC(HMI_P1_Jog)OTE(DO_P1_Run);" }); } },
  { id: "B-3", title: "Acknowledge button without the PLC handshake",
    symptom: "If the HMI drops its connection mid-press, the ack bit stays set and every new alarm is acknowledged silently: the beacon never comes on.",
    fix: "PLC clears HMI request bits after use (OTU), and clears them all on first scan.",
    edit(p) { const r = routine(p, "R20_Alarms"); r.rungs.splice(idx(r, /^XIC\(HMI_AckAll\)OTU\(HMI_AckAll\);$/), 1);
      const m = routine(p, "R00_Main"); m.rungs[0].text = m.rungs[0].text.replace("OTU(HMI_AckAll),", ""); } },
  { id: "B-4", title: "Start counter copied from pump 1, one-shot tag not renamed",
    symptom: "Pump 2's start count climbs every scan while it runs (thousands of starts per cycle).",
    fix: "Every ONS/OSR/OSF needs its own storage bit; UDT members make that automatic.",
    edit(p) { const r = routine(p, "R11_Pump2"); const i = idx(r, /ONS\(P2\.Start_ONS\)/); r.rungs[i].text = r.rungs[i].text.replace("ONS(P2.Start_ONS)", "ONS(P1.Start_ONS)"); } },
  { id: "B-5", title: "Run hours from a self-resetting 1 s timer in the continuous task",
    symptom: "Run hours read low, and the error grows with scan time, so maintenance intervals slip.",
    fix: "Count in a periodic task (as shipped), or accumulate the timer's elapsed time rather than restarting it.",
    edit(p) { const t = p.programs.find((x) => x.name === "Totals"); t.routines[0].rungs.splice(0, 1);
      addTag(p, "P1_SecTmr", "TIMER", "P1 seconds timer");
      routine(p, "R10_Pump1").rungs.push({ comment: "Run seconds", text: "XIC(P1.RunFbk)XIO(P1_SecTmr.DN)TON(P1_SecTmr,?,?);" }, { comment: null, text: "XIC(P1_SecTmr.DN)ADD(P1.RunSec,1,P1.RunSec);" }); } },
  { id: "B-6", title: "Fail-to-start timer missing the feedback check",
    symptom: "Every pump faults 5 s after every start, then the other pump starts and faults too.",
    fix: "Time only 'commanded and not running': XIC(Cmd_Run) XIO(RunFbk).",
    edit(p) { for (const [rn, P] of [["R10_Pump1", "P1"], ["R11_Pump2", "P2"]]) { const r = routine(p, rn); const i = idx(r, /TON\(P\d\.FTS_Tmr/); r.rungs[i].text = `XIC(${P}.Cmd_Run)TON(${P}.FTS_Tmr,?,?);`; } } },
];

function runs(p) { const S = makeScenarios(Controller, p); return S.map((s) => { let r; try { r = runScenario(s); } catch (e) { r = { pass: false, msg: e.message }; } return { id: s.id, basic: s.basic, pass: r.pass, msg: r.msg }; }); }

const cleanLint = lint(clean), key = (f) => `${f.rule}|${f.detail}`, base = new Set(cleanLint.map(key));
const out = { clean: { lint: cleanLint, failing: runs(clean).filter((r) => !r.pass).map((r) => r.id) }, bugs: [] };
for (const b of BUGS) {
  const p = structuredClone(clean); b.edit(p);
  const L = lint(p).filter((f) => !base.has(key(f)));
  const R = runs(p).filter((r) => !r.pass);
  out.bugs.push({ id: b.id, title: b.title, symptom: b.symptom, fix: b.fix, lint: L.filter((f) => f.severity !== "info"), failing: R.map((r) => ({ id: r.id, basic: r.basic, msg: r.msg })) });
  console.log(b.id, "lint:", L.filter((f) => f.severity !== "info").map((f) => f.rule).join(",") || "-", "| failing:", R.map((r) => r.id).join(",") || "-");
}
// run-hour drift of B-5 vs the shipped periodic-task counter, by continuous-task scan time
const p5 = structuredClone(clean); BUGS[4].edit(p5); out.drift = [];
for (const dt of [2, 5, 10, 20, 50]) {
  const row = { scan_ms: dt };
  for (const [name, p] of [["periodic", clean], ["self_reset", p5]]) {
    const r = new Rig(Controller, p, { dt, plant: { level_pct: 50, inflow: () => 18 } }); r.plant.pumps[0].sel = "HAND";
    r.run(1); const s0 = r.T.P1.RunSec; r.run(3600); row[name] = r.T.P1.RunSec - s0;
  }
  row.self_reset_error_pct = +(100 * (row.self_reset - 3600) / 3600).toFixed(2); out.drift.push(row);
  console.log("drift", JSON.stringify(row));
}
mkdirSync("results", { recursive: true }); writeFileSync("results/troubleshooting.json", JSON.stringify(out, null, 1));
console.log("clean lint:", cleanLint.map((f) => `${f.severity}:${f.rule}:${f.detail}`).join(" | ") || "none");
