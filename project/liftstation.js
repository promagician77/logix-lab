// LS-01 duplex lift station: source of the Studio 5000 project (built into LS01_LiftStation.L5X).
// Rung text is Rockwell neutral text: the same text Logix Designer shows in its ASCII rung editor.

const B = "BOOL", D = "DINT", R = "REAL";
const pumpMembers = [
  ["HOA_Auto", B, "Selector in AUTO (from field)"], ["HOA_Hand", B, "Selector in HAND (hardwired run, PLC monitors only)"],
  ["RunFbk", B, "Motor contactor auxiliary: running"], ["OL_Trip", B, "Overload relay tripped (field contact is NC)"],
  ["Call", B, "Auto demand from lead/lag"], ["Avail", B, "Available: AUTO, healthy, in service"], ["Cmd_Run", B, "Run command to starter"],
  ["Flt_FTS", B, "Fault: failed to start (latched)"], ["Flt_OL", B, "Fault: overload trip (latched)"], ["Flt_Uncmd", B, "Running without command in AUTO"],
  ["Fault", B, "Any latched fault"], ["HMI_Reset", B, "HMI fault reset request (PLC clears)"], ["HMI_OOS", B, "HMI out-of-service (maintained)"],
  ["Start_ONS", B, "One-shot storage: start counter"], ["FTS_Tmr", "TIMER", "Fail-to-start delay"], ["Uncmd_Tmr", "TIMER", "Uncommanded-run delay"],
  ["Starts", D, "Start count"], ["RunSec", D, "Run time, seconds (1 s periodic task)"], ["RunHrs", R, "Run time, hours"],
];
const alarmMembers = [
  ["Cond", B, "Alarm condition (raw)"], ["Dly", "TIMER", "On-delay before the alarm becomes active"], ["Active", B, "Alarm active"],
  ["Unack", B, "Active since last acknowledge"], ["Edge_ONS", B, "One-shot storage: new alarm edge"],
];
const mk = (rows) => rows.map(([name, type, desc]) => ({ name, type, desc }));

export const ALARMS = [
  ["ALM_HighLevel", 5000, "Wet well high level"], ["ALM_HiHiFloat", 1000, "High-high float"], ["ALM_LT101", 0, "Level transmitter LT-101 failed or disagrees with floats"],
  ["ALM_P1_Fault", 0, "Pump 1 fault"], ["ALM_P2_Fault", 0, "Pump 2 fault"], ["ALM_P1_Uncmd", 0, "Pump 1 running without command"],
  ["ALM_P2_Uncmd", 0, "Pump 2 running without command"], ["ALM_NoPump", 2000, "No pump available"], ["ALM_SPInvalid", 0, "Level setpoints rejected"],
];

