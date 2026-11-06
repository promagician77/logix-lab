// Wet well, two pumps with starters, floats and a 4-20 mA level transmitter.
// The plant reads PLC outputs and writes PLC inputs, like field wiring.
export const WELL = { area_m2: 4.0, depth_m: 3.0, hh_pct: 92, low_pct: 10 };
export const PUMP_LPS = [18, 30]; // station flow with 1 pump / 2 pumps running (system curve)

export function inflowDiurnal(t_s, storm = null, h0 = 0) {
  const h = (t_s / 3600 + h0) % 24;
  let q = 7 + 4 * Math.sin(((h - 9) / 24) * 2 * Math.PI); // 3 to 11 L/s
  if (storm && t_s >= storm.start && t_s < storm.end) {
    const u = (t_s - storm.start) / (storm.end - storm.start);
    q += storm.peak * Math.sin(Math.PI * u);
  }
  return q;
}

export class Plant {
  constructor(o = {}) {
    this.level_m = (o.level_pct ?? 30) / 100 * WELL.depth_m;
    this.inflow = o.inflow || ((t) => inflowDiurnal(t));
    this.pumps = [0, 1].map(() => ({ sel: "AUTO", contact: 0, fbk: 0, fbkTimer: 0, olTrip: 0, failToStart: 0, welded: 0 }));
    this.lt = { mode: "ok", stuck: null };   // ok | broken | stuck | fixed (mA)
    this.qin = 0; this.qout = 0; this.overflowed = 0; this.hh = 0; this.low = 0;
  }
  get level_pct() { return (100 * this.level_m) / WELL.depth_m; }
  set level_pct(v) { this.level_m = (v / 100) * WELL.depth_m; }
  step(T, dt_s, t_s) {
    let running = 0;
    this.pumps.forEach((p, i) => {
      const n = i + 1;
      const auto = p.sel === "AUTO" && T[`DO_P${n}_Run`];
      const energized = p.welded || ((p.sel === "HAND" || auto) && !p.olTrip && !p.failToStart);
      if (energized) { p.fbkTimer += dt_s; if (p.fbkTimer >= 0.4) p.fbk = 1; } else { p.fbkTimer = 0; p.fbk = 0; }
      p.contact = energized ? 1 : 0;
      if (p.fbk) running++;
      T[`DI_P${n}_Auto`] = p.sel === "AUTO" ? 1 : 0;
      T[`DI_P${n}_Hand`] = p.sel === "HAND" ? 1 : 0;
      T[`DI_P${n}_RunFbk`] = p.fbk;
      T[`DI_P${n}_OL_OK`] = p.olTrip ? 0 : 1;
    });
    this.qin = this.inflow(t_s);
    this.qout = running && this.level_m > 0.05 ? PUMP_LPS[running - 1] : 0;
    this.level_m += ((this.qin - this.qout) / 1000) * dt_s / WELL.area_m2;
    if (this.level_m >= WELL.depth_m) { this.level_m = WELL.depth_m; this.overflowed = 1; }
    if (this.level_m < 0) this.level_m = 0;
    const pct = this.level_pct;
    T.AI_LT101_mA = this.lt.mode === "broken" ? 0 : this.lt.mode === "fixed" ? this.lt.mA : this.lt.mode === "stuck" ? 4 + 0.16 * this.lt.stuck : 4 + 0.16 * pct;
    // floats have a mechanical differential (about 9 cm here): trip at the setting, reset 3 % past it
    if (pct >= WELL.hh_pct) this.hh = 1; else if (pct <= WELL.hh_pct - 3) this.hh = 0;
    if (pct <= WELL.low_pct) this.low = 1; else if (pct >= WELL.low_pct + 3) this.low = 0;
    T.DI_LSHH = this.hh ? 0 : 1;
    T.DI_LSL = this.low ? 0 : 1;
  }
}

// PLC + plant on one clock. dt_ms is the continuous-task scan time.
export class Rig {
  constructor(Controller, project, o = {}) {
    this.plc = new Controller(project); this.plant = new Plant(o.plant); this.t_ms = 0; this.dt = o.dt || 10;
    this.T = this.plc.T;
  }
  get t() { return this.t_ms / 1000; }
  step() { this.plant.step(this.T, this.dt / 1000, this.t); this.plc.scan(this.dt); this.t_ms += this.dt; }
  run(sec, each) { const end = this.t_ms + sec * 1000; while (this.t_ms < end) { this.step(); if (each) each(this); } }
  until(pred, maxSec) { const end = this.t_ms + maxSec * 1000; while (this.t_ms < end) { this.step(); if (pred(this)) return this.t; } return null; }
  hmi(path, v = 1) { this.plc.set(path, v); }
}
