// n8n Code node: "Build weekly email"  (mode: Run Once for All Items)
// Input: rows from Google Sheets. Output: one item { subject, html, text }.
// ---------- settings ----------
const DASHBOARD_URL = "https://muktesh-alta.github.io/design-evaluation-board-github/";
const WEEKS_IN_SUMMARY = 4;          // trailing Fridays shown in the email
const TRACKING_START = "2026-09-25"; // first counted Friday; earlier Fridays are never shown or counted
// ---- shared helpers (Google Sheets values -> clean records) ----
const FIELDS = ["id","meetingDate","day","meetingTime","status","designName","description","owner","remarks","createdAt","updatedAt","jiraId","enhancementId","component","clientName","scopedInSprint","sprint","qaWrittenBy","qaReviewedBy","testingDoneBy"];
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
    rec.status = ["No Design Discussed", "Holiday"].includes(rec.status) ? rec.status : "Discussed";
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
const fridayOnOrBefore = d => add(d, -((dow(d) - 5 + 7) % 7));
// Week runs Friday \u2192 Thursday: a make-up session on Mon\u2013Thu counts toward the Friday before it.
const weekFriday = fridayOnOrBefore;
const short = d => { const x = P(d); return `${String(x.getUTCDate()).padStart(2, "0")}-${MON[x.getUTCMonth()]}-${x.getUTCFullYear()}`; };
const long = d => `${DAY[dow(d)]}, ${short(d)}`;
const madeUp = d => dow(d.meetingDate) !== 5 ? ` (make-up, ${DAY[dow(d.meetingDate)]} ${short(d.meetingDate)})` : "";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const today = $now.toFormat("yyyy-MM-dd");
const records = cleanRecords($input.all().map(i => i.json));
const byFri = {};
for (const r of records) (byFri[weekFriday(r.meetingDate)] ||= []).push(r);

const thisFri = fridayOnOrBefore(today);
const weeks = [];
for (let k = WEEKS_IN_SUMMARY - 1; k >= 0; k--) {
  const f = add(thisFri, -7 * k);
  if (f < TRACKING_START) continue;
  const designs = (byFri[f] || []).filter(r => r.status === "Discussed");
  const marker = (byFri[f] || []).find(r => r.status === "No Design Discussed");
  const hol = (byFri[f] || []).find(r => r.status === "Holiday");
  const holiday = !designs.length && !!hol;   // official holiday: shown, but left out of every count and rate
  weeks.push({ f, designs, count: designs.length, holiday, remarks: designs.length ? "" : ((holiday ? hol : marker)?.remarks || ""), recorded: !!(byFri[f] || []).length });
}
const latest = weeks[weeks.length - 1];
const working = weeks.filter(w => !w.holiday).length;
const holidays = weeks.length - working;
const total = weeks.reduce((s, w) => s + w.count, 0);
const withD = weeks.filter(w => w.count).length;
const rate = working ? Math.round((withD / working) * 100) : 0;

// ---------- email template (tables + inline styles for Gmail / Outlook) ----------
const C = { paper: "#F3F6FA", surface: "#FFFFFF", ink: "#15233B", ink2: "#34445E", muted: "#5E6E86", line: "#D9E1EB", line2: "#E9EEF4",
  hol: "#5B5F97", holSoft: "#ECECF7", navy: "#15233B", navy2: "#22386A", navyMuted: "#A9B6CB", blue: "#2A56C6", blueSoft: "#E4EBFA", ochre: "#A86B12", ochreSoft: "#F6EAD2", hatch: "#E2C58E" };
const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const TICKET = /\b[A-Z]{2,}-?\d{3,}\b/;
const idOf = d => { for (const s of [d.enhancementId, d.jiraId, d.description, d.designName]) { const m = String(s || "").match(TICKET); if (m) return m[0]; } return ""; };
const chip = (t, bg, fg, html = false) => `<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:${bg};color:${fg};font-size:12px;font-weight:700;letter-spacing:.2px;white-space:nowrap">${html ? t : esc(t)}</span>`;
// Gmail turns dates and day names into blue calendar links that are unreadable on the navy header.
// An invisible zero-width non-joiner inside each word stops the detection without changing how the text looks.
const nd = t => esc(t).replace(/([A-Za-z0-9])(?=[A-Za-z0-9])/g, "$1&zwnj;");
// Holiday name for display; ignore a remark that only repeats "Official holiday".
const holName = r => (r && !/^\s*official\s+holiday\s*$/i.test(r) ? r : "");
const pill = n => n
  ? `<span style="display:inline-block;padding:3px 10px;border-radius:12px;background:${C.blueSoft};color:${C.blue};font-size:12px;font-weight:700;white-space:nowrap">Discussed</span>`
  : `<span style="display:inline-block;padding:2px 9px;border-radius:12px;border:1px solid ${C.hatch};color:${C.ochre};font-size:12px;font-weight:700;white-space:nowrap">No Design Discussed</span>`;
