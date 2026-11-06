// Scenario tests: each one drives the plant + PLC and asserts observable behaviour.
// basic: true marks the short "site check" set (start/stop/lag/overload/reset) used as the
// comparison baseline in mutation testing.
import { Rig, inflowDiurnal } from "../sim/plant.js";

export class Fail extends Error {}
const ok = (c, msg) => { if (!c) throw new Fail(msg); };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);
const flat = (q) => () => q;
const lvl = (r) => r.plant.level_pct;

export function makeScenarios(Controller, project) {
  const rig = (o = {}) => new Rig(Controller, project, o);
  const S = [];
  const add = (id, name, basic, fn) => S.push({ id, name, basic, fn });

  add("B1", "Lead pump starts at the lead-on level", true, () => {
    const r = rig({ plant: { level_pct: 50, inflow: flat(8) } });
    ok(r.until((x) => x.T.P1.Cmd_Run, 200) != null, "lead pump never commanded");
    const at = lvl(r); ok(at >= 55 && at <= 55.5, `started at ${at.toFixed(2)} %, expected 55 %`);
    return { start_level_pct: +at.toFixed(2) };
  });
  add("B2", "Pump stops at the all-off level", true, () => {
    const r = rig({ plant: { level_pct: 56, inflow: flat(8) } });
    r.until((x) => x.T.P1.RunFbk, 30);
    ok(r.until((x) => !x.T.Lead_Call, 900) != null, "lead call never dropped");
    const at = lvl(r); ok(at <= 25 && at >= 24.5, `stopped at ${at.toFixed(2)} %, expected 25 %`);
    return { stop_level_pct: +at.toFixed(2) };
  });
  add("B3", "Lag pump starts at the lag-on level", true, () => {
    const r = rig({ plant: { level_pct: 54, inflow: flat(25) } });
    ok(r.until((x) => x.T.P2.Cmd_Run, 900) != null, "lag pump never commanded");
    const at = lvl(r); ok(at >= 75, `lag started at ${at.toFixed(2)} %`);
    ok(r.until((x) => x.T.P2.RunFbk && x.T.P1.RunFbk, 5) != null, "both pumps not running");
    return { lag_start_level_pct: +at.toFixed(2) };
  });
  add("B4", "Overload trip stops the pump and raises a fault", true, () => {
    const r = rig({ plant: { level_pct: 60, inflow: flat(8) } });
    r.run(10); ok(r.T.P1.RunFbk, "P1 not running before trip");
    r.plant.pumps[0].olTrip = 1; r.run(1);
    ok(!r.T.P1.Cmd_Run && r.T.P1.Fault && r.T.ALM_P1_Fault.Active, "P1 still commanded or no fault");
    return {};
  });
  add("B5", "Fault reset from the HMI", true, () => {
    const r = rig({ plant: { level_pct: 60, inflow: flat(8) } });
    r.run(10); r.plant.pumps[0].olTrip = 1; r.run(1); r.plant.pumps[0].olTrip = 0; r.run(0.5);
    r.hmi("P1.HMI_Reset"); r.run(0.1);
    ok(!r.T.P1.Fault, "fault not cleared by reset");
    return {};
  });

  add("F1", "Alternation: lead changes every cycle", false, () => {
    const r = rig({ plant: { level_pct: 54, inflow: flat(8) } }); const order = [];
    for (let k = 0; k < 3; k++) {
      ok(r.until((x) => x.T.P1.RunFbk || x.T.P2.RunFbk, 900) != null, `cycle ${k + 1} did not start`);
      order.push(r.T.P1.RunFbk ? "P1" : "P2");
      ok(r.until((x) => !x.T.P1.RunFbk && !x.T.P2.RunFbk, 900) != null, `cycle ${k + 1} did not stop`);
    }
    ok(order.join() === "P1,P2,P1", `lead order ${order.join()}`);
    return { order: order.join(" → ") };
  });
  add("F2", "Lag start is staggered 3 s after the lead", false, () => {
    const r = rig({ plant: { level_pct: 80, inflow: flat(20) } });
    const t1 = r.until((x) => x.T.P1.Cmd_Run, 5), t2 = r.until((x) => x.T.P2.Cmd_Run, 10);
    ok(t1 != null && t2 != null, "pumps not commanded"); near(t2 - t1, 3.0, 0.05, "stagger");
    return { stagger_s: +(t2 - t1).toFixed(2) };
  });
  add("F3", "Fail-to-start: fault in 5 s and the other pump takes over", false, (rec) => {
    const r = rig({ plant: { level_pct: 54.9, inflow: flat(8) } }); r.plant.pumps[0].failToStart = 1;
    const series = [];
    const sample = (x) => { if (rec && Math.round(x.t_ms) % 100 === 0) series.push([+x.t.toFixed(1), x.T.P1.Cmd_Run, x.T.P1.RunFbk, x.T.P1.Fault, x.T.P2.Cmd_Run, x.T.P2.RunFbk]); };
    const t0 = r.until((x) => (sample(x), x.T.P1.Cmd_Run), 60);
    const t1 = r.until((x) => (sample(x), x.T.P1.Flt_FTS), 10);
    const t2 = r.until((x) => (sample(x), x.T.P2.RunFbk), 5);
    ok(t0 != null && t1 != null && t2 != null, "sequence incomplete");
    near(t1 - t0, 5.0, 0.03, "fail-to-start detection"); ok(t2 - t1 <= 0.5, `take-over took ${(t2 - t1).toFixed(2)} s`);
    ok(r.T.ALM_P1_Fault.Active && r.T.DO_Beacon, "no alarm / beacon");
    if (rec) r.run(4, sample);
    return { detect_s: +(t1 - t0).toFixed(2), takeover_s: +(t2 - t1).toFixed(2), series, t0: +t0.toFixed(1) };
  });
  add("F4", "Overload while running: the other pump takes over", false, () => {
    const r = rig({ plant: { level_pct: 60, inflow: flat(8) } }); r.run(10);
    r.plant.pumps[0].olTrip = 1; const t = r.t;
    const t2 = r.until((x) => x.T.P2.RunFbk, 3); ok(t2 != null, "P2 did not start"); ok(t2 - t <= 1.0, `take-over ${(t2 - t).toFixed(2)} s`);
    return { takeover_s: +(t2 - t).toFixed(2) };
  });
  add("F5", "Reset refused while the overload is still tripped; request always cleared", false, () => {
    const r = rig({ plant: { level_pct: 60, inflow: flat(8) } }); r.run(10);
    r.plant.pumps[0].olTrip = 1; r.run(1); r.hmi("P1.HMI_Reset"); r.step();
    ok(r.T.P1.Fault, "fault cleared while overload still tripped"); ok(!r.T.P1.HMI_Reset, "reset request not cleared by PLC");
    r.plant.pumps[0].olTrip = 0; r.run(0.5); ok(r.T.P1.Flt_OL, "fault cleared itself when the overload reset (must stay latched)");
    r.hmi("P1.HMI_Reset"); r.step();
    ok(!r.T.P1.Fault && !r.T.P1.HMI_Reset, "fault not cleared after overload reset");
    r.plant.pumps[0].failToStart = 1; r.hmi("P2.HMI_OOS"); r.until((x) => x.T.P1.Flt_FTS, 20); r.plant.pumps[0].failToStart = 0; r.run(1);
    ok(r.T.P1.Flt_FTS, "fail-to-start fault not latched"); r.hmi("P1.HMI_Reset"); r.step(); ok(!r.T.P1.Flt_FTS, "fail-to-start fault not reset");
    return {};
  });
  add("F6", "Broken transmitter (0 mA): float backup control", false, () => {
    const r = rig({ plant: { level_pct: 50, inflow: flat(10) } }); r.plant.lt.mode = "broken";
    const tb = r.until((x) => x.T.LT101_Bad, 5); ok(tb != null, "transmitter fault not detected"); near(tb, 2.0, 0.03, "fault filter");
    ok(r.T.ALM_LT101.Active || r.until((x) => x.T.ALM_LT101.Active, 0.1) != null, "no LT alarm");
    const ts = r.until((x) => x.T.P1.Cmd_Run || x.T.P2.Cmd_Run, 900); const at = lvl(r);
    ok(r.until((x) => x.T.ALM_HighLevel.Active, 6) != null, "no high level alarm from the float in backup mode");
    ok(ts != null && at >= 91.9, `backup start at ${at.toFixed(1)} %`);
    r.run(4); ok(r.T.P1.RunFbk && r.T.P2.RunFbk, "backup should run both pumps");
    ok(r.until((x) => !x.T.P1.Cmd_Run && !x.T.P2.Cmd_Run, 900) != null, "backup never stopped");
    const st = lvl(r); ok(st <= 10.05 && st > 8, `backup stop at ${st.toFixed(1)} %`);
    let restart = 0; r.run(240, (x) => { restart |= x.T.P1.Cmd_Run | x.T.P2.Cmd_Run; }); ok(!restart, "backup restarted before the high-high float (short cycling)");
    return { detect_s: +tb.toFixed(2), backup_start_pct: +at.toFixed(1), backup_stop_pct: +st.toFixed(1) };
  });
  add("F7", "Stuck transmitter (reads 60 %): caught by the low float, no short cycling", false, () => {
    const r = rig({ plant: { level_pct: 30, inflow: flat(8) } }); r.plant.lt = { mode: "stuck", stuck: 60 };
    let starts = 0, prev = 0, tLow = null, tDis = null;
    r.run(1800, (x) => {
      const on = x.T.P1.RunFbk || x.T.P2.RunFbk; if (on && !prev) starts++; prev = on;
      if (tLow == null && !x.T.DI_LSL) tLow = x.t; if (tDis == null && x.T.LT_Disagree) tDis = x.t;
    });
    ok(tDis != null && tLow != null, "disagreement not detected"); ok(tDis - tLow <= 5.1, `disagreement after ${(tDis - tLow).toFixed(1)} s`);
    ok(starts <= 3, `${starts} pump starts in 30 min (short cycling)`); ok(!r.plant.overflowed, "overflow");
    return { disagree_after_low_float_s: +(tDis - tLow).toFixed(2), starts_30min: starts };
  });
  add("F8", "Invalid HMI setpoint rejected; last good set kept", false, () => {
    const r = rig({ plant: { level_pct: 30, inflow: flat(8) } }); r.hmi("SP_LeadOn", 20); r.run(1);
    ok(!r.T.SP_Valid && r.T.SPV_LeadOn === 55 && r.T.ALM_SPInvalid.Active, "bad setpoint accepted or no alarm");
    r.run(60); ok(!r.T.P1.Cmd_Run && !r.T.P2.Cmd_Run, "pump started on the rejected setpoint");
    r.hmi("SP_LeadOn", 40); r.run(0.1); ok(r.T.SP_Valid && r.T.SPV_LeadOn === 40, "valid setpoint not accepted");
    ok(r.until((x) => x.T.P1.Cmd_Run, 300) != null && Math.abs(lvl(r) - 40) < 0.5, "did not start at new setpoint");
    return {};
  });
  add("F9", "Out of service from the HMI: the other pump leads", false, () => {
    const r = rig({ plant: { level_pct: 54, inflow: flat(8) } }); r.hmi("P1.HMI_OOS");
    let p1 = 0; ok(r.until((x) => (p1 |= x.T.P1.RunFbk, x.T.P2.RunFbk), 200) != null, "P2 did not start");
    r.until((x) => (p1 |= x.T.P1.RunFbk, !x.T.P2.RunFbk), 900); ok(!p1, "P1 ran while out of service");
    return {};
  });
  add("F10", "HAND: PLC monitors only, no uncommanded alarm, auto uses the other pump", false, () => {
    const r = rig({ plant: { level_pct: 50, inflow: flat(25) } }); r.plant.pumps[0].sel = "HAND";
    r.run(10); ok(r.T.P1.RunFbk && !r.T.P1.Cmd_Run && !r.T.P1.Avail, "HAND state wrong");
    ok(!r.T.P1.Flt_Uncmd, "uncommanded alarm in HAND");
    ok(r.until((x) => x.T.P2.Cmd_Run, 900) != null, "P2 did not take auto duty");
    return {};
  });
  add("F11", "Running without command in AUTO raises an alarm in 3 s", false, () => {
    const r = rig({ plant: { level_pct: 30, inflow: flat(8) } }); r.plant.pumps[0].welded = 1;
    const t = r.until((x) => x.T.ALM_P1_Uncmd.Active, 6); ok(t != null, "no alarm"); near(t, 3.42, 0.05, "alarm time (0.4 s feedback + 3 s)");
    return { alarm_s: +t.toFixed(2) };
  });
  add("F12", "No pump available raises an alarm", false, () => {
    const r = rig({ plant: { level_pct: 30, inflow: flat(8) } }); r.hmi("P1.HMI_OOS"); r.hmi("P2.HMI_OOS");
    const t = r.until((x) => x.T.ALM_NoPump.Active, 4); ok(t != null, "no alarm"); near(t, 2.0, 0.05, "alarm delay");
    return {};
  });
  add("F13", "Acknowledge: handshake cleared, new alarms still need acknowledging", false, () => {
    const r = rig({ plant: { level_pct: 60, inflow: flat(8) } }); r.run(10);
    r.plant.pumps[0].olTrip = 1; r.run(0.5); ok(r.T.ALM_P1_Fault.Unack && r.T.DO_Beacon, "alarm not raised");
    r.hmi("HMI_AckAll"); r.step(); ok(!r.T.ALM_P1_Fault.Unack && r.T.ALM_P1_Fault.Active && !r.T.HMI_AckAll, "ack not handled");
    r.run(0.2); ok(!r.T.DO_Beacon, "beacon still on after ack");
    // the HMI wrote ack once and lost comms: the bit must not stay set and swallow new alarms
    r.plant.pumps[1].olTrip = 1; r.run(1); ok(r.T.ALM_P2_Fault.Unack && r.T.DO_Beacon, "new alarm auto-acknowledged");
    return {};
  });
  add("F14", "Storm day (6 h): no overflow, lag used, starts shared", false, (rec) => {
    const storm = { start: 7200, end: 14400, peak: 16 };
    const r = rig({ dt: 50, plant: { level_pct: 30, inflow: (t) => inflowDiurnal(t, storm, 6) } });
    let maxL = 0, lagStarts = 0, prevBoth = 0, on1 = 0, on2 = 0; const series = [];
    r.run(6 * 3600, (x) => { on1 += x.T.P1.RunFbk * x.dt; on2 += x.T.P2.RunFbk * x.dt;
      const L = lvl(x); if (L > maxL) maxL = L;
      const both = x.T.P1.RunFbk && x.T.P2.RunFbk; if (both && !prevBoth) lagStarts++; prevBoth = both;
      if (rec && x.t_ms % 30000 === 0) series.push([+(x.t / 60).toFixed(1), +L.toFixed(2), x.T.P1.RunFbk, x.T.P2.RunFbk, +x.plant.qin.toFixed(2)]);
    });
    ok(!r.plant.overflowed && maxL < 92, `max level ${maxL.toFixed(1)} %`); ok(lagStarts > 0, "lag never needed: storm too small");
    const h1 = r.T.P1.RunSec, h2 = r.T.P2.RunSec, bal = Math.abs(h1 - h2) / Math.max(h1, h2);
    ok(Math.abs(r.T.P1.Starts - r.T.P2.Starts) <= 1, `starts P1 ${r.T.P1.Starts} vs P2 ${r.T.P2.Starts}`);
    ok(Math.abs(h1 - on1 / 1000) <= r.T.P1.Starts + 1 && Math.abs(h2 - on2 / 1000) <= r.T.P2.Starts + 1, `run seconds ${h1}/${h2} vs running ${(on1 / 1000).toFixed(0)}/${(on2 / 1000).toFixed(0)} s`);
    return { max_level_pct: +maxL.toFixed(1), lag_starts: lagStarts, p1_run_s: h1, p2_run_s: h2, p1_starts: r.T.P1.Starts, p2_starts: r.T.P2.Starts, imbalance_pct: +(100 * bal).toFixed(1), series };
  });
  add("F15", "Run hours exact (periodic task) at a 17 ms scan", false, () => {
    const r = rig({ dt: 17, plant: { level_pct: 50, inflow: flat(30) } }); r.plant.pumps[0].sel = "HAND"; r.plant.pumps[1].sel = "HAND";
    r.run(0.5); const s0 = r.T.P1.RunSec, s1 = r.T.P2.RunSec; r.run(7200);
    near(r.T.P1.RunSec - s0, 7200, 1, "P1 run seconds over 2 h"); near(r.T.P2.RunSec - s1, 7200, 1, "P2 run seconds over 2 h");
    near(r.T.P1.RunHrs, r.T.P1.RunSec / 3600, 1e-6, "P1 hours"); near(r.T.P2.RunHrs, r.T.P2.RunSec / 3600, 1e-6, "P2 hours");
    return { run_s_counted: r.T.P1.RunSec - s0 };
  });
  add("F16", "Start counter: one count per start", false, () => {
    const r = rig({ plant: { level_pct: 54, inflow: flat(8) } });
    for (let k = 0; k < 3; k++) { r.until((x) => x.T.P1.RunFbk || x.T.P2.RunFbk, 900); r.until((x) => !x.T.P1.RunFbk && !x.T.P2.RunFbk, 900); }
    ok(r.T.P1.Starts === 2 && r.T.P2.Starts === 1, `starts P1 ${r.T.P1.Starts}, P2 ${r.T.P2.Starts}`);
    return {};
  });
  add("F17", "Power-up: requests left set by the HMI are cleared, not acted on", false, () => {
    const r = rig({ plant: { level_pct: 30, inflow: flat(8) } });
    // retained state from before the power cycle, plus stale HMI requests
    for (const [k, v] of [["P1.Flt_OL", 1], ["P2.Flt_FTS", 1], ["ALM_P1_Fault.Unack", 1], ["LT_Disagree", 1], ["HMI_AckAll", 1], ["HMI_LTReset", 1], ["P1.HMI_Reset", 1], ["P2.HMI_Reset", 1]]) r.hmi(k, v);
    r.step();
    ok(!r.T.HMI_AckAll && !r.T.HMI_LTReset && !r.T.P1.HMI_Reset && !r.T.P2.HMI_Reset, "request bits survived first scan");
    ok(r.T.P1.Flt_OL && r.T.P2.Flt_FTS, "stale reset cleared a fault at power-up");
    ok(r.T.ALM_P1_Fault.Unack, "stale ack acknowledged an alarm at power-up"); ok(r.T.LT_Disagree, "stale LT reset acted at power-up");
    return {};
  });
  add("F18", "Low float is a hard cut-out below a low all-off setpoint", false, () => {
    const r = rig({ plant: { level_pct: 56, inflow: flat(8) } }); r.hmi("SP_AllOff", 8);
    r.until((x) => x.T.P1.RunFbk, 30); ok(r.until((x) => !x.T.P1.Cmd_Run, 900) != null, "never stopped");
    const at = lvl(r); ok(at <= 10.02 && at > 9, `stopped at ${at.toFixed(2)} %`);
    return { stop_level_pct: +at.toFixed(2) };
  });
  add("F19", "High-high float alarms even with both pumps out of service", false, () => {
    const r = rig({ plant: { level_pct: 88, inflow: flat(20) } }); r.hmi("P1.HMI_OOS"); r.hmi("P2.HMI_OOS");
    const th = r.until((x) => !x.T.DI_LSHH, 300); const ta = r.until((x) => x.T.ALM_HiHiFloat.Active, 3);
    ok(th != null && ta != null, "no high-high alarm"); near(ta - th, 1.0, 0.03, "alarm delay"); ok(r.T.ALM_HighLevel.Active, "no high level alarm");
    return {};
  });
  add("F20", "Lead goes to P1 when the alternator picks P2 but P2 is faulted", false, () => {
    const r = rig({ plant: { level_pct: 54, inflow: flat(8) } }); r.hmi("Lead_Idx", 1);
    r.plant.pumps[1].olTrip = 1; r.run(0.5);
    ok(r.until((x) => x.T.P1.RunFbk, 200) != null, "P1 did not lead");
    return {};
  });

  // ---- pump 2 mirrors (P2 made lead through the alternator index) ----
  add("F3b", "P2 fail-to-start: fault in 5 s and P1 takes over", false, () => {
    const r = rig({ plant: { level_pct: 54.9, inflow: flat(8) } }); r.hmi("Lead_Idx", 1); r.plant.pumps[1].failToStart = 1;
    const t0 = r.until((x) => x.T.P2.Cmd_Run, 60), t1 = r.until((x) => x.T.P2.Flt_FTS, 10), t2 = r.until((x) => x.T.P1.RunFbk, 5);
    ok(t0 != null && t1 != null && t2 != null, "sequence incomplete"); near(t1 - t0, 5.0, 0.03, "detection"); ok(t2 - t1 <= 0.5, "take-over slow");
    ok(r.T.ALM_P2_Fault.Active, "no P2 alarm"); return { detect_s: +(t1 - t0).toFixed(2) };
  });
  add("F4b", "P2 overload while running: P1 takes over", false, () => {
    const r = rig({ plant: { level_pct: 60, inflow: flat(8) } }); r.hmi("Lead_Idx", 1); r.run(10); ok(r.T.P2.RunFbk && !r.T.P1.RunFbk, "P2 not lead");
    r.plant.pumps[1].olTrip = 1; const t = r.t; const t2 = r.until((x) => x.T.P1.RunFbk, 3);
    ok(t2 != null && t2 - t <= 1.0, "P1 did not take over"); ok(!r.T.P2.Cmd_Run && r.T.P2.Flt_OL, "P2 still commanded"); return {};
  });
  add("F5b", "P2 reset refused while tripped; request always cleared", false, () => {
    const r = rig({ plant: { level_pct: 60, inflow: flat(8) } }); r.hmi("Lead_Idx", 1); r.run(10);
    r.plant.pumps[1].olTrip = 1; r.run(1); r.hmi("P2.HMI_Reset"); r.step();
    ok(r.T.P2.Fault && !r.T.P2.HMI_Reset, "reset accepted while tripped, or request left set");
    r.plant.pumps[1].olTrip = 0; r.run(0.5); ok(r.T.P2.Flt_OL, "P2 fault cleared itself (must stay latched)");
    r.hmi("P2.HMI_Reset"); r.step(); ok(!r.T.P2.Fault && !r.T.P2.HMI_Reset, "P2 fault not reset");
    r.plant.pumps[1].failToStart = 1; r.hmi("P1.HMI_OOS"); r.until((x) => x.T.P2.Flt_FTS, 20); r.plant.pumps[1].failToStart = 0; r.hmi("P2.HMI_Reset"); r.step();
    ok(!r.T.P2.Flt_FTS, "fail-to-start fault not reset"); return {};
  });
  add("F11b", "P2 running without command raises an alarm; not in HAND", false, () => {
    const r = rig({ plant: { level_pct: 30, inflow: flat(8) } }); r.plant.pumps[1].welded = 1;
    const t = r.until((x) => x.T.ALM_P2_Uncmd.Active, 6); ok(t != null, "no alarm"); near(t, 3.42, 0.05, "alarm time");
    r.plant.pumps[1].welded = 0; r.plant.pumps[1].sel = "HAND"; r.run(10); ok(!r.T.P2.Flt_Uncmd && !r.T.ALM_P2_Uncmd.Active, "alarm in HAND"); return {};
  });

  // ---- coverage added after mutation testing round 1 ----
  add("F21", "Normal operation for 2 h raises no alarm and no fault", false, () => {
    const r = rig({ dt: 50, plant: { level_pct: 40, inflow: (t) => inflowDiurnal(t, null, 8) } });
    let bad = null;
    r.run(7200, (x) => { if (bad) return; for (const [n, v] of Object.entries(x.T)) if (n.startsWith("ALM_") && typeof v === "object" && (v.Active || v.Unack || v.Cond)) bad = n;
      if (x.T.P1.Fault || x.T.P2.Fault || x.T.P1.Flt_Uncmd || x.T.P2.Flt_Uncmd || x.T.LT101_Bad || !x.T.SP_Valid || x.T.DO_Beacon) bad = bad || "fault/status"; });
    ok(!bad, `unexpected ${bad}`); ok(r.T.P1.Starts > 0 && r.T.P2.Starts > 0, "no cycling"); return {};
  });
  add("F22", "Every alarm: delay, unacknowledged, return to normal, acknowledge", false, () => {
    const cases = [
      ["ALM_HighLevel", 5.0, (r) => { r.hmi("P1.HMI_OOS"); r.hmi("P2.HMI_OOS"); r.plant.level_pct = 86; }, (r) => { r.plant.level_pct = 80; }],
      ["ALM_HiHiFloat", 1.0, (r) => { r.hmi("P1.HMI_OOS"); r.hmi("P2.HMI_OOS"); r.plant.level_pct = 93; }, (r) => { r.plant.level_pct = 80; }],
      ["ALM_LT101", 2.0, (r) => { r.plant.lt = { mode: "broken" }; }, (r) => { r.plant.lt = { mode: "ok" }; }],
      ["ALM_P1_Fault", 0, (r) => { r.plant.pumps[0].olTrip = 1; }, (r) => { r.plant.pumps[0].olTrip = 0; r.run(0.2); r.hmi("P1.HMI_Reset"); }],
      ["ALM_P2_Fault", 0, (r) => { r.plant.pumps[1].olTrip = 1; }, (r) => { r.plant.pumps[1].olTrip = 0; r.run(0.2); r.hmi("P2.HMI_Reset"); }],
      ["ALM_P1_Uncmd", 3.4, (r) => { r.plant.pumps[0].welded = 1; }, (r) => { r.plant.pumps[0].welded = 0; }],
      ["ALM_P2_Uncmd", 3.4, (r) => { r.plant.pumps[1].welded = 1; }, (r) => { r.plant.pumps[1].welded = 0; }],
      ["ALM_NoPump", 2.0, (r) => { r.hmi("P1.HMI_OOS"); r.hmi("P2.HMI_OOS"); }, (r) => { r.hmi("P2.HMI_OOS", 0); }],
      ["ALM_SPInvalid", 0, (r) => { r.hmi("SP_LagOn", 50); }, (r) => { r.hmi("SP_LagOn", 75); }],
    ];
    const timing = {};
    for (const [a, dly, raise, clear] of cases) {
      const r = rig({ plant: { level_pct: 30, inflow: flat(0) } }); r.run(1);
      ok(!r.T[a].Active && !r.T[a].Unack, `${a} active before the event`);
      raise(r); const t0 = r.t;
      if (dly >= 1) { r.run(dly - 0.5); r.hmi("HMI_AckAll"); r.step(); ok(!r.T.DO_Beacon && !r.T[a].Active, `${a} early or beacon from another alarm`); }
      const t1 = r.until((x) => x.T[a].Active, dly + 2);
      ok(t1 != null, `${a} never active`); ok(t1 - t0 >= dly - 0.05 && t1 - t0 <= dly + 0.12, `${a} after ${(t1 - t0).toFixed(2)} s, expected ${dly} s`);
      ok(r.T[a].Unack && r.T.DO_Beacon, `${a} not unacknowledged / no beacon`); timing[a] = +(t1 - t0).toFixed(2);
      clear(r); ok(r.until((x) => !x.T[a].Active, 3) != null, `${a} did not return to normal`);
      ok(r.T[a].Unack, `${a} unack lost on return to normal`);
      r.hmi("HMI_AckAll"); r.step(); ok(!r.T[a].Unack && !r.T.HMI_AckAll, `${a} ack failed`); r.run(0.1); ok(!r.T.DO_Beacon, `beacon on after ${a} acked`);
      // second occurrence, acknowledged while still active: must stay acknowledged
      raise(r); ok(r.until((x) => x.T[a].Active, dly + 2) != null && r.T[a].Unack, `${a} second occurrence not raised`);
      r.hmi("HMI_AckAll"); r.step(); r.run(0.5); ok(!r.T[a].Unack, `${a} came back unacknowledged while still active`);
    }
    for (const n of [1, 2]) { const r = rig({ plant: { level_pct: 30, inflow: flat(0) } }); r.hmi(`P${n}.HMI_OOS`); r.run(3); ok(!r.T.ALM_NoPump.Active, `no-pump alarm with only P${n} out of service`); }
    return { alarm_delays_s: Object.values(timing).join(" / ") };
  });
  add("F23", "Setpoint validation at every boundary", false, () => {
    const cases = [[{ SP_LeadOn: 30 }, 1], [{ SP_LeadOn: 29.9 }, 0], [{ SP_LagOn: 60 }, 1], [{ SP_LagOn: 59.9 }, 0], [{ SP_HighAlm: 75.1 }, 1], [{ SP_HighAlm: 75 }, 0],
      [{ SP_AllOff: 5 }, 1], [{ SP_AllOff: 4.9 }, 0], [{ SP_HighAlm: 95 }, 1], [{ SP_HighAlm: 95.1 }, 0], [{ SP_HighAlm: 4.9, SP_LagOn: 4, SP_LeadOn: 3, SP_AllOff: 1 }, 0]];
    for (const [sp, valid] of cases) {
      const r = rig({ plant: { level_pct: 30, inflow: flat(0) } }); for (const [k, v] of Object.entries(sp)) r.hmi(k, v); r.step();
      ok(r.T.SP_Valid === valid, `${JSON.stringify(sp)} should be ${valid ? "valid" : "rejected"}`);
      for (const [k, v] of Object.entries(sp)) ok(r.T["SPV_" + k.slice(3)] === (valid ? v : { SP_LeadOn: 55, SP_LagOn: 75, SP_AllOff: 25, SP_HighAlm: 85 }[k]), `SPV for ${k} wrong`);
    }
    return { cases: cases.length };
  });
  add("F24", "Transmitter limits per NE 43 (3.6 mA and 21 mA)", false, () => {
    for (const [mA, fault] of [[3.6, 0], [3.5, 1], [21.0, 0], [21.5, 1]]) {
      const r = rig({ plant: { level_pct: 30, inflow: flat(0) } }); r.plant.lt = { mode: "fixed", mA };
      const t = r.until((x) => x.T.LT101_Fault, 3);
      ok(fault ? t != null && Math.abs(t - 2) < 0.05 : t == null, `${mA} mA: fault ${t == null ? "no" : t.toFixed(2) + " s"}, expected ${fault ? "at 2 s" : "none"}`);
      if (mA > 21) { r.run(8); ok(!r.T.ALM_HighLevel.Active, "a failed transmitter reading over-range raised a high level alarm"); }
    }
    return {};
  });
  add("F25", "Transmitter stuck low: caught by the high-high float, pumps run on floats", false, () => {
    const r = rig({ plant: { level_pct: 30, inflow: flat(12) } }); r.plant.lt = { mode: "stuck", stuck: 30 };
    const th = r.until((x) => !x.T.DI_LSHH, 1200), td = r.until((x) => x.T.LT_Disagree, 10);
    ok(th != null && td != null, "disagreement not detected"); ok(td - th <= 5.1, `latched ${(td - th).toFixed(1)} s after high-high`);
    ok(r.until((x) => x.T.P1.RunFbk && x.T.P2.RunFbk, 5) != null, "backup did not start both pumps");
    ok(r.until((x) => !x.T.P1.Cmd_Run && !x.T.P2.Cmd_Run, 1200) != null && lvl(r) <= 10.05, "backup did not pump down to the low float");
    ok(!r.plant.overflowed, "overflow"); return { latched_after_hh_s: +(td - th).toFixed(2) };
  });
  add("F26", "Transmitter disagreement reset: refused while disagreeing, accepted once fixed", false, () => {
    const r = rig({ plant: { level_pct: 30, inflow: flat(8) } }); r.plant.lt = { mode: "stuck", stuck: 60 };
    r.until((x) => x.T.LT_Disagree, 600); r.run(1); r.hmi("HMI_LTReset"); r.step();
    ok(r.T.LT_Disagree && !r.T.HMI_LTReset, "reset accepted while still disagreeing, or request left set");
    r.plant.lt = { mode: "ok" }; r.run(6); r.hmi("HMI_LTReset"); r.step(); ok(!r.T.LT_Disagree && !r.T.LT101_Bad, "reset refused after repair");
    r.plant.level_pct = 54; ok(r.until((x) => x.T.P1.Cmd_Run || x.T.P2.Cmd_Run, 200) != null && Math.abs(lvl(r) - 55) < 0.6, "normal control not restored");
    return {};
  });
  add("F27", "P1 runs as lag when P2 is lead", false, () => {
    const r = rig({ plant: { level_pct: 54, inflow: flat(25) } }); r.hmi("Lead_Idx", 1);
    ok(r.until((x) => x.T.P2.Cmd_Run, 100) != null && !r.T.P1.Cmd_Run, "P2 not lead");
    ok(r.until((x) => x.T.P1.Cmd_Run, 900) != null && lvl(r) >= 75, "P1 did not start as lag");
    r.plant.inflow = flat(8); ok(r.until((x) => !x.T.P1.Cmd_Run && !x.T.P2.Cmd_Run, 900) != null, "did not stop");
    let both = 0; ok(r.until((x) => (both |= x.T.P1.Cmd_Run & x.T.P2.Cmd_Run, x.T.P1.Cmd_Run || x.T.P2.Cmd_Run), 900) != null, "next cycle did not start");
    r.run(120, (x) => { both |= x.T.P1.Cmd_Run & x.T.P2.Cmd_Run; }); ok(!both, "lag demand stuck on: both pumps ran on a normal cycle"); return {};
  });
  add("F28", "Inflow above station capacity: high-high reached, then pumps stop at all-off (not the low float)", false, () => {
    let q = 34; const r = rig({ plant: { level_pct: 70, inflow: () => q } });
    ok(r.until((x) => !x.T.DI_LSHH, 3600) != null, "high-high not reached"); ok(r.T.P1.RunFbk && r.T.P2.RunFbk, "both pumps should run");
    q = 5; ok(r.until((x) => !x.T.P1.Cmd_Run && !x.T.P2.Cmd_Run, 3600) != null, "never stopped");
    const at = lvl(r); ok(at <= 25.05 && at >= 24.5, `stopped at ${at.toFixed(1)} %, expected all-off 25 %`); ok(!r.T.Bkp_Dmd, "float backup engaged with a healthy transmitter");
    return { stop_level_pct: +at.toFixed(1) };
  });
  add("F29", "HOA changes take effect: AUTO → OFF → AUTO, HAND → OFF", false, () => {
    const r = rig({ plant: { level_pct: 30, inflow: flat(0) } });
    for (const n of [1, 2]) {
      const p = r.plant.pumps[n - 1], P = () => r.T[`P${n}`];
      r.run(0.2); ok(P().Avail, `P${n} not available in AUTO`);
      p.sel = "OFF"; r.run(0.2); ok(!P().Avail && !P().HOA_Auto, `P${n} still available in OFF`);
      p.sel = "HAND"; r.run(1); ok(P().HOA_Hand && P().RunFbk, `P${n} HAND not seen`);
      p.sel = "OFF"; r.run(0.2); ok(!P().HOA_Hand, `P${n} HAND stuck`);
      p.sel = "AUTO"; r.run(0.2); ok(P().Avail, `P${n} not back in AUTO`);
    }
    return {};
  });
  add("F30", "An unavailable pump never runs: not as lag, not when nothing else is available", false, () => {
    const r = rig({ plant: { level_pct: 54, inflow: flat(25) } }); r.hmi("P1.HMI_OOS"); let p1 = 0;
    ok(r.until((x) => (p1 |= x.T.P1.Cmd_Run, x.T.Lag_Call), 900) != null, "lag never called"); r.run(60, (x) => { p1 |= x.T.P1.Cmd_Run; });
    ok(!p1, "out-of-service P1 ran as lag");
    const r2 = rig({ plant: { level_pct: 54, inflow: flat(25) } }); r2.hmi("P2.HMI_OOS"); let p2 = 0;
    ok(r2.until((x) => (p2 |= x.T.P2.Cmd_Run, x.T.Lag_Call), 900) != null, "lag never called (P2 case)"); r2.run(60, (x) => { p2 |= x.T.P2.Cmd_Run; });
    ok(!p2, "out-of-service P2 ran as lag");
    const q = rig({ plant: { level_pct: 60, inflow: flat(8) } }); q.hmi("Lead_Idx", 1); q.hmi("P1.HMI_OOS"); q.plant.pumps[1].olTrip = 1; let any = 0;
    q.run(30, (x) => { any |= x.T.P1.Cmd_Run | x.T.P2.Cmd_Run; }); ok(!any, "a pump ran with none available");
    return {};
  });
  return S;
}

export function runScenario(s, rec = false) {
  const t0 = performance.now();
  try { const m = s.fn(rec); return { id: s.id, pass: true, ms: performance.now() - t0, m }; }
  catch (e) { if (!(e instanceof Fail)) throw e; return { id: s.id, pass: false, ms: performance.now() - t0, msg: e.message }; }
}
