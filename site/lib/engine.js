// Logix 5000 ladder engine: parses Rockwell neutral rung text, compiles each routine to a
// JavaScript function and runs controller scans (continuous + periodic tasks).
// Instruction semantics follow the Logix 5000 General Instructions reference for the
// subset implemented below; anything else is rejected at compile time (like Verify).

export const ATOMIC = new Set(["BOOL", "SINT", "INT", "DINT", "REAL"]);
const CMP = { GRT: ">", GEQ: ">=", LES: "<", LEQ: "<=", EQU: "===", NEQ: "!==" };
const MATH = { ADD: "+", SUB: "-", MUL: "*", DIV: "/" };
export const INSTR = new Set(["XIC", "XIO", "OTE", "OTL", "OTU", "ONS", "OSR", "OSF", "TON", "TOF", "RTO", "CTU", "CTD", "RES", "MOV", "CLR", "SCP", "LIM", "JSR", "NOP", "AFI", ...Object.keys(CMP), ...Object.keys(MATH)]);
export const OUTPUT = new Set(["OTE", "OTL", "OTU", "OSR", "OSF", "TON", "TOF", "RTO", "CTU", "CTD", "RES", "MOV", "CLR", "SCP", "JSR", ...Object.keys(MATH)]);

/* ---------- parsing ---------- */
export function parseRung(text) {
  const s = text.trim(); let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  function seq(stops) {
    const out = [];
    for (;;) {
      ws(); const c = s[i];
      if (c === undefined) throw new Error("rung must end with ';'");
      if (stops.includes(c)) return out;
      if (c === "[") {
        i++; const legs = [];
        for (;;) { legs.push(seq(",]")); if (s[i] === ",") { i++; continue; } i++; break; }
        if (legs.length < 2) throw new Error("branch needs two legs");
        out.push({ br: legs }); continue;
      }
      const m = /^[A-Z][A-Z0-9_]*/.exec(s.slice(i));
      if (!m) throw new Error(`unexpected '${c}' at ${i}`);
      i += m[0].length; ws();
      if (s[i] !== "(") throw new Error(`'(' expected after ${m[0]}`);
      i++; let depth = 0, cur = ""; const args = [];
      for (;;) {
        const ch = s[i++];
        if (ch === undefined) throw new Error(`unclosed ${m[0]}(`);
        if (ch === "(" || ch === "[") { depth++; cur += ch; continue; }
        if ((ch === ")" || ch === "]") && depth > 0) { depth--; cur += ch; continue; }
        if (ch === ")") { if (cur.trim() !== "" || args.length) args.push(cur.trim()); break; }
        if (ch === "," && depth === 0) { args.push(cur.trim()); cur = ""; continue; }
        cur += ch;
      }
      out.push({ op: m[0], args });
    }
  }
  const body = seq(";"); i++; ws();
  if (i !== s.length) throw new Error("text after ';'");
  return body;
}

export function unparse(els) {
  return els.map((e) => (e.br ? "[" + e.br.map(unparse).join(",") + "]" : `${e.op}(${e.args.join(",")})`)).join("");
}

/* walk every instruction in order (top branch leg first), giving it a sequential id */
export function instructions(els, out = []) {
  for (const e of els) { if (e.br) e.br.forEach((l) => instructions(l, out)); else out.push(e); }
  return out;
}