const eyebrow = t => `<div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${C.muted};margin:0 0 10px">${t}</div>`;

const designCard = d => {
  const id = idOf(d);
  const makeUp = dow(d.meetingDate) !== 5
    ? `<td align="right" style="vertical-align:top;padding-left:8px">${chip(nd("Make-up \u00b7 " + DAY[dow(d.meetingDate)] + " " + short(d.meetingDate).slice(0, 6)), C.ochreSoft, C.ochre, true)}</td>` : "";
  const meta = [["Owner", d.owner], ["Component", d.component], ["Client", d.clientName], ["Sprint", d.sprint], ["In sprint backlog", d.scopedInSprint]]
    .filter(([, v]) => v)
    .map(([k, v]) => `<span style="white-space:nowrap">${String(v).toLowerCase().includes(k.toLowerCase()) ? "" : `<span style="color:${C.muted}">${k}</span>&nbsp;`}<b style="color:${C.ink2};font-weight:600">${esc(v)}</b></span>`)
    .join(`<span style="color:${C.line}">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`);
  const qa = [["Test cases written", d.qaWrittenBy], ["Reviewed", d.qaReviewedBy], ["Tested", d.testingDoneBy]]
    .filter(([, v]) => v)
    .map(([k, v]) => `<span style="white-space:nowrap"><span style="color:${C.muted}">${k}</span>&nbsp;<b style="color:${C.ink2};font-weight:600">${esc(v)}</b></span>`)
    .join(`<span style="color:${C.line}">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`);
  const jira = d.jiraId && d.jiraId !== id && TICKET.test(d.jiraId) ? `&nbsp;${chip(d.jiraId, C.line2, C.ink2)}` : "";
  return `<tr><td style="padding:0 0 12px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border:1px solid ${C.line};border-left:4px solid ${C.blue};border-radius:10px;background:${C.surface}">
      <tr><td style="padding:14px 16px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
          <td style="vertical-align:top">${id ? chip(id, C.navy, "#FFFFFF") + "&nbsp;&nbsp;" : ""}<span style="font-size:15px;font-weight:700;color:${C.ink}">${esc(d.designName)}</span>${jira}</td>${makeUp}
        </tr></table>
        ${d.description && d.description !== d.designName ? `<div style="margin-top:8px;font-size:14px;line-height:1.5;color:${C.ink2}">${esc(d.description)}</div>` : ""}
        ${meta ? `<div style="margin-top:10px;font-size:12.5px;line-height:1.8">${meta}</div>` : ""}
        ${qa ? `<div style="margin-top:6px;font-size:12.5px;line-height:1.8"><span style="display:inline-block;padding:1px 7px;margin-right:8px;border-radius:5px;background:${C.blueSoft};color:${C.blue};font-size:11px;font-weight:700;letter-spacing:.4px">QA</span>${qa}</div>` : ""}
        ${d.remarks ? `<div style="margin-top:10px;padding:8px 10px;border-radius:6px;background:${C.paper};font-size:13px;color:${C.ink2}"><span style="color:${C.muted}">Remarks</span>&nbsp; ${esc(d.remarks)}</div>` : ""}
      </td></tr>
    </table></td></tr>`;
};

const latestBlock = latest.holiday
  ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px dashed ${C.hol};border-radius:10px;background:${C.holSoft}"><tr><td style="padding:16px 18px;font-size:14px;line-height:1.55;color:${C.ink2}">
       <b style="color:${C.hol};font-size:15px">Official holiday${holName(latest.remarks) ? ` \u00b7 ${esc(holName(latest.remarks))}` : ""}</b><br>No board meeting ${nd("this Friday")}. This week is not counted in the totals or the discussion rate.</td></tr></table>`
  : latest.count
  ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${latest.designs.map(designCard).join("")}</table>`
  : `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px dashed ${C.hatch};border-radius:10px;background:${C.ochreSoft}"><tr><td style="padding:16px 18px;font-size:14px;line-height:1.55;color:${C.ink2}">
       <b style="color:${C.ochre};font-size:15px">No design discussed</b><br>${latest.recorded
         ? (latest.remarks ? esc(latest.remarks) : "The board met with no designs on the agenda.")
         : `Nothing was recorded for ${nd("this Friday")}, so it counts as no design discussed. If designs were discussed, or a make-up session follows, <a href="${DASHBOARD_URL}" style="color:${C.blue};font-weight:600">add them on the dashboard</a>.`}</td></tr></table>`;

