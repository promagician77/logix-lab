// Copies the engine, the L5X and measured results into site/ (static, Vercel-ready).
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { Controller } from "../logix/engine.js";
import { loadL5X } from "../logix/load.js";
import { Rig } from "../sim/plant.js";
import { makeScenarios, runScenario } from "../test/scenarios.js";

const S = "site";
for (const d of ["lib", "data", "fonts", "hmi"]) mkdirSync(`${S}/${d}`, { recursive: true });
cpSync("logix/engine.js", `${S}/lib/engine.js`); cpSync("logix/l5x.js", `${S}/lib/l5x.js`); cpSync("sim/plant.js", `${S}/lib/plant.js`);
cpSync("LS01_LiftStation.L5X", `${S}/LS01_LiftStation.L5X`);
for (const f of ["ibm-plex-sans-latin-400-normal", "ibm-plex-sans-latin-500-normal", "ibm-plex-sans-latin-600-normal", "ibm-plex-sans-latin-700-normal"]) cpSync(`node_modules/@fontsource/ibm-plex-sans/files/${f}.woff2`, `${S}/fonts/${f}.woff2`);
for (const f of ["ibm-plex-mono-latin-400-normal", "ibm-plex-mono-latin-500-normal", "ibm-plex-mono-latin-600-normal"]) cpSync(`node_modules/@fontsource/ibm-plex-mono/files/${f}.woff2`, `${S}/fonts/${f}.woff2`);

// scenarios with recorded series, and total simulated plant time
const project = loadL5X("LS01_LiftStation.L5X");
let simMs = 0; const step0 = Rig.prototype.step; Rig.prototype.step = function () { simMs += this.dt; return step0.call(this); };
const results = makeScenarios(Controller, project).map((s) => ({ ...runScenario(s, ["F3", "F14"].includes(s.id)), name: s.name, basic: s.basic }));
Rig.prototype.step = step0;
// time the suite without recording
const timed = makeScenarios(Controller, project).map((s) => runScenario(s));
results.forEach((r, i) => { r.ms = timed[i].ms; });
writeFileSync(`${S}/data/scenarios.json`, JSON.stringify({ results, sim_hours: simMs / 3.6e6 }));
console.log(`scenarios: ${results.filter((r) => r.pass).length}/${results.length} pass, ${(simMs / 3.6e6).toFixed(1)} h simulated, ${(timed.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1)} s`);

const mu = JSON.parse(readFileSync("results/mutation.json", "utf8"));
const notes = existsSync("results/survivor_notes.json") ? JSON.parse(readFileSync("results/survivor_notes.json", "utf8")) : {};
mu.survivors.forEach((x) => { x.note = notes[x.id] || ""; });
if (existsSync("results/mutation_round1.json")) { const r1 = JSON.parse(readFileSync("results/mutation_round1.json", "utf8")); mu.round1 = { valid: r1.valid, killed_full: r1.killed_full, killed_basic: r1.killed_basic, scenarios: 25 }; }
writeFileSync(`${S}/data/mutation.json`, JSON.stringify(mu));
cpSync("results/troubleshooting.json", `${S}/data/troubleshooting.json`);

// HMI reference lists (FactoryTalk View direct references)
const alarms = project.tags.filter((t) => t.type === "UDT_Alarm");
writeFileSync("hmi/alarms.csv", "Trigger (direct reference),Message,Acknowledge,Notes\n" + alarms.map((a) => `{[PLC]${a.name}.Active},${a.desc},{[PLC]HMI_AckAll} (PLC clears),Unack state: {[PLC]${a.name}.Unack}`).join("\n") + "\n");
const rows = [["Level %", "LT101_Pct", "R", ""], ["Level mA", "AI_LT101_mA", "R", ""], ["Float backup mode", "LT101_Bad", "R", "Show as abnormal (amber)"], ["Beacon / unacked", "ALM_AnyUnack", "R", ""],
  ...[1, 2].flatMap((n) => [[`P${n} running`, `P${n}.RunFbk`, "R", ""], [`P${n} fault`, `P${n}.Fault`, "R", "Red only when true"], [`P${n} fail to start`, `P${n}.Flt_FTS`, "R", ""], [`P${n} overload`, `P${n}.Flt_OL`, "R", ""],
    [`P${n} uncommanded run`, `P${n}.Flt_Uncmd`, "R", ""], [`P${n} available`, `P${n}.Avail`, "R", ""], [`P${n} in AUTO`, `P${n}.HOA_Auto`, "R", ""], [`P${n} in HAND`, `P${n}.HOA_Hand`, "R", ""],
    [`P${n} is lead`, `P${n}_IsLead`, "R", ""], [`P${n} starts`, `P${n}.Starts`, "R", ""], [`P${n} run hours`, `P${n}.RunHrs`, "R", ""],
    [`P${n} reset button`, `P${n}.HMI_Reset`, "W", "Set to 1 only; PLC clears (handshake). Do not use a momentary button that writes 0 on release."], [`P${n} out of service`, `P${n}.HMI_OOS`, "W", "Maintained toggle"]]),
  ["Acknowledge all", "HMI_AckAll", "W", "Set to 1 only; PLC clears"], ["Reset LT disagreement", "HMI_LTReset", "W", "Set to 1 only; PLC clears"],
  ...["LeadOn", "LagOn", "AllOff", "HighAlm"].flatMap((k) => [[`Setpoint ${k} entry`, `SP_${k}`, "W", "Numeric entry 5-95; PLC validates"], [`Setpoint ${k} in use`, `SPV_${k}`, "R", "Display next to the entry"]]), ["Setpoints rejected", "ALM_SPInvalid.Active", "R", ""]];
writeFileSync("hmi/hmi_tags.csv", "Display item,Direct reference,Access,Notes\n" + rows.map(([a, t, rw, n]) => `${a},{[PLC]${t}},${rw},"${n}"`).join("\n") + "\n");
cpSync("hmi", `${S}/hmi`, { recursive: true });
console.log("site exported");