const tags = [
  ...[1, 2].flatMap((n) => [
    [`DI_P${n}_Auto`, B, `I/O: pump ${n} HOA in AUTO`], [`DI_P${n}_Hand`, B, `I/O: pump ${n} HOA in HAND`],
    [`DI_P${n}_RunFbk`, B, `I/O: pump ${n} contactor aux`], [`DI_P${n}_OL_OK`, B, `I/O: pump ${n} overload healthy (NC)`],
    [`DO_P${n}_Run`, B, `I/O: pump ${n} run output`],
  ]),
  ["DI_LSHH", B, "I/O: high-high float, 1 = normal (fail-safe)"], ["DI_LSL", B, "I/O: low float, 1 = not low (fail-safe)"],
  ["AI_LT101_mA", R, "I/O: LT-101 level transmitter, mA"], ["DO_Beacon", B, "I/O: alarm beacon"],
  ["LT101_Pct", R, "Wet well level, % of span"], ["LT101_Fault", B, "LT-101 signal outside 3.6 to 21 mA (NE 43)"],
  ["LT_Disagree", B, "LT-101 disagrees with a float (latched)"], ["LT_DisLoLim", R, "Disagree limit vs low float"], ["LT_DisHiLim", R, "Disagree limit vs high-high float"],
  ["LT101_Bad", B, "Level transmitter not usable: float backup mode"], ["HMI_LTReset", B, "HMI: reset LT disagreement (PLC clears)"],
  ["SP_LeadOn", R, "HMI setpoint: lead pump on, %"], ["SP_LagOn", R, "HMI setpoint: lag pump on, %"], ["SP_AllOff", R, "HMI setpoint: pumps off, %"], ["SP_HighAlm", R, "HMI setpoint: high level alarm, %"],
  ["SPV_LeadOn", R, "Validated setpoint used by control"], ["SPV_LagOn", R, "Validated setpoint used by control"], ["SPV_AllOff", R, "Validated setpoint used by control"], ["SPV_HighAlm", R, "Validated setpoint used by control"],
  ["SP_Chk1", R, "Setpoint check: AllOff + 5"], ["SP_Chk2", R, "Setpoint check: LeadOn + 5"], ["SP_Valid", B, "HMI setpoints pass checks"],
  ["Lead_Dmd", B, "Level demand for lead pump (transmitter)"], ["Lag_Dmd", B, "Level demand for lag pump (transmitter)"], ["Bkp_Dmd", B, "Float backup demand (latched)"],
  ["Lead_Call", B, "Lead pump call"], ["Lag_Call", B, "Lag pump call"], ["Alt_OSF_Sto", B, "One-shot storage: end of lead cycle"], ["Alt_Pulse", B, "End of lead cycle pulse"],
  ["Lead_Idx", D, "Alternator: 0 = P1 lead, 1 = P2 lead"], ["P1_IsLead", B, "P1 is effective lead"], ["P2_IsLead", B, "P2 is effective lead"],
  ["HMI_AckAll", B, "HMI: acknowledge all alarms (PLC clears)"], ["ALM_AnyUnack", B, "Any unacknowledged alarm"],
].map(([name, type, desc]) => ({ name, type, desc }));
const dflt = { SP_LeadOn: 55, SP_LagOn: 75, SP_AllOff: 25, SP_HighAlm: 85, SPV_LeadOn: 55, SPV_LagOn: 75, SPV_AllOff: 25, SPV_HighAlm: 85, DI_LSHH: 1, DI_LSL: 1, DI_P1_OL_OK: 1, DI_P2_OL_OK: 1, AI_LT101_mA: 4 };
for (const t of tags) if (t.name in dflt) t.value = dflt[t.name];
tags.push(
  { name: "P1", type: "UDT_Pump", desc: "Pump P-101", init: { "FTS_Tmr.PRE": 5000, "Uncmd_Tmr.PRE": 3000 } },
  { name: "P2", type: "UDT_Pump", desc: "Pump P-102", init: { "FTS_Tmr.PRE": 5000, "Uncmd_Tmr.PRE": 3000 } },
  { name: "LT101_FltTmr", type: "TIMER", desc: "LT-101 signal fault filter", init: { PRE: 2000 } },
  { name: "LT_Dis_Tmr", type: "TIMER", desc: "LT-101 vs float disagreement filter", init: { PRE: 5000 } },
  { name: "Lag_Stagger", type: "TIMER", desc: "Lag start stagger after lead", init: { PRE: 3000 } },
  ...ALARMS.map(([name, pre, desc]) => ({ name, type: "UDT_Alarm", desc, init: { "Dly.PRE": pre } })),
);

