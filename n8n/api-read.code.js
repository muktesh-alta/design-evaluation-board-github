// n8n Code node: "Clean records"  (mode: Run Once for All Items)
// Input: rows from Google Sheets "Get row(s)". Output: one item { records }.
// ---- shared helpers (Google Sheets values -> clean records) ----
const FIELDS = ["id","meetingDate","day","meetingTime","status","designName","description","owner","remarks","createdAt","updatedAt"];
function isoDate(v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number" || /^\d{5}(\.\d+)?$/.test(String(v))) {           // Sheets serial date
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim().replace(/^'/, "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);                // 04/09/2026 or 9/4/2026
  if (m) {
    let [_, a, b, y] = m; a = +a; b = +b;
    const [dd, mm] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b];              // ambiguous -> day first (India/UK)
    return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  return isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10);
}
const truthy = v => v === true || /^(true|yes|1)$/i.test(String(v ?? "").trim());
function cleanRecords(rows) {
  const out = [];
  for (const r of rows) {
    if (!r || !r.id || truthy(r.deleted)) continue;
    const rec = {};
    for (const f of FIELDS) rec[f] = r[f] === undefined || r[f] === null ? "" : String(r[f]);
    rec.meetingDate = isoDate(r.meetingDate);
    if (!rec.meetingDate) continue;
    rec.status = rec.status === "No Design Discussed" ? "No Design Discussed" : "Discussed";
    out.push(rec);
  }
  return out;
}

const records = cleanRecords($input.all().map(i => i.json));
return [{ json: { records, count: records.length, generatedAt: new Date().toISOString() } }];
