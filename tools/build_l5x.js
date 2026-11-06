// Writes LS01_LiftStation.L5X from project/liftstation.js, then reads it back and checks the
// round trip is lossless (the tests and the site both run the L5X, not the JS source).
import { writeFileSync, readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { project } from "../project/liftstation.js";
import { toL5X, fromL5X } from "../logix/l5x.js";
import { Controller, instructions, parseRung } from "../logix/engine.js";

const out = process.argv[2] || "LS01_LiftStation.L5X";
writeFileSync(out, toL5X(project, new Date(Date.UTC(2026, 10, 6, 17, 0, 0))));
const back = fromL5X(new DOMParser().parseFromString(readFileSync(out, "utf8"), "text/xml"));
const flat = (p) => p.programs.flatMap((pr) => pr.routines.flatMap((r) => r.rungs.map((g) => `${pr.name}/${r.name}: ${g.text}`)));
const a = flat(project), b = flat(back);
if (a.length !== b.length || a.some((x, i) => x !== b[i])) throw new Error("rung round trip mismatch");
if (back.tags.length !== project.tags.length) throw new Error("tag count mismatch");
new Controller(back); // compiles (verify)
const nInstr = back.programs.flatMap((p) => p.routines.flatMap((r) => r.rungs.map((g) => instructions(parseRung(g.text)).length))).reduce((s, n) => s + n, 0);
console.log(`wrote ${out}: ${back.programs.length} programs, ${back.programs.reduce((s, p) => s + p.routines.length, 0)} routines, ${a.length} rungs, ${nInstr} instructions, ${back.tags.length} tags, ${back.udts.length} UDTs; round trip OK, verify OK`);
