import { Controller, getPath } from "./lib/engine.js";
import { fromL5X } from "./lib/l5x.js";
import { Rig } from "./lib/plant.js";
import { renderRoutine } from "./ladder.js";
import { createHMI } from "./hmi.js";

const $ = (s, e = document) => e.querySelector(s), $$ = (s, e = document) => [...e.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const k in attrs) k === "class" ? (e.className = attrs[k]) : k.startsWith("on") ? e.addEventListener(k.slice(2), attrs[k]) : e.setAttribute(k, attrs[k]); for (const c of kids.flat()) e.append(c instanceof Node ? c : String(c)); return e; };
const fmt = (v) => (typeof v !== "number" ? String(v) : Number.isInteger(v) ? String(v) : v.toFixed(2));
const clock = (s) => { s = Math.floor(s); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, "0")).join(":"); };
const RENDER = {}; let CUR = null, project = null;

function tabs() {
  const b = $$("nav.tabs button");
  const show = (id) => { b.forEach((x) => x.setAttribute("aria-selected", x.dataset.tab === id)); $$("section.tab").forEach((s) => s.classList.toggle("on", s.id === "s-" + id)); CUR = id; try { history.replaceState(null, "", "#" + id); } catch (e) {} requestAnimationFrame(() => RENDER[id] && RENDER[id]()); };
  b.forEach((x) => x.addEventListener("click", () => show(x.dataset.tab)));
  const hs = location.hash.slice(1); show(b.some((x) => x.dataset.tab === hs) ? hs : "live");
  let t; window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => CUR !== "live" && RENDER[CUR] && RENDER[CUR](), 150); });
}

/* ---------------- live station ---------------- */
const bench = { inflow: 8, speed: 10, paused: false };
let rig, hmi, ladderView, curRoutine = "MainProgram/R03_LeadLag", alarmLog = new Map(), acc = 0, last = performance.now();
const ALARMS = () => project.tags.filter((t) => t.type === "UDT_Alarm").map((t) => [t.name, t.desc]);

