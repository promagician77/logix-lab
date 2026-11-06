// L5X (Logix 5000 XML import/export) writer and reader for the subset this project uses:
// user data types (BOOL members packed into hidden SINT hosts), controller tags with
// decorated data, RLL routines with rung comments, continuous and periodic tasks.

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cdata = (s) => `<![CDATA[${String(s).replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
const desc = (d, ind) => (d ? `${ind}<Description>\n${ind}${cdata(d)}\n${ind}</Description>\n` : "");
const RADIX = { BOOL: null, SINT: "Decimal", INT: "Decimal", DINT: "Decimal", REAL: "Float" };
const fmtVal = (type, v) => (type === "REAL" ? (Number.isInteger(+v) ? (+v).toFixed(1) : String(+v)) : String(v | 0));
const BUILTIN = {
  TIMER: [["PRE", "DINT"], ["ACC", "DINT"], ["EN", "BOOL"], ["TT", "BOOL"], ["DN", "BOOL"]],
  COUNTER: [["PRE", "DINT"], ["ACC", "DINT"], ["CU", "BOOL"], ["CD", "BOOL"], ["DN", "BOOL"], ["OV", "BOOL"], ["UN", "BOOL"]],
};

function memberList(udts, type) {
  if (BUILTIN[type]) return BUILTIN[type];
  const u = udts.find((x) => x.name === type); return u.members.map((m) => [m.name, m.type]);
}
function decorated(udts, type, values, path, ind) {
  // values: flat map "a.b" -> v relative to this structure
  let s = "";
  for (const [name, t] of memberList(udts, type)) {
    const key = path ? `${path}.${name}` : name;
    if (RADIX[t] !== undefined) {
      const v = values[key] ?? 0;
      s += `${ind}<DataValueMember Name="${name}" DataType="${t}"${RADIX[t] ? ` Radix="${RADIX[t]}"` : ""} Value="${fmtVal(t, v)}"/>\n`;
    } else {
      s += `${ind}<StructureMember Name="${name}" DataType="${t}">\n${decorated(udts, t, values, key, ind + " ")}${ind}</StructureMember>\n`;
    }
  }
  return s;
}

export function toL5X(p, exportDate = new Date()) {
  const d = exportDate.toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, "$1 $3 $2 $5 $4");
  let x = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
  x += `<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="${p.majorRev}.${String(p.minorRev).padStart(2, "0")}" TargetName="${esc(p.name)}" TargetType="Controller" ContainsContext="false" ExportDate="${d}" ExportOptions="NoRawData DecoratedData ForceProtectedEncoding AllProjDocTrans">\n`;
  x += `<Controller Use="Target" Name="${esc(p.name)}" ProcessorType="${p.processor}" MajorRev="${p.majorRev}" MinorRev="${p.minorRev}" MatchProjectToController="false" CanUseRPIFromProducer="false" InhibitAutomaticFirmwareUpdate="0">\n`;
  x += desc(p.description, "");
  x += `<DataTypes>\n`;
  for (const u of p.udts) {
    x += `<DataType Name="${u.name}" Family="NoFamily" Class="User">\n${desc(u.desc, "")}<Members>\n`;
    let host = -1, bit = 8, hostName = "";
    for (const m of u.members) {
      if (m.type === "BOOL") {
        if (bit >= 8) { host++; bit = 0; hostName = `ZZZZZZZZZZ${u.name}${host}`; x += `<Member Name="${hostName}" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true" ExternalAccess="Read/Write"/>\n`; }
        x += `<Member Name="${m.name}" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="${hostName}" BitNumber="${bit++}" ExternalAccess="Read/Write">\n${desc(m.desc, "")}</Member>\n`;
      } else {
        bit = 8; // a non-BOOL member closes the current host byte
        x += `<Member Name="${m.name}" DataType="${m.type}" Dimension="0" Radix="${RADIX[m.type] || "NullType"}" Hidden="false" ExternalAccess="Read/Write">\n${desc(m.desc, "")}</Member>\n`;
      }
    }
    x += `</Members>\n</DataType>\n`;
  }
  x += `</DataTypes>\n<Tags>\n`;
  for (const t of p.tags) {
    const atomic = RADIX[t.type] !== undefined;
    x += `<Tag Name="${t.name}" TagType="Base" DataType="${t.type}"${atomic && RADIX[t.type] ? ` Radix="${RADIX[t.type]}"` : ""} Constant="false" ExternalAccess="Read/Write">\n${desc(t.desc, "")}`;
    if (atomic) x += `<Data Format="Decorated">\n<DataValue DataType="${t.type}"${RADIX[t.type] ? ` Radix="${RADIX[t.type]}"` : ""} Value="${fmtVal(t.type, t.value ?? 0)}"/>\n</Data>\n`;
    else x += `<Data Format="Decorated">\n<Structure DataType="${t.type}">\n${decorated(p.udts, t.type, t.init || {}, "", "")}</Structure>\n</Data>\n`;
    x += `</Tag>\n`;
  }
  x += `</Tags>\n<Programs>\n`;
  for (const pr of p.programs) {
    x += `<Program Name="${pr.name}" TestEdits="false" MainRoutineName="${pr.main}" Disabled="false" UseAsFolder="false">\n<Tags/>\n<Routines>\n`;
    for (const r of pr.routines) {
      x += `<Routine Name="${r.name}" Type="RLL">\n${desc(r.desc, "")}<RLLContent>\n`;
      r.rungs.forEach((g, n) => {
        x += `<Rung Number="${n}" Type="N">\n`;
        if (g.comment) x += `<Comment>\n${cdata(g.comment)}\n</Comment>\n`;
        x += `<Text>\n${cdata(g.text)}\n</Text>\n</Rung>\n`;
      });
      x += `</RLLContent>\n</Routine>\n`;
    }
    x += `</Routines>\n</Program>\n`;
  }
  x += `</Programs>\n<Tasks>\n`;
  for (const t of p.tasks) {
    x += `<Task Name="${t.name}" Type="${t.type}"${t.type === "PERIODIC" ? ` Rate="${t.rate}" Priority="5"` : ` Priority="10"`} Watchdog="500" DisableUpdateOutputs="false" InhibitTask="false">\n<ScheduledPrograms>\n`;
    for (const pg of t.programs) x += `<ScheduledProgram Name="${pg}"/>\n`;
    x += `</ScheduledPrograms>\n</Task>\n`;
  }
  x += `</Tasks>\n</Controller>\n</RSLogix5000Content>\n`;
  return x;
}

