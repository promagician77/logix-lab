// node --test: runs every scenario against LS01_LiftStation.L5X (the file you import).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Controller } from "../logix/engine.js";
import { loadL5X } from "../logix/load.js";
import { makeScenarios, runScenario } from "./scenarios.js";

const project = loadL5X(new URL("../LS01_LiftStation.L5X", import.meta.url).pathname);
for (const s of makeScenarios(Controller, project)) {
  test(`${s.id} ${s.name}`, () => { const r = runScenario(s); assert.ok(r.pass, r.msg); });
}
