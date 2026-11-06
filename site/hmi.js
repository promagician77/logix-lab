// ISA-101 style overview screen: grey by default, colour only for abnormal states.
const NS = "http://www.w3.org/2000/svg";
const S = (tag, a = {}, p) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
const TOP = 70, BOT = 370, Y = (pct) => BOT - ((BOT - TOP) * pct) / 100;

export function createHMI(host, ctx) {
  // ctx: {T: tags, plant, hmi(path, v), onAck, alarmsMeta: [[tag, text]]}
  host.innerHTML = "";
  const s = S("svg", { viewBox: "0 0 620 468", class: "hmi-svg", role: "img", "aria-label": "Lift station overview screen" }, host);
  S("text", { x: 14, y: 24, class: "h-title" }, s).textContent = "LS-01 LIFT STATION · OVERVIEW";
  const mode = S("text", { x: 606, y: 24, class: "h-mode", "text-anchor": "end" }, s);
  // tank
  S("rect", { x: 60, y: TOP, width: 170, height: BOT - TOP, class: "h-tank" }, s);
  const fill = S("rect", { x: 61, y: Y(30), width: 168, height: BOT - Y(30), class: "h-liq" }, s);
  const lvl = S("text", { x: 145, y: 104, class: "h-big", "text-anchor": "middle" }, s);
  const ma = S("text", { x: 145, y: 124, class: "h-small", "text-anchor": "middle" }, s);
  S("text", { x: 145, y: BOT + 18, class: "h-lab", "text-anchor": "middle" }, s).textContent = "WET WELL · LT-101";
  const spg = S("g", {}, s); const sp = {};
  for (const [k, lab] of [["SPV_HighAlm", "HI ALM"], ["SPV_LagOn", "LAG ON"], ["SPV_LeadOn", "LEAD ON"], ["SPV_AllOff", "ALL OFF"]]) {
    const g = S("g", {}, spg); S("line", { x1: 230, x2: 242, y1: 0, y2: 0, class: "h-tick" }, g);
    const t = S("text", { x: 246, y: 4, class: "h-sp" }, g); sp[k] = { g, t, lab };
  }
  const floats = {};
  for (const [k, pct, lab] of [["DI_LSHH", 92, "LSHH"], ["DI_LSL", 10, "LSL"]]) {
    const g = S("g", { transform: `translate(30 ${Y(pct)})` }, s);
    S("line", { x1: 18, x2: 31, y1: 0, y2: 0, class: "h-tick" }, g);
    const c = S("circle", { cx: 12, cy: 0, r: 5, class: "h-float" }, g);
    S("text", { x: -2, y: -8, class: "h-sp", "text-anchor": "middle" }, g).textContent = lab; floats[k] = c;
  }
  // inflow
  S("path", { d: "M20 52 H100 V66", class: "h-pipe", fill: "none" }, s); S("path", { d: "M95 60 L100 68 L105 60", class: "h-arrow" }, s);
  const qin = S("text", { x: 20, y: 44, class: "h-small" }, s);
  // pumps
  const pumps = [0, 1].map((i) => {
    const x = 370 + i * 150, y = 300;
    S("path", { d: `M230 ${BOT - 18} H${x - 40} V${y} H${x - 26}`, class: "h-pipe", fill: "none" }, s);
    S("path", { d: `M${x} ${y - 26} V 90 H 612`, class: "h-pipe", fill: "none" }, s);
    const g = S("g", { transform: `translate(${x} ${y})`, class: "h-pump" }, s);
    const body = S("circle", { r: 26, class: "h-pbody" }, g);
    const tri = S("path", { d: "M-12 14 L0 -16 L12 14 Z", class: "h-ptri" }, g);
    S("text", { x: 0, y: 46, class: "h-lab", "text-anchor": "middle" }, g).textContent = `P-10${i + 1}`;
    const st = S("text", { x: 0, y: 62, class: "h-state", "text-anchor": "middle" }, g);
    const det = S("text", { x: 0, y: 77, class: "h-small", "text-anchor": "middle" }, g);
    const lead = S("text", { x: -34, y: -18, class: "h-badge", "text-anchor": "end" }, g);
    const hoa = S("text", { x: 34, y: -16, class: "h-small" }, g);
    const flt = S("text", { x: 0, y: 92, class: "h-flt", "text-anchor": "middle" }, g);
    return { body, tri, st, det, lead, hoa, flt, g };
  });
  S("text", { x: 612, y: 82, class: "h-small", "text-anchor": "end" }, s).textContent = "TO FORCE MAIN";
  const qout = S("text", { x: 612, y: 108, class: "h-small", "text-anchor": "end" }, s);
  S("rect", { x: 290, y: 400, width: 322, height: 60, class: "h-tbox" }, s);
  S("text", { x: 296, y: 412, class: "h-sp" }, s).textContent = "LEVEL · LAST 30 MIN";
  const trend = S("polyline", { class: "h-trend", fill: "none" }, s);
  const hist = [];
  const fmtH = (sec) => (sec / 3600).toFixed(1);

  function update(t_s) {
    const T = ctx.T, pl = ctx.plant, pct = T.LT101_Pct, bad = T.LT101_Bad;
    const real = pl.level_pct;
    fill.setAttribute("y", Y(Math.max(0, Math.min(100, real)))); fill.setAttribute("height", BOT - Y(Math.max(0, Math.min(100, real))));
    lvl.textContent = bad ? "BAD" : `${pct.toFixed(1)} %`; lvl.classList.toggle("abn", !!bad);
    ma.textContent = `${T.AI_LT101_mA.toFixed(2)} mA`;
    mode.textContent = bad ? "FLOAT BACKUP CONTROL" : "LEVEL CONTROL: LT-101"; mode.classList.toggle("abn", !!bad);
    for (const k in sp) { sp[k].g.setAttribute("transform", `translate(0 ${Y(T[k])})`); sp[k].t.textContent = `${sp[k].lab} ${T[k].toFixed(0)}`; }
    floats.DI_LSHH.classList.toggle("act", !T.DI_LSHH); floats.DI_LSL.classList.toggle("act", !T.DI_LSL);
    qin.textContent = `INFLOW ${pl.qin.toFixed(1)} L/s (simulated)`; qout.textContent = `${pl.qout.toFixed(0)} L/s`;
    pumps.forEach((p, i) => {
      const P = T[`P${i + 1}`], run = P.RunFbk, oos = P.HMI_OOS;
      p.body.setAttribute("class", "h-pbody" + (run ? " run" : "") + (P.Fault ? " flt" : "") + (oos ? " oos" : ""));
      p.tri.setAttribute("class", "h-ptri" + (run ? " run" : ""));
      p.st.textContent = P.Fault ? "FAULT" : oos ? "OUT OF SERVICE" : run ? "RUNNING" : P.Avail ? "STOPPED" : "NOT AVAILABLE";
      p.st.classList.toggle("abn", !!P.Fault);
      p.det.textContent = `${P.Starts} starts · ${fmtH(P.RunSec)} h`;
      const isLead = i === 0 ? T.P1_IsLead : T.P2_IsLead;
      p.lead.textContent = P.Avail ? (isLead ? "LEAD" : "LAG") : "";
      p.hoa.textContent = P.HOA_Hand ? "HAND" : P.HOA_Auto ? "AUTO" : "OFF";
      p.hoa.classList.toggle("abn", !P.HOA_Auto);
      p.flt.textContent = P.Flt_FTS ? "FAILED TO START" : P.Flt_OL ? "OVERLOAD" : P.Flt_Uncmd ? "RUNNING, NOT COMMANDED" : "";
    });
    if (!hist.length || t_s - hist.at(-1)[0] >= 10) { hist.push([t_s, real]); while (hist.length && t_s - hist[0][0] > 1800) hist.shift(); }
    trend.setAttribute("points", hist.map(([t, v]) => `${296 + ((t - (t_s - 1800)) / 1800) * 310},${456 - (v / 100) * 40}`).join(" "));
  }
  return { update };
}
