// n8n Code node: "Validate record"  (mode: Run Once for All Items)
// Input: the POST webhook item. Body must be { record: {...} }.
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

const body = $input.first().json.body || {};
const r = body.record || {};
const errors = [];
if (!r.id || !/^[A-Za-z0-9_-]{3,64}$/.test(String(r.id))) errors.push("record.id is missing or invalid");
const date = isoDate(r.meetingDate);
if (!date) errors.push("record.meetingDate must be YYYY-MM-DD");
const status = r.status === "No Design Discussed" ? "No Design Discussed" : r.status === "Discussed" ? "Discussed" : null;
if (!status) errors.push("record.status must be 'Discussed' or 'No Design Discussed'");
const deleted = truthy(r.deleted);
if (!deleted && status === "Discussed") {
  if (!String(r.designName || "").trim()) errors.push("designName is required when status is Discussed");
  if (!String(r.description || "").trim()) errors.push("description is required when status is Discussed");
}
if (errors.length) return [{ json: { valid: false, error: errors.join("; ") } }];
const clip = (v, n = 2000) => String(v ?? "").slice(0, n);
const now = new Date().toISOString();
return [{ json: {
  valid: true,
  row: {
    id: String(r.id), meetingDate: date,
    day: new Date(date + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }),
    meetingTime: clip(r.meetingTime || "5:00 PM", 20), status,
    designName: status === "Discussed" ? clip(r.designName, 200) : "",
    description: status === "Discussed" ? clip(r.description) : "No design discussed",
    owner: status === "Discussed" ? clip(r.owner, 200) : "",
    remarks: clip(r.remarks),
    createdAt: clip(r.createdAt || now, 40), updatedAt: now,
    deleted: deleted ? "TRUE" : "FALSE"
  }
} }];
