// Static checks on an L5X project: the review I do before touching a site program.
import { parseRung, instructions } from "../logix/engine.js";

const TIMERS = new Set(["TON", "TOF", "RTO"]), COUNTERS = new Set(["CTU", "CTD"]), EDGES = new Set(["ONS", "OSR", "OSF"]);
const WRITES = { OTE: [0], OTL: [0], OTU: [0], MOV: [1], CLR: [0], ADD: [2], SUB: [2], MUL: [2], DIV: [2], SCP: [5], OSR: [1], OSF: [1] };
const isTag = (a) => a && !/^[-+]?(\d|\.\d)/.test(a) && a !== "?" && a !== "S:FS";

export const RULES = {
  DUP_OTE: ["error", "Output energised (OTE) in more than one rung: the last rung scanned wins"],
  TOGGLE_ONE_RUNG: ["error", "Bit toggled with OTL/OTU in parallel legs of one rung: the second leg undoes the first"],
  EDGE_SHARED: ["error", "One-shot storage bit shared by several ONS/OSR/OSF instructions"],
  TIMER_SHARED: ["error", "Timer or counter driven by more than one instruction"],
  TIMER_NOT_RUN: ["error", "Timer/counter bits used but the timer/counter is never executed"],
  JSR_MISSING: ["error", "JSR to a routine that does not exist"],
  HMI_NO_HANDSHAKE: ["warning", "HMI command bit never cleared by the PLC: a dropped HMI connection can leave it set"],
  LATCH_NO_UNLATCH: ["warning", "Bit latched (OTL) but never unlatched or cleared"],
  SELF_RESET_TIMER: ["warning", "Self-resetting timer (its own .DN in its rung): loses time every cycle, drifts with scan time"],
  READ_NOT_WRITTEN: ["warning", "Internal bit examined but never written by logic or the HMI"],
  ROUTINE_NOT_CALLED: ["warning", "Routine is never called (no JSR) and is not a main routine"],
  TAG_UNUSED: ["info", "Controller tag not referenced in logic"],
};

