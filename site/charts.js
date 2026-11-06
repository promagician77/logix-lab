/* ---------- SVG chart helpers ---------- */
const NS = "http://www.w3.org/2000/svg";
function el(tag, attrs = {}, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
function ticks(a, b, n = 5) {
  const span = b - a, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
  const out = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(10)); return out;
}
function lineChart(host, o) {
  host.innerHTML = ""; host.classList.add("chart");
  const W = Math.max(320, host.clientWidth || o.width || 900), H = o.height || 300, m = { l: 54, r: 18, t: 14, b: 38, ...(o.margin || {}) };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": o.aria || "" }, host);
  const xs = o.series.flatMap((s) => s.x), ys = o.series.flatMap((s) => s.y).filter((v) => v != null && isFinite(v));
  const [x0, x1] = o.xDomain || [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = o.yDomain || [Math.min(...ys), Math.max(...ys)];
  if (!o.yDomain) { const pad = (y1 - y0) * 0.08 || 1; y0 -= pad; y1 += pad; }
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r), Y = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  (o.bands || []).forEach((b) => el("rect", { x: X(b[0]), y: m.t, width: Math.max(0, X(b[1]) - X(b[0])), height: H - m.t - m.b, fill: b[2] || "#EFE9DC" }, svg));
  (o.bandLabels || []).forEach((b) => { const t = el("text", { x: (X(b[0]) + X(b[1])) / 2, y: m.t + 12, "text-anchor": "middle", class: "lbl", style: "font-size:11px;fill:#8A857A" }, svg); t.textContent = b[2]; });
  const g = el("g", { class: "grid" }, svg), ax = el("g", { class: "ax" }, svg);
  ticks(y0, y1, o.yTicks || 5).forEach((v) => {
    el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }, g);
    const t = el("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end" }, ax); t.textContent = o.yFmt ? o.yFmt(v) : v;
  });
  ticks(x0, x1, o.xTicks || 8).forEach((v) => { const t = el("text", { x: X(v), y: H - m.b + 18, "text-anchor": "middle" }, ax); t.textContent = o.xFmt ? o.xFmt(v) : v; });
  el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }, ax);
  if (y0 < 0 && y1 > 0) el("line", { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), stroke: "#A9A396", "stroke-width": 1 }, svg);
  (o.refLines || []).forEach((r) => { el("line", { x1: m.l, x2: W - m.r, y1: Y(r.y), y2: Y(r.y), stroke: r.color || "#A9A396", "stroke-dasharray": "4 4" }, svg); if (r.label) { const t = el("text", { x: m.l + 6, y: Y(r.y) - 5, "text-anchor": "start", class: "lbl", style: "font-size:11.5px;paint-order:stroke;stroke:#FFFDF8;stroke-width:3px" }, svg); t.textContent = r.label; } });
  if (o.xLabel) { const t = el("text", { x: W - m.r, y: H - 4, "text-anchor": "end", class: "lbl", style: "fill:#7A7F87;font-size:11.5px" }, svg); t.textContent = o.xLabel; }
  if (o.yLabel) { const t = el("text", { x: m.l, y: m.t - 2, class: "lbl", style: "fill:#7A7F87;font-size:11.5px" }, svg); t.textContent = o.yLabel; }
  o.series.forEach((s) => {
    let d = "", pen = false;
    s.x.forEach((xv, i) => { const yv = s.y[i]; if (yv == null || !isFinite(yv)) { pen = false; return; } d += (pen ? "L" : "M") + X(xv).toFixed(1) + "," + Y(yv).toFixed(1); pen = true; });
    el("path", { d, fill: "none", stroke: s.color, "stroke-width": s.width || 2, "stroke-opacity": s.opacity ?? 1, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    if (s.label) { const i = s.labelAt ?? s.x.length - 1; const t = el("text", { x: X(s.x[i]) + 6, y: Y(s.y[i]) + 4, class: "lbl" }, svg); t.textContent = s.label; }
  });
  // hover: crosshair + tooltip on the first "hover" series set
  const hs = o.series.filter((s) => s.hover !== false);
  if (hs.length) {
    const tip = document.createElement("div"); tip.className = "tip"; host.appendChild(tip);
    const vline = el("line", { y1: m.t, y2: H - m.b, stroke: "#1C1F24", "stroke-opacity": 0.35, visibility: "hidden" }, svg);
    const dots = hs.map((s) => el("circle", { r: 4.5, fill: s.color, stroke: "#FFFDF8", "stroke-width": 2, visibility: "hidden" }, svg));
    const hit = el("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" }, svg);
    const move = (ev) => {
      const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
      const xv = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
      const s0 = hs[0]; let i = 0, best = 1e18; s0.x.forEach((v, k) => { const d = Math.abs(v - xv); if (d < best) { best = d; i = k; } });
      vline.setAttribute("x1", X(s0.x[i])); vline.setAttribute("x2", X(s0.x[i])); vline.setAttribute("visibility", "visible");
      const lines = [o.xFmtTip ? o.xFmtTip(s0.x[i]) : s0.x[i]];
      hs.forEach((s, k) => { const yv = s.y[i]; if (yv == null) { dots[k].setAttribute("visibility", "hidden"); return; } dots[k].setAttribute("cx", X(s.x[i])); dots[k].setAttribute("cy", Y(yv)); dots[k].setAttribute("visibility", "visible"); lines.push(`${s.name}: ${o.yFmtTip ? o.yFmtTip(yv) : yv}`); });
      tip.innerHTML = lines.join("<br>"); tip.classList.add("on");
      tip.style.left = (X(s0.x[i]) / W) * r.width + "px"; tip.style.top = (Y(hs[0].y[i] ?? 0) / H) * r.height + "px";
    };
    hit.addEventListener("pointermove", move); hit.addEventListener("pointerleave", () => { tip.classList.remove("on"); vline.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); });
  }
  return svg;
}
function barChart(host, o) {
  host.innerHTML = ""; host.classList.add("chart");
  const W = Math.max(320, host.clientWidth || o.width || 900), rowH = o.rowH || 44, m = { l: o.labelW || 260, r: o.marginR ?? 90, t: 8, b: 26 };
  const H = m.t + m.b + rowH * o.rows.length;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": o.aria || "" }, host);
  const vmax = o.max || Math.max(...o.rows.map((r) => r.v)) * 1.05;
  const X = (v) => m.l + (v / vmax) * (W - m.l - m.r);
  const ax = el("g", { class: "ax" }, svg), g = el("g", { class: "grid" }, svg);
  ticks(0, vmax, o.ticks || 5).forEach((v) => { el("line", { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b }, g); const t = el("text", { x: X(v), y: H - 8, "text-anchor": "middle" }, ax); t.textContent = o.fmt ? o.fmt(v) : v; });
  const tip = document.createElement("div"); tip.className = "tip"; host.appendChild(tip);
  o.rows.forEach((r, i) => {
    const y = m.t + i * rowH + 8, h = rowH - 16;
    const t = el("text", { x: m.l - 12, y: y + h / 2 + 4, "text-anchor": "end", class: "lbl", style: "font-size:13px;fill:#1C1F24" }, svg); t.textContent = r.label;
    const w = Math.max(3, X(r.v) - m.l);
    const bar = el("path", { d: `M${m.l},${y}h${w - 4}a4,4 0 0 1 4,4v${h - 8}a4,4 0 0 1 -4,4h${-(w - 4)}z`, fill: r.color }, svg);
    const v = el("text", { x: m.l + w + 8, y: y + h / 2 + 4, class: "lbl", style: "font-family:JetBrains Mono,monospace;font-size:12.5px;fill:#1C1F24" }, svg); v.textContent = r.text;
    const hit = el("rect", { x: 0, y: y - 6, width: W, height: rowH, fill: "transparent" }, svg);
    hit.addEventListener("pointermove", (ev) => { const b = svg.getBoundingClientRect(); tip.innerHTML = r.tip || `${r.label}: ${r.text}`; tip.style.left = ((m.l + w) / W) * b.width + "px"; tip.style.top = (y / H) * b.height + "px"; tip.classList.add("on"); bar.setAttribute("fill-opacity", 0.85); });
    hit.addEventListener("pointerleave", () => { tip.classList.remove("on"); bar.setAttribute("fill-opacity", 1); });
  });
}