/* ---------- data types ---------- */
const BUILTIN = {
  TIMER: { PRE: "DINT", ACC: "DINT", EN: "BOOL", TT: "BOOL", DN: "BOOL" },
  COUNTER: { PRE: "DINT", ACC: "DINT", CU: "BOOL", CD: "BOOL", DN: "BOOL", OV: "BOOL", UN: "BOOL" },
};
export function makeTypes(udts) {
  const T = { ...BUILTIN };
  for (const u of udts) T[u.name] = Object.fromEntries(u.members.map((m) => [m.name, m.type]));
  return T;
}
function instantiate(types, type) {
  if (ATOMIC.has(type)) return 0;
  const def = types[type]; if (!def) throw new Error(`unknown data type ${type}`);
  return Object.fromEntries(Object.entries(def).map(([k, t]) => [k, instantiate(types, t)]));
}
export function typeOfPath(types, tagTypes, path) {
  const parts = path.split(".");
  let t = tagTypes[parts[0]]; if (!t) return null;
  for (const p of parts.slice(1)) { const def = types[t]; if (!def || !(p in def)) return null; t = def[p]; }
  return t;
}
export function buildTags(project) {
  const types = makeTypes(project.udts), tagTypes = {}, tags = {};
  for (const tg of project.tags) {
    tagTypes[tg.name] = tg.type; tags[tg.name] = instantiate(types, tg.type);
    if (ATOMIC.has(tg.type)) { if (tg.value != null) tags[tg.name] = tg.value; }
    else for (const [k, v] of Object.entries(tg.init || {})) setPath(tags[tg.name], k, v);
  }
  return { types, tagTypes, tags };
}
function setPath(obj, path, v) { const p = path.split("."); let o = obj; for (const k of p.slice(0, -1)) o = o[k]; o[p.at(-1)] = v; }
export function getPath(tags, path) { let o = tags; for (const k of path.split(".")) { if (o == null) return undefined; o = o[k]; } return o; }

/* ---------- compiler ---------- */
const NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
export const rt = {
  dint(v) { const r = Math.round(v); return (Math.abs(v % 1) === 0.5 ? 2 * Math.round(v / 2) : r) | 0; },
  ton(t, r, dt) {
    if (r) {
      if (!t.EN) { t.EN = 1; if (t.ACC >= t.PRE) { t.DN = 1; t.TT = 0; } else { t.TT = 1; t.DN = 0; } }
      else if (!t.DN) { t.ACC += dt; if (t.ACC >= t.PRE) { t.ACC = t.PRE; t.DN = 1; t.TT = 0; } }
    } else { t.EN = 0; t.TT = 0; t.DN = 0; t.ACC = 0; }
  },
  tof(t, r, dt) {
    if (r) { t.EN = 1; t.TT = 0; t.DN = 1; t.ACC = 0; }
    else if (t.EN) { t.EN = 0; if (t.DN) t.TT = 1; }
    else if (t.TT) { t.ACC += dt; if (t.ACC >= t.PRE) { t.ACC = t.PRE; t.DN = 0; t.TT = 0; } }
  },
  rto(t, r, dt) {
    if (r) { if (!t.EN) t.EN = 1; else if (!t.DN) t.ACC += dt; if (t.ACC >= t.PRE) { t.DN = 1; t.TT = 0; } else t.TT = 1; }
    else { t.EN = 0; t.TT = 0; t.DN = t.ACC >= t.PRE ? 1 : 0; }
  },
  ctu(c, r) { if (r && !c.CU) { c.ACC = (c.ACC + 1) | 0; } c.CU = r ? 1 : 0; c.DN = c.ACC >= c.PRE ? 1 : 0; },
  ctd(c, r) { if (r && !c.CD) { c.ACC = (c.ACC - 1) | 0; } c.CD = r ? 1 : 0; c.DN = c.ACC >= c.PRE ? 1 : 0; },
  res(x) { for (const k of ["ACC", "EN", "TT", "DN", "CU", "CD", "OV", "UN"]) if (k in x) x[k] = 0; },
};