export function lint(project) {
  const F = []; const add = (rule, where, detail) => F.push({ rule, severity: RULES[rule][0], where, detail });
  const uses = []; const routinesCalled = new Set(); const routineNames = new Map();
  for (const pr of project.programs) {
    routineNames.set(pr.name, new Set(pr.routines.map((r) => r.name)));
    for (const ro of pr.routines) ro.rungs.forEach((g, gi) => {
      const els = parseRung(g.text), where = `${pr.name}/${ro.name} rung ${gi}`;
      for (const ins of instructions(els)) {
        if (ins.op === "JSR") { routinesCalled.add(`${pr.name}/${ins.args[0]}`); if (!routineNames.get(pr.name).has(ins.args[0])) add("JSR_MISSING", where, ins.args[0]); continue; }
        ins.args.forEach((a, k) => { if (isTag(a)) uses.push({ tag: a, op: ins.op, write: (WRITES[ins.op] || []).includes(k) || (EDGES.has(ins.op) && k === 0), arg: k, where, text: g.text }); });
      }
      // toggle in one rung: legs XIC(x)..OTU(x) and XIO(x)..OTL(x)
      const scan = (list) => { for (const e of list) if (e.br) {
        const legs = e.br.map((l) => instructions(l));
        for (const a of legs) for (const b of legs) if (a !== b) {
          const u = a.find((i) => i.op === "OTU"), l = b.find((i) => i.op === "OTL");
          if (u && l && u.args[0] === l.args[0] && a.some((i) => i.op === "XIC" && i.args[0] === u.args[0]) && b.some((i) => i.op === "XIO" && i.args[0] === l.args[0])) add("TOGGLE_ONE_RUNG", where, u.args[0]);
        }
        e.br.forEach(scan);
      } };
      scan(els);
      // self-resetting timer
      for (const ins of instructions(els)) if (TIMERS.has(ins.op) && instructions(els).some((i) => i.op === "XIO" && i.args[0] === `${ins.args[0]}.DN`)) add("SELF_RESET_TIMER", where, ins.args[0]);
    });
  }
  const group = (f) => { const m = new Map(); for (const u of uses.filter(f)) { if (!m.has(u.tag)) m.set(u.tag, []); m.get(u.tag).push(u); } return m; };
  for (const [tag, us] of group((u) => u.op === "OTE")) { const rungs = new Set(us.map((u) => u.where)); if (rungs.size > 1) add("DUP_OTE", [...rungs].join("; "), tag); }
  for (const [tag, us] of group((u) => EDGES.has(u.op) && u.arg === 0)) if (us.length > 1) add("EDGE_SHARED", us.map((u) => u.where).join("; "), tag);
  for (const [tag, us] of group((u) => (TIMERS.has(u.op) || COUNTERS.has(u.op)) && u.arg === 0)) if (us.length > 1) add("TIMER_SHARED", us.map((u) => u.where).join("; "), tag);
  const driven = new Set(uses.filter((u) => (TIMERS.has(u.op) || COUNTERS.has(u.op)) && u.arg === 0).map((u) => u.tag));
  for (const u of uses) { const m = /^(.*)\.(DN|TT|EN|ACC|CU|CD)$/.exec(u.tag); if (m && !driven.has(m[1]) && project.tags.concat([]).length) {
    const base = m[1]; const t = typeOf(project, base); if ((t === "TIMER" || t === "COUNTER") && !F.some((f) => f.rule === "TIMER_NOT_RUN" && f.detail === base)) add("TIMER_NOT_RUN", u.where, base); } }
  const desc = (path) => descOf(project, path) || "";
  const cleared = new Set(uses.filter((u) => u.write && ["OTU", "OTE", "MOV", "CLR"].includes(u.op)).map((u) => u.tag));
  for (const tag of new Set(uses.filter((u) => /(^|\.)HMI_/.test(u.tag) && u.op === "XIC").map((u) => u.tag)))
    if (!cleared.has(tag) && !/maintained/i.test(desc(tag))) add("HMI_NO_HANDSHAKE", uses.find((u) => u.tag === tag).where, tag);
  const unlatched = new Set(uses.filter((u) => ["OTU", "CLR", "MOV", "OTE"].includes(u.op) && u.write).map((u) => u.tag));
  for (const [tag, us] of group((u) => u.op === "OTL")) if (!unlatched.has(tag)) add("LATCH_NO_UNLATCH", us[0].where, tag);
  const written = new Set(uses.filter((u) => u.write || TIMERS.has(u.op) || COUNTERS.has(u.op)).map((u) => u.tag));
  const external = (t) => /^(DI_|AI_|SP_)|(^|\.)HMI_/.test(t);
  for (const tag of new Set(uses.filter((u) => (u.op === "XIC" || u.op === "XIO") && !u.write).map((u) => u.tag))) {
    const base = tag.replace(/\.(DN|TT|EN|CU|CD)$/, "");
    if (!written.has(tag) && !written.has(base) && !external(tag)) add("READ_NOT_WRITTEN", uses.find((u) => u.tag === tag).where, tag);
  }
  for (const pr of project.programs) for (const ro of pr.routines) if (ro.name !== pr.main && !routinesCalled.has(`${pr.name}/${ro.name}`)) add("ROUTINE_NOT_CALLED", `${pr.name}/${ro.name}`, ro.name);
  const referenced = new Set(uses.map((u) => u.tag.split(".")[0]));
  for (const t of project.tags) if (!referenced.has(t.name)) add("TAG_UNUSED", t.name, t.desc || "");
  const order = { error: 0, warning: 1, info: 2 };
  return F.sort((a, b) => order[a.severity] - order[b.severity]);
}

function typeOf(project, path) {
  const types = Object.fromEntries(project.udts.map((u) => [u.name, Object.fromEntries(u.members.map((m) => [m.name, m.type]))]));
  const parts = path.split("."); let t = project.tags.find((x) => x.name === parts[0])?.type;
  for (const p of parts.slice(1)) t = types[t]?.[p];
  return t;
}
function descOf(project, path) {
  const parts = path.split("."); const tag = project.tags.find((x) => x.name === parts[0]); if (!tag) return null;
  if (parts.length === 1) return tag.desc;
  const u = project.udts.find((x) => x.name === tag.type); return u?.members.find((m) => m.name === parts[1])?.desc;
}

// CLI: node tools/lint.js file.L5X
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { loadL5X } = await import("../logix/load.js");
  const file = process.argv[2] || "LS01_LiftStation.L5X";
  const f = lint(loadL5X(file));
  for (const x of f) console.log(`${x.severity.padEnd(7)} ${x.rule.padEnd(20)} ${x.detail}  @ ${x.where}`);
  console.log(`${file}: ${f.filter((x) => x.severity === "error").length} errors, ${f.filter((x) => x.severity === "warning").length} warnings, ${f.filter((x) => x.severity === "info").length} info`);
  process.exitCode = f.some((x) => x.severity === "error") ? 1 : 0;
}