const kpi = (label, value, accent, color = C.ink) => `<td width="25%" style="padding:0 5px;vertical-align:top">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ${C.line};border-top:3px solid ${accent};border-radius:8px;background:${C.surface}">
    <tr><td style="padding:12px 12px 14px"><div style="font-size:10.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.muted}">${label}</div>
      <div style="font-size:26px;font-weight:800;line-height:1.1;margin-top:6px;color:${color}">${value}</div></td></tr></table></td>`;

const maxCount = Math.max(1, ...weeks.map(w => w.count));
const summaryRows = weeks.slice().reverse().map(w => {
  const pct = Math.round((w.count / maxCount) * 100);
  const makeUps = [...new Set(w.designs.filter(d => d.meetingDate !== w.f).map(d => DAY[dow(d.meetingDate)]))];
  const cell = `height:8px;border-radius:4px;font-size:0;line-height:0`;
  const bar = w.holiday
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="${cell};background:${C.holSoft};border:1px dashed ${C.hol}">&nbsp;</td></tr></table>`
    : w.count
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="${pct}%" style="${cell};background:${C.blue}">&nbsp;</td>${pct < 100 ? `<td style="${cell};background:${C.line2}">&nbsp;</td>` : ""}</tr></table>`
    : `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="${cell};background:${C.ochreSoft};border:1px solid ${C.hatch}">&nbsp;</td></tr></table>`;
  const td = `padding:11px 10px;border-bottom:1px solid ${C.line2}`;
  const holPill = `<span style="display:inline-block;padding:2px 9px;border-radius:12px;border:1px dashed ${C.hol};background:${C.holSoft};color:${C.hol};font-size:12px;font-weight:700;white-space:nowrap">Official Holiday</span>`;
  return `<tr${w.holiday ? ` style="background:${C.holSoft}"` : ""}>
    <td style="${td};font-size:14px;white-space:nowrap;color:${C.ink}"><b style="font-weight:600">${nd(short(w.f))}</b>${w.holiday ? `<div style="font-size:11.5px;color:${C.hol};margin-top:2px">Not counted${holName(w.remarks) ? " \u00b7 " + esc(holName(w.remarks)) : ""}</div>` : ""}${makeUps.length ? `<div style="font-size:11.5px;color:${C.ochre};margin-top:2px">${nd("Make-up: " + makeUps.join(", "))}</div>` : ""}</td>
    <td width="40%" style="${td};vertical-align:middle">${bar}</td>
    <td align="right" style="${td};font-size:15px;font-weight:800;color:${w.holiday ? C.hol : w.count ? C.ink : C.ochre}">${w.holiday ? "\u2014" : w.count}</td>
    <td align="right" style="${td}">${w.holiday ? holPill : pill(w.count)}</td></tr>`;
}).join("");

// Meeting week runs Friday \u2192 Thursday, e.g. "25 Sep \u2013 01 Oct 2026"
const weekRange = f => { const e = add(f, 6), [fd, fm, fy] = short(f).split("-"), [ed, em, ey] = short(e).split("-");
  return fy === ey ? `${fd} ${fm} \u2013 ${ed} ${em} ${ey}` : `${fd} ${fm} ${fy} \u2013 ${ed} ${em} ${ey}`; };
const weekLabel = `Week ${weekRange(latest.f)} (Fri\u2013Thu)`;
const subject = latest.holiday
  ? `Design Evaluation Board \u00b7 ${weekLabel} \u00b7 Official holiday${holName(latest.remarks) ? " (" + holName(latest.remarks) + ")" : ""}`
  : latest.count
  ? `Design Evaluation Board \u00b7 ${weekLabel} \u00b7 ${latest.count} design${latest.count === 1 ? "" : "s"} discussed`
  : `Design Evaluation Board \u00b7 ${weekLabel} \u00b7 No design discussed`;
