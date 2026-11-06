// SVG ladder view with live power flow, drawn from the routine's neutral rung text.
import { parseRung } from "./lib/engine.js";

const NS = "http://www.w3.org/2000/svg";
const CW = 6.6, WY = 30, ROW = 56, BX = 12;
const svg = (tag, a = {}, p) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
const CONTACT = new Set(["XIC", "XIO"]), COIL = new Set(["OTE", "OTL", "OTU"]);
const BOXDEF = {
  TON: ["Timer On Delay", ["Timer", "Preset", "Accum"]], TOF: ["Timer Off Delay", ["Timer", "Preset", "Accum"]], RTO: ["Retentive Timer On", ["Timer", "Preset", "Accum"]],
  CTU: ["Count Up", ["Counter", "Preset", "Accum"]], MOV: ["Move", ["Source", "Dest"]], ADD: ["Add", ["Source A", "Source B", "Dest"]],
  SUB: ["Subtract", ["Source A", "Source B", "Dest"]], MUL: ["Multiply", ["Source A", "Source B", "Dest"]], DIV: ["Divide", ["Source A", "Source B", "Dest"]],
  GRT: ["Greater Than (A>B)", ["Source A", "Source B"]], GEQ: ["Grtr Than or Eql (A>=B)", ["Source A", "Source B"]], LES: ["Less Than (A<B)", ["Source A", "Source B"]],
  LEQ: ["Less Than or Eql (A<=B)", ["Source A", "Source B"]], EQU: ["Equal", ["Source A", "Source B"]], NEQ: ["Not Equal", ["Source A", "Source B"]],
  LIM: ["Limit Test", ["Low Limit", "Test", "High Limit"]], SCP: ["Scale w/ Parameters", ["Input", "Input Min", "Input Max", "Scaled Min", "Scaled Max", "Output"]],
  JSR: ["Jump To Subroutine", ["Routine"]], ONS: ["", ["Storage"]], OSF: ["One Shot Falling", ["Storage Bit", "Output Bit"]], OSR: ["One Shot Rising", ["Storage Bit", "Output Bit"]],
  RES: ["", ["Reset"]], CLR: ["Clear", ["Dest"]],
};

function layout(els, ctr) {
  const items = els.map((e) => {
    if (e.br) { const legs = e.br.map((l) => layout(l, ctr)); return { k: "br", legs, w: Math.max(...legs.map((l) => l.w)) + 2 * BX, h: legs.reduce((s, l) => s + l.h, 0) }; }
    const id = ctr.n++;
    if (CONTACT.has(e.op) || COIL.has(e.op)) return { k: "sym", e, id, w: Math.max(64, e.args[0].length * CW + 14), h: ROW };
    const [title, rows] = BOXDEF[e.op] || [e.op, e.args.map((_, i) => `Op ${i + 1}`)];
    const isTag = (a) => a && a !== "?" && !/^[-+]?(\d|\.\d)/.test(a);
    const shown = e.op === "JSR" ? [[rows[0], e.args[0], false]] : rows.map((r, i) => [r, e.args[i] ?? "", isTag(e.args[i]) && !(["Timer", "Counter"].includes(r))]);
    const w = Math.max(118, title.length * 6.1 + 40, ...shown.map(([r, v]) => (r.length + Math.max(v.length, 7)) * CW + 30));
    const hb = shown.reduce((s2, r2) => s2 + (r2[2] ? 27 : 15), 0);
    return { k: "box", e, id, rows: shown, title, w, h: Math.max(ROW, 36 + hb + 8) };
  });
  return { k: "ser", items, w: Math.max(24, items.reduce((s, i) => s + i.w, 0)), h: Math.max(ROW, ...items.map((i) => i.h)) };
}