const r = (c, t) => ({ comment: c, text: t });
const pumpRoutine = (n) => {
  const P = `P${n}`;
  return [
    r(`${P} fault: failed to start. Run command present but no contactor feedback within FTS_Tmr (5 s).`, `XIC(${P}.Cmd_Run)XIO(${P}.RunFbk)TON(${P}.FTS_Tmr,?,?);`),
    r(null, `XIC(${P}.FTS_Tmr.DN)OTL(${P}.Flt_FTS);`),
    r(`${P} fault: overload relay tripped.`, `XIC(${P}.OL_Trip)OTL(${P}.Flt_OL);`),
    r(`${P} fault reset from HMI. Refused while the overload is still tripped. The request bit is always cleared by the PLC (handshake), so a lost HMI connection cannot leave it set.`,
      `XIC(${P}.HMI_Reset)XIO(${P}.OL_Trip)[OTU(${P}.Flt_FTS),OTU(${P}.Flt_OL)];`),
    r(null, `XIC(${P}.HMI_Reset)OTU(${P}.HMI_Reset);`),
    r(`${P} fault summary (after the reset rungs, so a reset takes effect in the same scan). Uncommanded run is alarm-only and does not remove the pump from service.`, `[XIC(${P}.Flt_FTS),XIC(${P}.Flt_OL)]OTE(${P}.Fault);`),
    r(`${P} available for automatic control: AUTO, no latched fault, not taken out of service on the HMI.`, `XIC(${P}.HOA_Auto)XIO(${P}.Fault)XIO(${P}.HMI_OOS)OTE(${P}.Avail);`),
    r(`${P} run command (AUTO only; HAND is hardwired at the starter).`, `XIC(${P}.Call)XIC(${P}.Avail)OTE(${P}.Cmd_Run);`),
    r(`${P} running without a command in AUTO (welded contactor, wiring fault) for 3 s.`, `XIC(${P}.RunFbk)XIO(${P}.Cmd_Run)XIO(${P}.HOA_Hand)TON(${P}.Uncmd_Tmr,?,?);`),
    r(null, `XIC(${P}.Uncmd_Tmr.DN)OTE(${P}.Flt_Uncmd);`),
    r(`${P} start counter: one count per start, on the feedback rising edge.`, `XIC(${P}.RunFbk)ONS(${P}.Start_ONS)ADD(${P}.Starts,1,${P}.Starts);`),
  ];
};

const alarmRungs = ALARMS.flatMap(([a], k) => [
  r(k === 0 ? "Alarm template, repeated per alarm: on-delay, active, and a new-alarm edge that sets Unack." : null, `XIC(${a}.Cond)TON(${a}.Dly,?,?);`),
  r(null, `XIC(${a}.Dly.DN)OTE(${a}.Active);`),
  r(null, `XIC(${a}.Active)ONS(${a}.Edge_ONS)OTL(${a}.Unack);`),
  r(null, `XIC(HMI_AckAll)OTU(${a}.Unack);`),
]);

