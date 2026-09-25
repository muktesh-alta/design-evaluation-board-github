// n8n Code node: "Build weekly email"  (mode: Run Once for All Items)
// Input: rows from Google Sheets. Output: one item { subject, html, text }.
// ---------- settings ----------
const DASHBOARD_URL = "https://muktesh-alta.github.io/design-evaluation-board-github/";
const WEEKS_IN_SUMMARY = 4;          // trailing Fridays shown in the email
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

// ---------- dates (workflow timezone via $now) ----------
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const P = d => new Date(d + "T00:00:00Z");
const add = (d, n) => { const x = P(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = d => P(d).getUTCDay();
const weekFriday = d => add(d, (5 - dow(d) + 7) % 7);
const fridayOnOrBefore = d => add(d, -((dow(d) - 5 + 7) % 7));
const short = d => { const x = P(d); return `${String(x.getUTCDate()).padStart(2, "0")}-${MON[x.getUTCMonth()]}-${x.getUTCFullYear()}`; };
const long = d => `${DAY[dow(d)]}, ${short(d)}`;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const today = $now.toFormat("yyyy-MM-dd");
const records = cleanRecords($input.all().map(i => i.json));
const byFri = {};
for (const r of records) (byFri[weekFriday(r.meetingDate)] ||= []).push(r);

const thisFri = fridayOnOrBefore(today);
const weeks = [];
for (let k = WEEKS_IN_SUMMARY - 1; k >= 0; k--) {
  const f = add(thisFri, -7 * k);
  const designs = (byFri[f] || []).filter(r => r.status === "Discussed");
  const marker = (byFri[f] || []).find(r => r.status === "No Design Discussed");
  weeks.push({ f, designs, count: designs.length, remarks: designs.length ? "" : (marker?.remarks || ""), recorded: !!(byFri[f] || []).length });
}
const latest = weeks[weeks.length - 1];
const total = weeks.reduce((s, w) => s + w.count, 0);
const withD = weeks.filter(w => w.count).length;
const rate = Math.round((withD / weeks.length) * 100);

const C = { ink: "#15233B", muted: "#5E6E86", line: "#D9E1EB", blue: "#2A56C6", blueSoft: "#E4EBFA", ochre: "#A86B12", ochreSoft: "#F6EAD2" };
const pill = n => n
  ? `<span style="background:${C.blueSoft};color:${C.blue};padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600">Discussed</span>`
  : `<span style="background:${C.ochreSoft};color:${C.ochre};padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600">No Design Discussed</span>`;
const td = `style="padding:9px 10px;border-bottom:1px solid ${C.line};font-size:14px;vertical-align:top"`;
const th = `style="padding:8px 10px;border-bottom:1px solid ${C.line};font-size:12px;color:${C.muted};text-align:left"`;

const latestBlock = latest.count
  ? `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr><th ${th}>Design</th><th ${th}>Description</th><th ${th}>Owner</th><th ${th}>Remarks</th></tr>
     ${latest.designs.map(d => `<tr><td ${td}><b>${esc(d.designName)}</b></td><td ${td}>${esc(d.description)}</td><td ${td}>${esc(d.owner) || "—"}</td><td ${td}>${esc(d.remarks) || "—"}</td></tr>`).join("")}</table>`
  : `<p style="margin:0;padding:12px 14px;background:${C.ochreSoft};border-left:4px solid ${C.ochre};font-size:14px">
       <b>0 designs. No Design Discussed.</b>${latest.recorded ? (latest.remarks ? ` ${esc(latest.remarks)}` : "") : ` Nothing was recorded for this Friday, so it counts as no design discussed. If designs were discussed, <a href="${DASHBOARD_URL}" style="color:${C.blue}">add them on the dashboard</a>.`}</p>`;

const summaryRows = weeks.slice().reverse().map(w =>
  `<tr${w.count ? "" : ` style="background:${C.ochreSoft}"`}><td ${td}>${short(w.f)}</td><td ${td} align="right"><b>${w.count}</b></td><td ${td}>${pill(w.count)}</td></tr>`).join("");

const subject = latest.count
  ? `Design Evaluation Board, ${short(latest.f)}: ${latest.count} design${latest.count === 1 ? "" : "s"} discussed`
  : `Design Evaluation Board, ${short(latest.f)}: No design discussed`;

const html = `<!doctype html><html><body style="margin:0;background:#F3F6FA;font-family:Segoe UI,Arial,sans-serif;color:${C.ink}">
<table width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#fff;border:1px solid ${C.line};border-radius:12px">
<tr><td style="padding:22px 24px;background:${C.ink};color:#fff;border-radius:12px 12px 0 0">
  <div style="font-size:13px;color:#A9B6CB">Design Evaluation Board</div>
  <div style="font-size:22px;font-weight:700;margin-top:4px">${long(latest.f)}, 5:00 PM</div>
  <div style="font-size:15px;margin-top:6px">${latest.count ? `${latest.count} design${latest.count === 1 ? "" : "s"} discussed` : "No design discussed"}</div>
</td></tr>
<tr><td style="padding:20px 24px">${latestBlock}</td></tr>
<tr><td style="padding:0 24px 8px">
  <div style="font-size:16px;font-weight:700;margin-bottom:8px">Last ${WEEKS_IN_SUMMARY} Fridays</div>
  <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid ${C.line}">
    <tr><td ${td}>Total weeks<br><b style="font-size:20px">${weeks.length}</b></td><td ${td}>Designs discussed<br><b style="font-size:20px">${total}</b></td>
        <td ${td}>No design weeks<br><b style="font-size:20px;color:${C.ochre}">${weeks.length - withD}</b></td><td ${td}>Discussion rate<br><b style="font-size:20px">${rate}%</b></td></tr></table>
  <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:12px"><tr><th ${th}>Week</th><th style="padding:8px 10px;border-bottom:1px solid ${C.line};font-size:12px;color:${C.muted};text-align:right">Designs</th><th ${th}>Status</th></tr>${summaryRows}</table>
</td></tr>
<tr><td style="padding:16px 24px 24px"><a href="${DASHBOARD_URL}" style="display:inline-block;background:${C.blue};color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;font-size:14px">Open the dashboard</a></td></tr>
</table>
<div style="font-size:12px;color:${C.muted};margin-top:12px">Sent automatically by n8n every Friday after the 5:00 PM board.</div>
</td></tr></table></body></html>`;

const text = [subject, "", ...(latest.count ? latest.designs.map(d => `- ${d.designName}: ${d.description}${d.owner ? ` (${d.owner})` : ""}`) : ["0 designs. No Design Discussed."]),
  "", `Last ${WEEKS_IN_SUMMARY} Fridays:`, ...weeks.slice().reverse().map(w => `${short(w.f)}  ${w.count}  ${w.count ? "Discussed" : "No Design Discussed"}`),
  "", `Dashboard: ${DASHBOARD_URL}`].join("\n");

return [{ json: { subject, html, text, meetingDate: latest.f, designCount: latest.count } }];