function newRig() {
  rig = new Rig(Controller, project, { dt: 10, plant: { level_pct: 40, inflow: () => bench.inflow } });
  rig.plc.enableTrace(true); alarmLog = new Map();
  hmi = createHMI($("#hmi"), { T: rig.T, plant: rig.plant });
  $$("[data-hoa]").forEach((g) => g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.v === "AUTO")));
  $$("[data-fault]").forEach((x) => x.setAttribute("aria-pressed", "false"));
  for (const [k, v] of Object.entries({ SP_LeadOn: 55, SP_LagOn: 75, SP_AllOff: 25, SP_HighAlm: 85 })) $(`[data-sp="${k}"]`).value = v;
  showRoutine(curRoutine);
}
function showRoutine(key) {
  curRoutine = key; const r = rig.plc.routines[key];
  $$("#routines button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.r === key));
  const base = []; r.map.forEach((m) => { if (base[m.rung] === undefined) base[m.rung] = m.id; });
  const ro = project.programs.find((p) => p.name === r.program).routines.find((x) => x.name === r.name);
  $("#rtitle").textContent = `${r.program} / ${r.name}`; $("#rdesc").textContent = ro.desc || "";
  ladderView = renderRoutine($("#ladder"), ro, { idBase: (n) => base[n] ?? 0, onTag: xref });
}
function xref(tag) {
  const base = tag.split(".").slice(0, 2).join(".");
  const re = new RegExp(`[(,]${base.replace(/[.[\]]/g, "\\$&")}([.,)]|$)`);
  const hits = [];
  for (const p of project.programs) for (const r of p.routines) r.rungs.forEach((g, n) => { if (re.test(g.text)) hits.push([`${p.name}/${r.name}`, n, g.text]); });
  const v = getPath(rig.T, tag);
  $("#xref").innerHTML = "";
  $("#xref").append(h("div", { class: "xh" }, h("b", {}, tag), typeof v === "object" ? "" : ` = ${fmt(v)}`, h("button", { class: "x", onclick: () => ($("#xref").hidden = true) }, "×")),
    h("ul", {}, hits.map(([k, n, t]) => h("li", {}, h("button", { onclick: () => { showRoutine(k); setTimeout(() => $$("#ladder .rung")[n]?.scrollIntoView({ block: "center" }), 30); } }, `${k.split("/")[1]} · rung ${n}`), h("code", {}, t)))));
  $("#xref").hidden = false;
}
function alarmsUpdate() {
  const rows = [];
  for (const [tag, text] of ALARMS()) {
    const a = rig.T[tag];
    if (a.Active && !alarmLog.has(tag)) alarmLog.set(tag, rig.t);
    if (!a.Active && !a.Unack) alarmLog.delete(tag);
    if (a.Active || a.Unack) rows.push([alarmLog.get(tag) ?? rig.t, text, a.Active, a.Unack]);
  }
  rows.sort((x, y) => y[0] - x[0]);
  $("#alarms tbody").innerHTML = rows.length ? rows.map(([t, txt, act, un]) => `<tr class="${un ? "un" : ""}${act ? " act" : ""}"><td>${clock(t)}</td><td>${txt}</td><td>${act ? (un ? "ACTIVE · UNACK" : "ACTIVE") : "CLEARED · UNACK"}</td></tr>`).join("") : `<tr><td colspan="3" class="none">No active alarms</td></tr>`;
}
function frame(now) {
  const real = Math.min(100, now - last); last = now;
  if (CUR === "live" && !bench.paused && rig) {
    acc += real * bench.speed; let n = Math.floor(acc / rig.dt); acc -= n * rig.dt; if (n > 6000) n = 6000;
    for (let i = 0; i < n; i++) rig.step();
    hmi.update(rig.t); alarmsUpdate();
    const tb = rig.plc.trace[curRoutine];
    ladderView.update(tb, (p) => (p === "S:FS" ? rig.plc.fs : getPath(rig.T, p)), fmt);
    $("#simclock").textContent = clock(rig.t); $("#scans").textContent = rig.plc.scans.toLocaleString();
  }
  requestAnimationFrame(frame);
}
function initLive() {
  $("#routines").append(...Object.entries(rig.plc.routines).map(([k, r]) => h("button", { "data-r": k, onclick: () => showRoutine(k), title: k }, r.name)));
  showRoutine(curRoutine);
  $$("[data-hoa]").forEach((g) => g.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    rig.plant.pumps[+g.dataset.hoa].sel = b.dataset.v; g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  })));
  $$("[data-fault]").forEach((b) => b.addEventListener("click", () => {
    const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", on); const [kind, i] = b.dataset.fault.split(":");
    if (kind === "lt") rig.plant.lt = on ? (i === "stuck" ? { mode: "stuck", stuck: rig.T.LT101_Pct } : { mode: "broken" }) : { mode: "ok" };
    else rig.plant.pumps[+i][kind] = on ? 1 : 0;
  }));
  const fl = $("#inflow"); fl.addEventListener("input", () => { bench.inflow = +fl.value; $("#inflowv").textContent = `${(+fl.value).toFixed(0)} L/s`; });
  $$("[data-speed]").forEach((b) => b.addEventListener("click", () => { bench.speed = +b.dataset.speed; $$("[data-speed]").forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
  $("#pause").addEventListener("click", (e) => { bench.paused = !bench.paused; e.target.textContent = bench.paused ? "Run" : "Pause"; });
  $("#reset").addEventListener("click", () => { newRig(); });
  $$("[data-cmd]").forEach((b) => b.addEventListener("click", () => {
    const c = b.dataset.cmd; if (c.endsWith("OOS")) { rig.hmi(c, rig.plc.get(c) ? 0 : 1); b.setAttribute("aria-pressed", !!rig.plc.get(c)); } else rig.hmi(c, 1);
  }));
  $$("[data-sp]").forEach((x) => x.addEventListener("change", () => rig.hmi(x.dataset.sp, +x.value)));
  requestAnimationFrame(frame);
}

/* ---------------- results tabs ---------------- */
const G = "#3FB97A", R = "#E5544B", A = "#F2A900", MUTE = "#8B949E";
async function results() {
  const j = async (p) => (await fetch(p)).json();
  const [SC, MU, TS] = await Promise.all([j("data/scenarios.json"), j("data/mutation.json"), j("data/troubleshooting.json")]);
  const pct = (a, b) => (100 * a / b).toFixed(1);
  const set = (k, v) => $$(`[data-n="${k}"]`).forEach((e) => (e.textContent = v));
  set("pass", `${SC.results.filter((r) => r.pass).length}/${SC.results.length}`); set("basic-pct", pct(MU.killed_basic, MU.valid)); set("full-pct", pct(MU.killed_full, MU.valid));
  set("valid", MU.valid); set("nsc", SC.results.length); set("basic-miss", MU.valid - MU.killed_basic); set("full-miss", MU.valid - MU.killed_full); set("lint-clean", TS.clean.lint.length);
  set("suite-s", (SC.results.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1)); set("sim-h", SC.sim_hours.toFixed(1));
  const m = Object.fromEntries(SC.results.map((r) => [r.id, r.m || {}]));
  set("ftsd", m.F3.detect_s); set("fto", m.F3.takeover_s); set("drift20", TS.drift.find((d) => d.scan_ms === 20).self_reset_error_pct);

  $("#sctb tbody").innerHTML = SC.results.map((r) => {
    const mm = Object.entries(r.m || {}).filter(([k]) => !["series", "t0"].includes(k)).map(([k, v]) => `${k.replace(/_/g, " ")}: <b>${v}</b>`).join(" · ");
    return `<tr><td class="mono">${r.id}</td><td>${r.name}${r.basic ? ' <span class="pill">site check</span>' : ""}</td><td>${mm}</td><td class="n">${r.ms.toFixed(0)} ms</td><td><span class="pill ${r.pass ? "ok" : "bad"}">${r.pass ? "pass" : "FAIL"}</span></td></tr>`;
  }).join("");
  RENDER.tests = () => {
    const st = m.F14.series, xs = st.map((p) => p[0]);
    lineChart($("#ch-storm"), { height: 300, xDomain: [0, 360], yDomain: [0, 100], yTicks: 5, xLabel: "minutes", yLabel: "wet well level (%)", refLines: [{ y: 75, label: "lag on 75 %" }, { y: 55, label: "lead on 55 %" }, { y: 25, label: "all off 25 %" }],
      series: [{ name: "level", color: "#7FB3E0", x: xs, y: st.map((p) => p[1]), width: 2 }, { name: "inflow ×2 (L/s)", color: A, x: xs, y: st.map((p) => p[4] * 2), width: 1.4 },
        { name: "P1 running", color: G, x: xs, y: st.map((p) => (p[2] ? 6 : null)), width: 5 }, { name: "P2 running", color: "#B48EF0", x: xs, y: st.map((p) => (p[3] ? 2 : null)), width: 5 }],
      xFmtTip: (v) => `${v} min`, yFmtTip: (v) => v.toFixed(1) });
    const f = m.F3.series, fx = f.map((p) => +(p[0] - m.F3.t0).toFixed(1));
    const lane = (k, base) => f.map((p) => base + 0.7 * p[k]);
    lineChart($("#ch-fail"), { height: 300, xDomain: [Math.min(...fx), Math.max(...fx)], yDomain: [0.5, 5.9], yTicks: 6, yFmt: (v) => ({ 1: "P2 feedback", 2: "P2 command", 3: "P1 fault", 4: "P1 feedback", 5: "P1 command" }[v] || ""), margin: { l: 96 },
      xLabel: "seconds after P1 run command", series: [[1, 5, G], [2, 4, G], [3, 3, R], [4, 2, "#B48EF0"], [5, 1, "#B48EF0"]].map(([k, b, c]) => ({ name: "", color: c, x: fx, y: lane(k, b), width: 2.2, hover: false })) });
  };

  const ops = Object.entries(MU.by_operator);
  $("#mu-tiles").innerHTML = [[MU.valid, "valid one-edit mutants of the program"], [`${pct(MU.killed_basic, MU.valid)} %`, "caught by the 5 site checks"], [`${pct(MU.killed_full, MU.valid)} %`, `caught by the ${SC.results.length} scenario tests`], [MU.survivors.length, "survivors, each reviewed below"]].map(([b, t]) => `<div class="tile"><b>${b}</b><span>${t}</span></div>`).join("");
  RENDER.mutation = () => {
    barChart($("#ch-ops"), { rows: ops.flatMap(([op, b]) => [{ label: `${op} · site checks`, v: 100 * b.basic / b.n, color: MUTE, text: `${b.basic}/${b.n}` }, { label: `${op} · scenarios`, v: 100 * b.full / b.n, color: G, text: `${b.full}/${b.n}` }]), labelW: 170, marginR: 64, rowH: 30, max: 100, ticks: 4, fmt: (v) => v + "%" });
  };
  const byR = {}; for (const x of MU.basic_misses) (byR[x.where.replace(/ rung \d+/, "")] ||= []).push(x);
  const pick = []; for (let k = 0; pick.length < 12 && k < 20; k++) for (const g of Object.values(byR)) if (g[k * 3] && pick.length < 12) pick.push(g[k * 3]);
  $("#mu-miss tbody").innerHTML = pick.map((x) => `<tr><td>${x.where}</td><td class="mono">${x.op}</td><td><code>${x.before}</code><br><code class="mut">${x.after}</code></td><td class="mono">${x.caught_by}</td></tr>`).join("");
  $("#mu-surv tbody").innerHTML = MU.survivors.map((x) => `<tr><td>${x.where}</td><td class="mono">${x.op}</td><td><code>${x.before}</code><br><code class="mut">${x.after}</code></td><td>${x.note || ""}</td></tr>`).join("");
  set("mu-time", MU.seconds.toFixed(0));
  if (MU.round1) $("#mu-round").innerHTML = `<b>Round 1</b> used ${MU.round1.scenarios} scenarios and caught ${pct(MU.round1.killed_full, MU.round1.valid)} %. The ${MU.round1.valid - MU.round1.killed_full} edits it missed showed where my own tests were thin: pump 2 mirrors, alarms returning to normal and being re-raised, setpoint and NE 43 boundaries, transmitter stuck low, stale requests at power-up, and an out-of-service pump running as lag. Over two more rounds I added ${SC.results.length - MU.round1.scenarios} scenarios and tightened others. <b>Now</b>, with ${SC.results.length} scenarios, ${pct(MU.killed_full, MU.valid)} % are caught. Each of the ${MU.survivors.length} edits still uncaught is reviewed at the bottom of this tab.`;
  $("#bugs").innerHTML = TS.bugs.map((b) => `<div class="card bug"><div class="bid">${b.id}</div><h3>${b.title}</h3><p><b>What the operator sees:</b> ${b.symptom}</p>
    <p><b>Linter:</b> ${b.lint.length ? b.lint.map((f) => `<span class="pill ${f.severity === "error" ? "bad" : "warn"}">${f.rule}</span> <code>${f.detail}</code>`).join(" ") : '<span class="pill">not detectable statically</span>'}</p>
    <p><b>Scenario tests:</b> ${b.failing.length ? b.failing.map((f) => `<span class="pill bad" title="${(f.msg || "").replace(/"/g, "'")}">${f.id}</span>`).join(" ") : "none failed"}</p>
    <p class="fix"><b>Fix:</b> ${b.fix}</p></div>`).join("");
  RENDER.trouble = () => barChart($("#ch-drift"), { rows: TS.drift.map((d) => ({ label: `${d.scan_ms} ms scan`, v: -d.self_reset_error_pct, color: R, text: `${(-d.self_reset_error_pct).toFixed(1)}% low (${d.self_reset} of 3600 s)` })), labelW: 110, marginR: 190, rowH: 36, fmt: (v) => v.toFixed(0) + "%" });

  RENDER[CUR] && RENDER[CUR]();
}

/* ---------------- program tab ---------------- */
function program() {
  $("#rtb tbody").innerHTML = project.programs.flatMap((p) => p.routines.map((r) => `<tr><td class="mono">${p.name}</td><td class="mono">${r.name}</td><td>${r.desc || ""}</td><td class="n">${r.rungs.length}</td></tr>`)).join("");
  $("#udts").innerHTML = project.udts.map((u) => `<div class="card"><h3 class="mono">${u.name}</h3><p class="note">${u.desc}</p><table class="t"><tbody>${u.members.map((m) => `<tr><td class="mono">${m.name}</td><td class="mono">${m.type}</td><td>${m.desc || ""}</td></tr>`).join("")}</tbody></table></div>`).join("");
  const draw = (q = "") => { q = q.toLowerCase(); $("#tagtb tbody").innerHTML = project.tags.filter((t) => !q || (t.name + " " + (t.desc || "")).toLowerCase().includes(q)).map((t) => `<tr><td class="mono">${t.name}</td><td class="mono">${t.type}</td><td>${t.desc || ""}</td></tr>`).join(""); };
  draw(); $("#tagq").addEventListener("input", (e) => draw(e.target.value));
}

async function main() {
  tabs();
  const xml = await (await fetch("LS01_LiftStation.L5X")).text();
  project = fromL5X(new DOMParser().parseFromString(xml, "text/xml"));
  const nR = project.programs.reduce((s, p) => s + p.routines.reduce((a, r) => a + r.rungs.length, 0), 0);
  $$('[data-n="rungs"]').forEach((e) => (e.textContent = nR));
  newRig(); initLive(); program();
  await results();
  document.body.dataset.ready = "1";
}
main().catch((e) => { console.error(e); document.body.insertAdjacentHTML("afterbegin", `<p style="padding:10px;background:#5a1d1d;color:#fff">Failed to start: ${e.message}. Serve this folder over HTTP.</p>`); });
