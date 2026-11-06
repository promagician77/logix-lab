# LS-01 lift station: Studio 5000 ladder program with a test bench

A complete Logix 5000 ladder program for a duplex lift station, shipped as an L5X file, plus the tools that test it before it reaches a controller:

| Path | Contents |
|---|---|
| `LS01_LiftStation.L5X` | The program: 2 programs, 9 routines, 117 rungs, 2 UDTs, 58 controller tags. CompactLogix 1769-L33ER, v32. |
| `project/liftstation.js` | Source the L5X is generated from (rung text in Rockwell neutral format, comments, tags). |
| `logix/engine.js` | Parses neutral rung text, compiles each routine and runs controller scans (continuous + periodic tasks). |
| `logix/l5x.js` | L5X writer and reader (UDT BOOL packing into hidden SINT hosts, decorated tag data, RLL rungs with comments). |
| `sim/plant.js` | Wet well, two pumps with starters and overloads, floats (with differential), 4–20 mA transmitter with fault modes. |
| `test/` | 39 scenario tests; they load the **L5X file**, not the JS source. |
| `tools/lint.js` | Static review of an L5X (duplicate OTEs, toggle-in-one-rung, shared one-shots and timers, HMI bits without handshake, latches without unlatch, self-resetting timers, missing JSR targets, unused tags). |
| `tools/mutate.js` | Mutation testing: every one-instruction edit, site-check set vs full scenario set. |
| `tools/seeded.js` | Troubleshooting study: six classic site edits, each checked by the linter and the tests; run-hour drift by scan time. |
| `hmi/` | FactoryTalk View reference lists: `hmi_tags.csv` (direct references, read/write, handshake notes) and `alarms.csv`. |
| `site/` | Static review site (Vercel: output directory `site`, `noindex`). Runs the L5X in the browser against the plant model, with an ISA-101 style screen and a live online ladder view. |

## What the program does

- **Level control** from LT-101 (4–20 mA, scaled with SCP). Lead on at 55 %, lag on at 75 % (3 s stagger), all off at 25 %. Setpoints are entered on the HMI and validated before use: bands must be at least 5 % apart and within 5–95 %. A bad entry keeps the last good set and raises an alarm.
- **Alternation** at the end of every lead cycle (OSF, then index and wrap), and **automatic fail-over**: an unavailable pump (fault, not in AUTO, out of service) gives up the lead.
- **Pump protection:**
  - fail to start (5 s, no contactor feedback);
  - overload (NC contact, so a broken wire also trips);
  - uncommanded run in AUTO (3 s, alarm only);
  - HMI reset, refused while the overload is still tripped.
- **Transmitter checks:**
  - NE 43 signal fault (below 3.6 mA or above 21 mA, filtered for 2 s);
  - disagreement with the low or high-high float for 5 s, latched.

  Either one switches control to **float backup** (both pumps from high-high float to low float).
- **Low float** is a hard cut-out in every mode.
- **Alarms** come from one template (condition → on-delay → active → unacknowledged), with an acknowledge handshake and a beacon.
- **HMI handshake:** the HMI only sets request bits. The PLC clears them after use and on first scan, so a dropped HMI connection cannot leave a request bit set.
- **Run hours** are counted in a 1000 ms periodic task, so they are exact whatever the scan time. Starts are counted on the feedback edge.

## Measured results

All of these come from running the shipped L5X in the scan engine against the plant model (`results/`).

| Check | Result |
|---|---|
| Scenario tests | 39 of 39 pass: 13.8 h of simulated plant time in about 10 s |
| Fail-to-start | Detected at 5.01 s; the other pump proves running 0.41 s later |
| Broken transmitter (0 mA) | Detected at 2.01 s; float backup starts at 92 % and stops at 10 % |
| Stuck transmitter (reads 60 %) | Latched 5 s after the low float; 2 pump starts in 30 min (no short cycling) |
| Run hours | 7200 s counted over 2 h at a 17 ms scan (exact) |
| Lint, shipped program | 0 findings |
| Mutation testing | 568 one-instruction edits. The 5 site checks (B1–B5) catch 24.8 %; all 39 scenarios catch 96.0 %. Round 1, with 25 scenarios, caught 60.6 %; its misses showed gaps in the tests, which were closed. The 23 remaining edits are reviewed in `results/survivor_notes.json` (equivalent edits, redundant guards, tuning values). |
| Seeded bugs | Six classic edits. The linter flags five; the sixth (a fail-to-start timer without the feedback check) is caught by 16 scenarios. |
| Self-resetting 1 s timer (the B-5 seeded bug) | Run hours read 0.4 % low at a 2 ms scan, 3.8 % low at 20 ms and 9.1 % low at 50 ms |

## Run

Node 20 or newer:

```bash
npm install
node tools/build_l5x.js            # regenerate the L5X and check the write/read round trip
node --test test/liftstation.test.js   # 39 scenarios against LS01_LiftStation.L5X
node tools/lint.js LS01_LiftStation.L5X
node tools/mutate.js               # about 6 min on 2 cores → results/mutation.json
node tools/seeded.js               # → results/troubleshooting.json
node tools/export_site.js          # copy engine, L5X and results into site/
npx --yes serve site               # open the review site locally
```

## Using it in Logix Designer

- **Whole project.** Logix Designer opens `.L5X` files with File › Open and builds a project from them.
  - The file targets a 1769-L33ER at v32.
  - After opening, add the I/O modules and map the `DI_`, `AI_` and `DO_` placeholder tags in R01_Inputs and R30_Outputs to the module tags.
- **Single rungs.** Every rung is Rockwell neutral text, so it can be pasted into the rung editor's ASCII view.
- **HMI.** `hmi/hmi_tags.csv` lists each display item as a direct reference (`{[PLC]Tag}`), with read/write access and handshake notes. Write-only request bits should be set to 1 only; the PLC clears them.

## Scope (please read)

- **Not opened in Logix Designer here:** there is no Rockwell licence in this environment. It follows the import/export format. Two checks were run: the round trip through this project's own reader, and an independent read with the open-source `l5x` Python library (`tools/check_l5x.py`), which reads all 58 tags, both programs, the UDT BOOL members, timer presets and descriptions.
- **The scan engine is a test bench, not a controller emulator.** It implements the instructions this program uses (XIC, XIO, OTE, OTL, OTU, ONS, OSR, OSF, TON, TOF, RTO, CTU, CTD, RES, MOV, CLR, ADD, SUB, MUL, DIV, SCP, LIM, comparisons, JSR, NOP, AFI), following Rockwell's instruction reference. It does not model I/O update timing, task pre-emption, fault routines or controller-specific edge cases.
- **The plant numbers are illustrative.** Wet well 4 m² by 3 m; one pump 18 L/s, both 30 L/s.

The aim is to catch logic mistakes at a desk before an on-site FAT, not to replace one.