const preheader = latest.holiday
  ? "Official holiday: no board meeting this Friday, not counted in the totals."
  : latest.count
  ? latest.designs.slice(0, 3).map(d => idOf(d) || d.designName).join(", ") + (latest.count > 3 ? ` and ${latest.count - 3} more` : "")
  : "No design was discussed this Friday.";

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.paper};font-family:${FONT};color:${C.ink};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.paper}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px">

  <tr><td style="padding:0 4px 14px">
    <table role="presentation" cellspacing="0" cellpadding="0"><tr>
      <td width="36" height="36" align="center" bgcolor="${C.navy}" style="width:36px;height:36px;border-radius:9px;background:${C.navy};color:#fff;font-size:12px;font-weight:800;letter-spacing:.5px">DEB</td>
      <td style="padding-left:10px;font-size:14px;font-weight:700;color:${C.ink}">Design Evaluation Board<div style="font-size:12px;font-weight:400;color:${C.muted}">Weekly summary</div></td>
    </tr></table></td></tr>

  <tr><td bgcolor="${C.navy}" style="background:${C.navy};background-image:linear-gradient(135deg,${C.navy2} 0%,${C.navy} 65%);border-radius:14px 14px 0 0;padding:26px 28px">
    <div style="font-size:11px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:${C.navyMuted}">Latest board meeting</div>
    <div style="font-size:24px;font-weight:700;color:#fff;margin-top:8px;line-height:1.25">${nd(long(latest.f))}</div>
    <div style="font-size:14px;color:${C.navyMuted};margin-top:2px">${nd("5:00 PM")} &nbsp;\u00b7&nbsp; ${nd(weekLabel)}</div>
    ${latest.holiday ? `<div style="margin-top:16px;font-size:30px;font-weight:800;color:#fff">Official holiday</div><div style="font-size:14px;color:${C.navyMuted};margin-top:4px">${holName(latest.remarks) ? esc(holName(latest.remarks)) + " \u00b7 " : ""}not counted in the totals</div>` : `
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:16px"><tr>
      <td style="font-size:52px;font-weight:800;line-height:1;color:${latest.count ? "#fff" : C.hatch};letter-spacing:-1.5px">${latest.count}</td>
      <td style="padding-left:12px;vertical-align:bottom;padding-bottom:6px;font-size:15px;color:${C.navyMuted}">design${latest.count === 1 ? "" : "s"} discussed</td>
    </tr></table>`}
  </td></tr>

  <tr><td style="background:${C.surface};border:1px solid ${C.line};border-top:0;border-radius:0 0 14px 14px;padding:24px 24px 8px">
    ${eyebrow(latest.count ? "Designs discussed" : "This week")}
    ${latestBlock}

    <div style="height:12px;line-height:12px">&nbsp;</div>
    ${eyebrow(nd(`Last ${weeks.length} Friday${weeks.length === 1 ? "" : "s"}`))}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      ${kpi(holidays ? `Weeks (${holidays} hol.)` : "Weeks", working, C.blue)}${kpi("Designs", total, C.blue)}${kpi("No design", working - withD, C.ochre, C.ochre)}${kpi("Rate", rate + "%", C.blue)}
    </tr></table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px;border-collapse:collapse">${summaryRows}</table>

    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 20px"><tr>
      <td bgcolor="${C.blue}" style="border-radius:8px;background:${C.blue}"><a href="${DASHBOARD_URL}" style="display:inline-block;padding:12px 20px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;border-radius:8px">Open the dashboard &rarr;</a></td>
    </tr></table>
  </td></tr>

  <tr><td align="center" style="padding:16px 12px 0;font-size:12px;line-height:1.6;color:${C.muted}">
    ${nd("Sent automatically every Friday at 6:30 PM IST, after the 5:00 PM board.")}<br>${nd("Make-up sessions held Monday to Thursday count toward the Friday before them. Official holidays are not counted.")}
  </td></tr>
</table></td></tr></table></body></html>`;

const text = [subject, "",
  ...(latest.count
    ? latest.designs.map(d => `- ${idOf(d) ? idOf(d) + " " : ""}${d.designName}${d.owner ? ` (${d.owner})` : ""}${madeUp(d)}${d.description && d.description !== d.designName ? `\n  ${d.description}` : ""}`)
    : [latest.holiday ? `Official holiday${holName(latest.remarks) ? " (" + holName(latest.remarks) + ")" : ""}. Not counted.` : "No design discussed."]),
  "", `Last ${weeks.length} Friday${weeks.length === 1 ? "" : "s"}: ${total} designs, ${working - withD} week${working - withD === 1 ? "" : "s"} with none, ${rate}% discussion rate${holidays ? ` (${holidays} holiday${holidays === 1 ? "" : "s"} excluded)` : ""}`,
  ...weeks.slice().reverse().map(w => `  ${short(w.f)}  ${w.holiday ? "\u2014" : w.count}  ${w.holiday ? "Official Holiday" : w.count ? "Discussed" : "No Design Discussed"}`),
  "", `Dashboard: ${DASHBOARD_URL}`].join("\n");

// Some mail clients (e.g. Zimbra) read the message as Windows-1252, turning "\u00b7" into "\u00c2\u00b7".
// Send pure ASCII: HTML gets numeric entities; subject and plain text get ASCII look-alikes.
const ASCII = { "\u00b7": "|", "\u2013": "-", "\u2014": "-", "\u2192": "->", "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2026": "...", "\u00f7": "/", "\u2022": "*" };
const toAscii = t => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x00-\x7F]/g, c => ASCII[c] ?? "");
const htmlSafe = html.replace(/[^\x00-\x7F]/g, c => `&#${c.codePointAt(0)};`);

return [{ json: { subject: toAscii(subject), html: htmlSafe, text: toAscii(text), meetingDate: latest.f, designCount: latest.count } }];