export function compileRoutine(rungs, env, routineNames) {
  // env: {types, tagTypes}; returns {fn, map:[{rung, id, op, args}], nInstr}
  let id = 0; const map = [], errors = [];
  const ref = (p, rung) => {
    if (p === "S:FS") return "ctx.fs";
    const t = typeOfPath(env.types, env.tagTypes, p);
    if (t == null) { errors.push(`rung ${rung}: unknown tag '${p}'`); return "0"; }
    return "T" + p.split(".").map((k) => `[${JSON.stringify(k)}]`).join("");
  };
  const val = (p, rung) => (NUM.test(p) ? String(Number(p)) : ref(p, rung));
  const kind = (p) => (p === "S:FS" ? "BOOL" : typeOfPath(env.types, env.tagTypes, p));
  const conv = (p, expr) => { const k = kind(p); return k === "REAL" ? `(+(${expr}))` : k === "BOOL" ? `((${expr})?1:0)` : `rt.dint(${expr})`; };
  const need = (e, n, rung) => { if (e.args.length !== n) errors.push(`rung ${rung}: ${e.op} expects ${n} operands, got ${e.args.length}`); };
  const isBool = (p) => p === "S:FS" || kind(p) === "BOOL";
  const isStruct = (p, ty) => kind(p) === ty;

  function gen(els, rung) {
    let code = "";
    for (const e of els) {
      if (e.br) {
        code += `{const b_=r;let o_=0;` + e.br.map((leg) => `{let r=b_;${gen(leg, rung)}o_|=r;}`).join("") + `r=o_;}`;
        continue;
      }
      const a = e.args, my = id++; map.push({ rung, id: my, op: e.op, args: a });
      let c = "";
      switch (e.op) {
        case "XIC": case "XIO": need(e, 1, rung); if (!isBool(a[0])) errors.push(`rung ${rung}: ${e.op} needs a BOOL, '${a[0]}' is ${kind(a[0])}`);
          c = `t=${ref(a[0], rung)}?${e.op === "XIC" ? "1:0" : "0:1"};r&=t;`; break;
        case "OTE": need(e, 1, rung); c = `${ref(a[0], rung)}=r;t=r;`; break;
        case "OTL": need(e, 1, rung); c = `if(r)${ref(a[0], rung)}=1;t=${ref(a[0], rung)};`; break;
        case "OTU": need(e, 1, rung); c = `if(r)${ref(a[0], rung)}=0;t=${ref(a[0], rung)};`; break;
        case "ONS": need(e, 1, rung); { const s = ref(a[0], rung); c = `if(r){t=${s}?0:1;${s}=1;r=t;}else{${s}=0;t=0;}`; } break;
        case "OSR": need(e, 2, rung); { const s = ref(a[0], rung), o = ref(a[1], rung); c = `if(r){${o}=${s}?0:1;${s}=1;}else{${s}=0;${o}=0;}t=${o};`; } break;
        case "OSF": need(e, 2, rung); { const s = ref(a[0], rung), o = ref(a[1], rung); c = `if(r){${s}=1;${o}=0;}else{${o}=${s};${s}=0;}t=${o};`; } break;
        case "TON": case "TOF": case "RTO": need(e, 3, rung); if (!isStruct(a[0], "TIMER")) errors.push(`rung ${rung}: ${e.op} needs a TIMER`);
          c = `rt.${e.op.toLowerCase()}(${ref(a[0], rung)},r,ctx.dt);t=r;`; break;
        case "CTU": case "CTD": need(e, 3, rung); if (!isStruct(a[0], "COUNTER")) errors.push(`rung ${rung}: ${e.op} needs a COUNTER`);
          c = `rt.${e.op.toLowerCase()}(${ref(a[0], rung)},r);t=r;`; break;
        case "RES": need(e, 1, rung); c = `if(r)rt.res(${ref(a[0], rung)});t=r;`; break;
        case "MOV": need(e, 2, rung); c = `if(r)${ref(a[1], rung)}=${conv(a[1], val(a[0], rung))};t=r;`; break;
        case "CLR": need(e, 1, rung); c = `if(r)${ref(a[0], rung)}=0;t=r;`; break;
        case "SCP": need(e, 6, rung); { const [x, i0, i1, o0, o1, d] = a.map((p) => val(p, rung));
          c = `if(r)${ref(a[5], rung)}=${conv(a[5], `(${x}-${i0})*(${o1}-${o0})/(${i1}-${i0})+${o0}`)};t=r;`; void d; } break;
        case "LIM": need(e, 3, rung); { const [lo, x, hi] = a.map((p) => val(p, rung));
          c = `t=(${lo}<=${hi})?((${lo}<=${x}&&${x}<=${hi})?1:0):((${x}>=${lo}||${x}<=${hi})?1:0);r&=t;`; } break;
        case "JSR": if (!routineNames.has(a[0])) errors.push(`rung ${rung}: JSR to missing routine '${a[0]}'`);
          c = `if(r)ctx.jsr(${JSON.stringify(a[0])});t=r;`; break;
        case "NOP": c = `t=r;`; break;
        case "AFI": c = `r=0;t=0;`; break;
        default:
          if (CMP[e.op]) { need(e, 2, rung); c = `t=(${val(a[0], rung)}${CMP[e.op]}${val(a[1], rung)})?1:0;r&=t;`; }
          else if (MATH[e.op]) { need(e, 3, rung); c = `if(r)${ref(a[2], rung)}=${conv(a[2], `${val(a[0], rung)}${MATH[e.op]}${val(a[1], rung)}`)};t=r;`; }
          else errors.push(`rung ${rung}: instruction ${e.op} not supported`);
      }
      code += `{const i=r;let t=0;${c}if(tr)tr[${my}]=i|(r<<1)|(t<<2);}`;
    }
    return code;
  }
  let body = "";
  rungs.forEach((rg, n) => {
    let els; try { els = parseRung(rg.text); } catch (err) { errors.push(`rung ${n}: ${err.message}`); return; }
    body += `/*${n}*/{let r=1;${gen(els, n)}if(rp)rp[${n}]=r;}\n`;
  });
  if (errors.length) { const e = new Error(errors.join("\n")); e.errors = errors; throw e; }
  // eslint-disable-next-line no-new-func
  const fn = new Function("T", "ctx", "rt", "tr", "rp", body);
  return { fn, map, nInstr: id };
}