export function renderRoutine(host, routine, opts) {
  // returns {update(trace, T)} ; trace = {tr, rp}
  host.innerHTML = ""; const binds = [], vals = [];
  routine.rungs.forEach((g, n) => {
    const wrap = document.createElement("div"); wrap.className = "rung"; host.appendChild(wrap);
    if (g.comment) { const c = document.createElement("p"); c.className = "rc"; c.textContent = g.comment; wrap.appendChild(c); }
    let L; const ctr = { n: 0 }; const base = opts.idBase(n);
    try { L = layout(parseRung(g.text), ctr); } catch (e) { wrap.append(`parse error: ${e.message}`); return; }
    const W = L.w + 70, H = L.h + 6;
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "lad" }, wrap);
    svg("text", { x: 4, y: WY + 4, class: "rn" }, s).textContent = n;
    svg("line", { x1: 28, y1: 0, x2: 28, y2: H, class: "rail on" }, s);
    svg("line", { x1: W - 6, y1: 0, x2: W - 6, y2: H, class: "rail on" }, s);
    const pin = (node) => node.k === "ser" ? (node.items.length ? pin(node.items[0]) : null) : node.k === "br" ? pin(node.legs[0]) : node.id + base;
    const pout = (node) => node.k === "ser" ? node.items.length ? pout(node.items.at(-1)) : null : node.k === "br" ? node.legs.map(pout) : node.id + base;
    const on = (ids, bit) => (tr) => { const a = Array.isArray(ids) ? ids.flat(Infinity) : [ids]; return a.some((i) => i != null && (tr[i] >> bit) & 1); };
    function draw(node, x, y) {
      const wy = y + WY;
      if (node.k === "ser") { let cx = x; for (const it of node.items) { draw(it, cx, y); cx += it.w; } return; }
      if (node.k === "br") {
        let ly = y; const fin = on(pin(node), 0), fout = on(pout(node), 1);
        node.legs.forEach((leg, li) => {
          const lw = leg.legW = leg.w;
          if (li > 0) { binds.push([svg("line", { x1: x, y1: y + WY, x2: x, y2: ly + WY, class: "w" }, s), fin]); binds.push([svg("line", { x1: x + node.w, y1: y + WY, x2: x + node.w, y2: ly + WY, class: "w" }, s), fout]); }
          binds.push([svg("line", { x1: x, y1: ly + WY, x2: x + BX, y2: ly + WY, class: "w" }, s), fin]);
          draw(leg, x + BX, ly);
          binds.push([svg("line", { x1: x + BX + lw, y1: ly + WY, x2: x + node.w, y2: ly + WY, class: "w" }, s), on(pout(leg), 1)]);
          ly += leg.h;
        });
        return;
      }
      const id = node.id + base, e = node.e;
      if (node.k === "sym") {
        const cx = x + node.w / 2, g = svg("g", { class: "ins" }, s);
        binds.push([svg("line", { x1: x, y1: wy, x2: cx - 9, y2: wy, class: "w" }, s), on(id, 0)]);
        binds.push([svg("line", { x1: cx + 9, y1: wy, x2: x + node.w, y2: wy, class: "w" }, s), on(id, 1)]);
        if (CONTACT.has(e.op)) {
          svg("line", { x1: cx - 6, y1: wy - 10, x2: cx - 6, y2: wy + 10, class: "sy" }, g); svg("line", { x1: cx + 6, y1: wy - 10, x2: cx + 6, y2: wy + 10, class: "sy" }, g);
          svg("rect", { x: cx - 5, y: wy - 9, width: 10, height: 18, class: "fill" }, g);
          if (e.op === "XIO") svg("line", { x1: cx - 6, y1: wy + 10, x2: cx + 6, y2: wy - 10, class: "sy" }, g);
        } else {
          svg("path", { d: `M${cx - 4} ${wy - 10} A 12 12 0 0 0 ${cx - 4} ${wy + 10}`, class: "sy" }, g);
          svg("path", { d: `M${cx + 4} ${wy - 10} A 12 12 0 0 1 ${cx + 4} ${wy + 10}`, class: "sy" }, g);
          svg("circle", { cx, cy: wy, r: 6, class: "fill" }, g);
          if (e.op !== "OTE") svg("text", { x: cx, y: wy + 4, class: "cl" }, g).textContent = e.op === "OTL" ? "L" : "U";
        }
        binds.push([g, on(id, 2)]);
        const t = svg("text", { x: cx, y: wy - 16, class: "tg" }, s); t.textContent = e.args[0];
        t.addEventListener("click", () => opts.onTag && opts.onTag(e.args[0]));
        const v = svg("text", { x: cx, y: wy + 23, class: "tv" }, s); vals.push([v, e.args[0]]);
        return;
      }
      // box instruction
      const bx = x + 8, bw = node.w - 16, by = y + 8, bh = node.h - 14;
      binds.push([svg("line", { x1: x, y1: wy, x2: bx, y2: wy, class: "w" }, s), on(id, 0)]);
      binds.push([svg("line", { x1: bx + bw, y1: wy, x2: x + node.w, y2: wy, class: "w" }, s), on(id, 1)]);
      const g = svg("g", { class: "box" }, s);
      svg("rect", { x: bx, y: by, width: bw, height: bh, rx: 2, class: "bx" }, g);
      svg("rect", { x: bx, y: by, width: bw, height: 16, class: "bh" }, g);
      svg("text", { x: bx + 5, y: by + 12, class: "bo" }, g).textContent = e.op;
      if (node.title) svg("text", { x: bx + 34, y: by + 12, class: "bt" }, g).textContent = node.title;
      binds.push([g, on(id, 2)]);
      let ry = by + 30;
      node.rows.forEach(([lab, arg, tagRow]) => {
        svg("text", { x: bx + 6, y: ry, class: "bl" }, s).textContent = lab;
        const a = svg("text", { x: bx + bw - 6, y: ry, class: "ba" }, s);
        if (arg === "?" && (lab === "Preset" || lab === "Accum")) vals.push([a, `${e.args[0]}.${lab === "Preset" ? "PRE" : "ACC"}`]);
        else a.textContent = arg;
        if (tagRow) { a.classList.add("lnk"); a.addEventListener("click", () => opts.onTag && opts.onTag(arg)); vals.push([svg("text", { x: bx + bw - 6, y: ry + 12, class: "bv" }, s), arg]); ry += 27; }
        else ry += 15;
      });
    }
    draw(L, 28 + 8, 2);
    binds.push([svg("line", { x1: 28, y1: WY + 2, x2: 36, y2: WY + 2, class: "w on" }, s), () => true]);
    const end = svg("line", { x1: 36 + L.w, y1: WY + 2, x2: W - 6, y2: WY + 2, class: "w" }, s);
    binds.push([end, ((k) => (tr, rp) => rp[k])(n)]);
  });
  return {
    update(tb, get, fmt) {
      if (!tb) return;
      for (const [el, f] of binds) el.classList.toggle("on", !!f(tb.tr, tb.rp));
      for (const [el, path] of vals) { const v = get(path); if (v !== undefined && typeof v !== "object") el.textContent = fmt(v); }
    },
  };
}
