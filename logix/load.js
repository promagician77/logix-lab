// Node helper: load a project from an .L5X file (the shipped artifact).
import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { fromL5X } from "./l5x.js";
export const loadL5X = (path) => fromL5X(new DOMParser().parseFromString(readFileSync(path, "utf8"), "text/xml"));