/* ---------- controller ---------- */
export class Controller {
  constructor(project) {
    this.project = project;
    const { types, tagTypes, tags } = buildTags(project);
    this.types = types; this.tagTypes = tagTypes; this.T = tags;
    this.routines = {}; this.programs = {};
    for (const p of project.programs) {
      const names = new Set(p.routines.map((r) => r.name));
      for (const r of p.routines) {
        const key = `${p.name}/${r.name}`;
        try { this.routines[key] = { ...compileRoutine(r.rungs, { types, tagTypes }, names), program: p.name, name: r.name, rungs: r.rungs }; }
        catch (e) { e.message = `${key}: ${e.message}`; throw e; }
      }
      this.programs[p.name] = p;
    }
    this.tasks = project.tasks.map((t) => ({ ...t, acc: 0 }));
    this.trace = null; this.fs = 1; this.scans = 0; this.time = 0;
  }
  enableTrace(on = true) {
    this.trace = on ? Object.fromEntries(Object.entries(this.routines).map(([k, r]) => [k, { tr: new Uint8Array(r.nInstr), rp: new Uint8Array(r.rungs.length) }])) : null;
  }
  runProgram(pname, dt) {
    const p = this.programs[pname];
    const ctx = { dt, fs: this.fs, jsr: (name) => call(name) };
    const call = (name) => {
      const k = `${pname}/${name}`, r = this.routines[k], tb = this.trace && this.trace[k];
      r.fn(this.T, ctx, rt, tb ? tb.tr : null, tb ? tb.rp : null);
    };
    call(p.main);
  }
  /* one continuous-task scan of dt ms; periodic tasks run when their period elapses */
  scan(dt) {
    this.time += dt;
    for (const t of this.tasks) if (t.type === "PERIODIC") {
      t.acc += dt;
      while (t.acc >= t.rate) { t.acc -= t.rate; for (const p of t.programs) this.runProgram(p, t.rate); }
    }
    for (const t of this.tasks) if (t.type === "CONTINUOUS") for (const p of t.programs) this.runProgram(p, dt);
    this.fs = 0; this.scans++;
  }
  get(path) { return getPath(this.T, path); }
  set(path, v) { const p = path.split("."); let o = this.T; for (const k of p.slice(0, -1)) o = o[k]; o[p.at(-1)] = v; }
}