export const project = {
  name: "LS01_LiftStation", processor: "1769-L33ER", majorRev: 32, minorRev: 11,
  description: "LS-01 duplex lift station: lead/lag with alternation, fail-over, float backup, alarms",
  udts: [
    { name: "UDT_Pump", desc: "Constant-speed pump with HOA, starter feedback and overload", members: mk(pumpMembers) },
    { name: "UDT_Alarm", desc: "Alarm with on-delay, active and unacknowledged state", members: mk(alarmMembers) },
  ],
  tags,
  tasks: [
    { name: "MainTask", type: "CONTINUOUS", programs: ["MainProgram"] },
    { name: "T1000ms", type: "PERIODIC", rate: 1000, programs: ["Totals"] },
  ],
  programs: [
    {
      name: "MainProgram", main: "R00_Main", routines: [
        { name: "R00_Main", desc: "Scan order", rungs: [
          r("First scan: clear every HMI request bit so nothing acts on power-up.", "XIC(S:FS)[OTU(HMI_AckAll),OTU(HMI_LTReset),OTU(P1.HMI_Reset),OTU(P2.HMI_Reset)];"),
          r("Scan order: inputs, level, lead/lag, pumps, alarms, outputs.", "JSR(R01_Inputs,0);"),
          r(null, "JSR(R02_Level,0);"), r(null, "JSR(R03_LeadLag,0);"), r(null, "JSR(R10_Pump1,0);"), r(null, "JSR(R11_Pump2,0);"),
          r(null, "JSR(R20_Alarms,0);"), r(null, "JSR(R30_Outputs,0);"),
        ] },
        { name: "R01_Inputs", desc: "I/O mapping: field inputs to pump structures", rungs: [1, 2].flatMap((n) => [
          r(n === 1 ? "Map field inputs once, here. Replace the DI_ placeholder tags with module tags (Local:x:I.Data.n) at commissioning." : null, `XIC(DI_P${n}_Auto)OTE(P${n}.HOA_Auto);`),
          r(null, `XIC(DI_P${n}_Hand)OTE(P${n}.HOA_Hand);`), r(null, `XIC(DI_P${n}_RunFbk)OTE(P${n}.RunFbk);`),
          r(`Overload contact is normally closed: an open contact (or a broken wire) is a trip.`, `XIO(DI_P${n}_OL_OK)OTE(P${n}.OL_Trip);`),
        ]) },
        { name: "R02_Level", desc: "Level scaling, transmitter checks, setpoint validation", rungs: [
          r("Scale LT-101 4-20 mA to 0-100 % of wet well span.", "SCP(AI_LT101_mA,4.0,20.0,0.0,100.0,LT101_Pct);"),
          r("Signal fault per NAMUR NE 43: below 3.6 mA (broken wire) or above 21 mA, filtered 2 s.", "[LES(AI_LT101_mA,3.6),GRT(AI_LT101_mA,21.0)]TON(LT101_FltTmr,?,?);"),
          r(null, "XIC(LT101_FltTmr.DN)OTE(LT101_Fault);"),
          r("Disagreement limits: transmitter must read below AllOff + 10 % when the low float is low, and above HighAlm - 10 % when the high-high float is high.", "ADD(SPV_AllOff,10.0,LT_DisLoLim)SUB(SPV_HighAlm,10.0,LT_DisHiLim);"),
          r("A stuck transmitter is caught by the floats within 5 s and latched; operator resets from the HMI once the readings agree.", "[XIO(DI_LSL)GRT(LT101_Pct,LT_DisLoLim),XIO(DI_LSHH)LES(LT101_Pct,LT_DisHiLim)]TON(LT_Dis_Tmr,?,?);"),
          r(null, "XIC(LT_Dis_Tmr.DN)OTL(LT_Disagree);"),
          r(null, "XIC(HMI_LTReset)XIO(LT_Dis_Tmr.DN)OTU(LT_Disagree);"),
          r(null, "XIC(HMI_LTReset)OTU(HMI_LTReset);"),
          r("Transmitter unusable: control falls back to the floats.", "[XIC(LT101_Fault),XIC(LT_Disagree)]OTE(LT101_Bad);"),
          r("HMI setpoint checks: each band at least 5 % apart, alarm above lag start, all within 5-95 %.", "ADD(SP_AllOff,5.0,SP_Chk1)ADD(SP_LeadOn,5.0,SP_Chk2);"),
          r(null, "GEQ(SP_LeadOn,SP_Chk1)GEQ(SP_LagOn,SP_Chk2)GRT(SP_HighAlm,SP_LagOn)LIM(5.0,SP_AllOff,95.0)LIM(5.0,SP_HighAlm,95.0)OTE(SP_Valid);"),
          r("Only validated setpoints reach the control logic; a bad entry keeps the last good set and raises ALM_SPInvalid.", "XIC(SP_Valid)MOV(SP_LeadOn,SPV_LeadOn)MOV(SP_LagOn,SPV_LagOn)MOV(SP_AllOff,SPV_AllOff)MOV(SP_HighAlm,SPV_HighAlm);"),
        ] },
        { name: "R03_LeadLag", desc: "Level control, float backup, alternation, lead assignment", rungs: [
          r("Lead demand from the transmitter: on at LeadOn, sealed in until AllOff.", "XIO(LT101_Bad)[GEQ(LT101_Pct,SPV_LeadOn),XIC(Lead_Dmd)GRT(LT101_Pct,SPV_AllOff)]OTE(Lead_Dmd);"),
          r("Lag demand from the transmitter: on at LagOn, sealed in until AllOff.", "XIO(LT101_Bad)[GEQ(LT101_Pct,SPV_LagOn),XIC(Lag_Dmd)GRT(LT101_Pct,SPV_AllOff)]OTE(Lag_Dmd);"),
          r("Float backup (transmitter bad): both pumps from the high-high float down to the low float.", "XIC(LT101_Bad)XIO(DI_LSHH)OTL(Bkp_Dmd);"),
          r(null, "[XIO(LT101_Bad),XIO(DI_LSL)]OTU(Bkp_Dmd);"),
          r("Low float is a hard cut-out for both modes (dry-run protection).", "[XIC(Lead_Dmd),XIC(Bkp_Dmd)]XIC(DI_LSL)OTE(Lead_Call);"),
          r("Lag starts 3 s after the lead call to stagger inrush.", "[XIC(Lag_Dmd),XIC(Bkp_Dmd)]XIC(DI_LSL)XIC(Lead_Call)TON(Lag_Stagger,?,?);"),
          r(null, "XIC(Lag_Stagger.DN)OTE(Lag_Call);"),
          r("Alternate at the end of every lead cycle (falling edge of Lead_Call).", "XIC(Lead_Call)OSF(Alt_OSF_Sto,Alt_Pulse);"),
          r(null, "XIC(Alt_Pulse)ADD(Lead_Idx,1,Lead_Idx);"),
          r(null, "GEQ(Lead_Idx,2)MOV(0,Lead_Idx);"),
          r("Effective lead: the alternator's choice if available, otherwise the other pump (automatic fail-over).", "[EQU(Lead_Idx,0)XIC(P1.Avail),EQU(Lead_Idx,1)XIO(P2.Avail)]OTE(P1_IsLead);"),
          r(null, "XIO(P1_IsLead)OTE(P2_IsLead);"),
          r("Pump calls: lead call to the effective lead, lag call to the other pump.", "[XIC(Lead_Call)XIC(P1_IsLead),XIC(Lag_Call)XIC(P2_IsLead)]OTE(P1.Call);"),
          r(null, "[XIC(Lead_Call)XIC(P2_IsLead),XIC(Lag_Call)XIC(P1_IsLead)]OTE(P2.Call);"),
        ] },
        { name: "R10_Pump1", desc: "Pump P-101", rungs: pumpRoutine(1) },
        { name: "R11_Pump2", desc: "Pump P-102", rungs: pumpRoutine(2) },
        { name: "R20_Alarms", desc: "Alarm conditions, template, acknowledge, beacon", rungs: [
          r("High level from the transmitter, or high-high float (always).", "[GEQ(LT101_Pct,SPV_HighAlm)XIO(LT101_Bad),XIO(DI_LSHH)]OTE(ALM_HighLevel.Cond);"),
          r(null, "XIO(DI_LSHH)OTE(ALM_HiHiFloat.Cond);"),
          r(null, "XIC(LT101_Bad)OTE(ALM_LT101.Cond);"),
          r(null, "XIC(P1.Fault)OTE(ALM_P1_Fault.Cond);"), r(null, "XIC(P2.Fault)OTE(ALM_P2_Fault.Cond);"),
          r(null, "XIC(P1.Flt_Uncmd)OTE(ALM_P1_Uncmd.Cond);"), r(null, "XIC(P2.Flt_Uncmd)OTE(ALM_P2_Uncmd.Cond);"),
          r(null, "XIO(P1.Avail)XIO(P2.Avail)OTE(ALM_NoPump.Cond);"),
          r(null, "XIO(SP_Valid)OTE(ALM_SPInvalid.Cond);"),
          ...alarmRungs,
          r("Acknowledge handshake: the PLC clears the HMI request after use.", "XIC(HMI_AckAll)OTU(HMI_AckAll);"),
          r("Beacon while any alarm is unacknowledged.", "[" + ALARMS.map(([a]) => `XIC(${a}.Unack)`).join(",") + "]OTE(ALM_AnyUnack);"),
        ] },
        { name: "R30_Outputs", desc: "Output mapping", rungs: [
          r("Map outputs once, here. Replace DO_ placeholders with module tags at commissioning.", "XIC(P1.Cmd_Run)OTE(DO_P1_Run);"),
          r(null, "XIC(P2.Cmd_Run)OTE(DO_P2_Run);"), r(null, "XIC(ALM_AnyUnack)OTE(DO_Beacon);"),
        ] },
      ],
    },
    {
      name: "Totals", main: "R00_Totals", routines: [
        { name: "R00_Totals", desc: "Runs every 1000 ms in periodic task T1000ms", rungs: [
          r("Run seconds counted in a 1 s periodic task: exact, independent of continuous-task scan time (no self-resetting timer drift).", "XIC(P1.RunFbk)ADD(P1.RunSec,1,P1.RunSec);"),
          r(null, "XIC(P2.RunFbk)ADD(P2.RunSec,1,P2.RunSec);"),
          r(null, "DIV(P1.RunSec,3600.0,P1.RunHrs)DIV(P2.RunSec,3600.0,P2.RunHrs);"),
        ] },
      ],
    },
  ],
};