/* ---------- reader (works with browser DOMParser or @xmldom/xmldom) ---------- */
const kids = (el, name) => { const out = []; if (!el) return out; for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && (!name || c.nodeName === name)) out.push(c); return out; };
const kid = (el, name) => kids(el, name)[0];
const text = (el) => (el ? el.textContent.trim() : null);

function readStruct(el, path, out) {
  for (const m of kids(el)) {
    const key = path ? `${path}.${m.getAttribute("Name")}` : m.getAttribute("Name");
    if (m.nodeName === "DataValueMember") out[key] = +m.getAttribute("Value");
    else if (m.nodeName === "StructureMember") readStruct(m, key, out);
  }
  return out;
}

export function fromL5X(doc) {
  const root = doc.documentElement, ctl = kid(root, "Controller");
  const p = {
    name: ctl.getAttribute("Name"), processor: ctl.getAttribute("ProcessorType"),
    majorRev: +ctl.getAttribute("MajorRev"), minorRev: +ctl.getAttribute("MinorRev"),
    description: text(kid(ctl, "Description")), udts: [], tags: [], programs: [], tasks: [],
  };
  for (const dt of kids(kid(ctl, "DataTypes"), "DataType")) {
    const members = kids(kid(dt, "Members"), "Member").filter((m) => m.getAttribute("Hidden") !== "true")
      .map((m) => ({ name: m.getAttribute("Name"), type: m.getAttribute("DataType") === "BIT" ? "BOOL" : m.getAttribute("DataType"), desc: text(kid(m, "Description")) }));
    p.udts.push({ name: dt.getAttribute("Name"), desc: text(kid(dt, "Description")), members });
  }
  for (const t of kids(kid(ctl, "Tags"), "Tag")) {
    const tag = { name: t.getAttribute("Name"), type: t.getAttribute("DataType"), desc: text(kid(t, "Description")) };
    const data = kids(t, "Data").find((d) => d.getAttribute("Format") === "Decorated");
    if (data) {
      const dv = kid(data, "DataValue"), st = kid(data, "Structure");
      if (dv) tag.value = +dv.getAttribute("Value");
      if (st) { const all = readStruct(st, "", {}); tag.init = Object.fromEntries(Object.entries(all).filter(([k, v]) => v !== 0 || /PRE$/.test(k))); }
    }
    p.tags.push(tag);
  }
  for (const pr of kids(kid(ctl, "Programs"), "Program")) {
    const routines = kids(kid(pr, "Routines"), "Routine").map((r) => ({
      name: r.getAttribute("Name"), desc: text(kid(r, "Description")),
      rungs: kids(kid(r, "RLLContent"), "Rung").map((g) => ({ comment: text(kid(g, "Comment")), text: text(kid(g, "Text")) })),
    }));
    p.programs.push({ name: pr.getAttribute("Name"), main: pr.getAttribute("MainRoutineName"), routines });
  }
  for (const t of kids(kid(ctl, "Tasks"), "Task")) {
    p.tasks.push({ name: t.getAttribute("Name"), type: t.getAttribute("Type"), rate: t.getAttribute("Rate") ? +t.getAttribute("Rate") : undefined,
      programs: kids(kid(t, "ScheduledPrograms"), "ScheduledProgram").map((s) => s.getAttribute("Name")) });
  }
  return p;
}
