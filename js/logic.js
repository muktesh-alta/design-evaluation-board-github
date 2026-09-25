/* =====================================================================
   BUSINESS LOGIC — no DOM access. Safe to unit-test or move server-side.
   ===================================================================== */
const STATUS = Object.freeze({ DISCUSSED: "Discussed", NONE: "No Design Discussed" });
const MEETING = Object.freeze({ day: "Friday", time: "5:00 PM", weekday: 5 });

/* ---------- Dates: ISO "YYYY-MM-DD" strings, arithmetic in UTC ---------- */
const DateUtil = (() => {
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const MONTH = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DAY = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const pad = n => String(n).padStart(2, "0");
  const isISO = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parse(s));
  function parse(s) { const [y, m, d] = s.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); return (dt.getUTCMonth() === m - 1) ? dt : NaN; }
  const fmt = dt => dt.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
  const dow = s => parse(s).getUTCDay();
  const today = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
  /** Meeting week runs Saturday → Friday; returns that week's Friday. */
  const weekFriday = s => addDays(s, (MEETING.weekday - dow(s) + 7) % 7);
  /** Most recent Friday on or before s. */
  const fridayOnOrBefore = s => addDays(s, -((dow(s) - MEETING.weekday + 7) % 7));
  const short = s => { const d = parse(s); return `${pad(d.getUTCDate())}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`; };
  const tick = s => { const d = parse(s); return `${pad(d.getUTCDate())} ${MON[d.getUTCMonth()]}`; };
  const long = s => { const d = parse(s); return `${DAY[d.getUTCDay()]}, ${pad(d.getUTCDate())}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`; };
  const dayName = s => DAY[dow(s)];
  const monthKey = s => s.slice(0, 7);
  const monthLabel = s => { const d = parse(s); return `${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  const weekOfMonth = s => Math.ceil(parse(s).getUTCDate() / 7);
  return { parse, fmt, addDays, dow, today, weekFriday, fridayOnOrBefore, short, tick, long, dayName, monthKey, monthLabel, weekOfMonth, isISO, MON };
})();

/* ---------- Weekly engine: every Friday in range becomes a week ---------- */
const WeeklyEngine = {
  /**
   * @param records all stored records
   * @param range {start, end} ISO dates (inclusive), filter is applied on the meeting Friday
   * @param today ISO date; Fridays after today appear only if they already hold records
   */
  buildWeeks(records, { start, end }, today = DateUtil.today()) {
    if (!DateUtil.isISO(start) || !DateUtil.isISO(end) || start > end) return [];
    const byFriday = new Map();
    for (const r of records) {
      if (!DateUtil.isISO(r.meetingDate)) continue;
      const f = DateUtil.weekFriday(r.meetingDate);
      if (!byFriday.has(f)) byFriday.set(f, []);
      byFriday.get(f).push(r);
    }
    const weeks = [];
    for (let f = DateUtil.weekFriday(start); f <= end; f = DateUtil.addDays(f, 7)) {
      const recs = byFriday.get(f) || [];
      if (f > today && recs.length === 0) continue; // future, nothing planned yet
      const designs = recs.filter(r => r.status === STATUS.DISCUSSED)
        .sort((a, b) => (a.designName || "").localeCompare(b.designName || ""));
      const placeholders = recs.filter(r => r.status === STATUS.NONE);
      weeks.push({
        friday: f,
        weekOfMonth: DateUtil.weekOfMonth(f),
        weekLabel: `Week ${DateUtil.weekOfMonth(f)}`,
        monthKey: DateUtil.monthKey(f),
        monthLabel: DateUtil.monthLabel(f),
        designs, placeholders,
        designCount: designs.length,
        notDiscussedCount: designs.length ? 0 : 1,
        status: designs.length ? STATUS.DISCUSSED : STATUS.NONE,
        explicitNone: !designs.length && placeholders.length > 0,
        remarks: (!designs.length && placeholders[0]?.remarks) || ""
      });
    }
    return weeks;
  },

  kpis(weeks) {
    const totalWeeks = weeks.length;
    const designsDiscussed = weeks.reduce((s, w) => s + w.designCount, 0);
    const weeksWithDesigns = weeks.filter(w => w.designCount > 0).length;
    const notDiscussed = totalWeeks - weeksWithDesigns;
    const rate = totalWeeks ? (weeksWithDesigns / totalWeeks) * 100 : 0;
    return { totalWeeks, designsDiscussed, weeksWithDesigns, notDiscussed, rate };
  },

  /** One row per design; exactly one row per empty week. */
  expandRows(weeks) {
    const rows = [];
    for (const w of weeks) {
      if (w.designs.length) {
        for (const d of w.designs) rows.push(WeeklyEngine._row(w, d, false));
      } else {
        const p = w.placeholders[0];
        rows.push(WeeklyEngine._row(w, p || {
          id: null, meetingDate: w.friday, status: STATUS.NONE, designName: "",
          description: "No design discussed", owner: "", remarks: ""
        }, !p));
      }
    }
    return rows;
  },
  _row(w, r, synthetic) {
    return {
      id: r.id, synthetic, friday: w.friday, weekLabel: w.weekLabel, monthLabel: w.monthLabel,
      meetingDate: r.meetingDate, status: r.status === STATUS.DISCUSSED ? STATUS.DISCUSSED : STATUS.NONE,
      designName: r.designName || "", description: r.description || (r.status === STATUS.NONE ? "No design discussed" : ""),
      owner: r.owner || "", remarks: r.remarks || ""
    };
  },

  /** Latest meeting that has happened (or has records), regardless of filters. */
  latest(records, today = DateUtil.today()) {
    if (!records.length) return null;
    const lastRecord = records.reduce((m, r) => (r.meetingDate > m ? r.meetingDate : m), "0000-00-00");
    const lastFri = DateUtil.weekFriday(lastRecord);
    const todayFri = DateUtil.fridayOnOrBefore(today);
    const f = lastFri > todayFri ? lastFri : todayFri;
    return WeeklyEngine.buildWeeks(records, { start: f, end: f }, f)[0] || null;
  }
};

/* ---------- Table filters, search, sort ---------- */
const TableQuery = {
  apply(rows, f) {
    const q = (f.search || "").trim().toLowerCase();
    const name = (f.designName || "").trim().toLowerCase();
    return rows.filter(r => {
      if (f.status && f.status !== "all" && r.status !== f.status) return false;
      if (name && !r.designName.toLowerCase().includes(name)) return false;
      if (f.owner && f.owner !== "all" && r.owner !== f.owner) return false;
      if (f.week && r.friday !== f.week) return false;
      if (q) {
        const hay = [r.designName, r.description, r.owner, r.remarks, r.status, DateUtil.short(r.meetingDate), r.weekLabel].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  },
  sort(rows, key, dir) {
    const m = dir === "asc" ? 1 : -1;
    const val = r => key === "date" ? r.meetingDate : key === "week" ? r.friday : (r[key] || "\uffff").toLowerCase();
    return [...rows].sort((a, b) => {
      const c = val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0;
      return c * m || (a.meetingDate < b.meetingDate ? 1 : -1) || a.designName.localeCompare(b.designName);
    });
  },
  paginate(rows, page, size) {
    const pages = Math.max(1, Math.ceil(rows.length / size));
    const p = Math.min(Math.max(1, page), pages);
    return { page: p, pages, items: rows.slice((p - 1) * size, p * size), total: rows.length };
  }
};

/* ---------- Validation ---------- */
const Validator = {
  /** @returns {errors:{field:msg}, warnings:{field:msg}} */
  validate(input, records, editingId = null) {
    const errors = {}, warnings = {};
    const date = (input.meetingDate || "").trim();
    if (!date) errors.meetingDate = "Choose the meeting date.";
    else if (!DateUtil.isISO(date)) errors.meetingDate = "Enter a valid date.";
    else if (DateUtil.dow(date) !== MEETING.weekday)
      warnings.meetingDate = `${DateUtil.dayName(date)} isn't a Friday. It will be filed under the meeting on ${DateUtil.long(DateUtil.weekFriday(date))}.`;

    if (input.status === STATUS.DISCUSSED) {
      if (!(input.designName || "").trim()) errors.designName = "Design name is required when a design was discussed.";
      if (!(input.description || "").trim()) errors.description = "Add a short description of the design.";
    } else if (input.status !== STATUS.NONE) {
      errors.status = "Choose whether a design was discussed.";
    }

    if (!errors.meetingDate && DateUtil.isISO(date)) {
      const f = DateUtil.weekFriday(date);
      const sameWeek = records.filter(r => r.id !== editingId && DateUtil.isISO(r.meetingDate) && DateUtil.weekFriday(r.meetingDate) === f);
      const designs = sameWeek.filter(r => r.status === STATUS.DISCUSSED);
      if (input.status === STATUS.NONE) {
        if (designs.length) errors.status = `The ${DateUtil.short(f)} meeting already has ${designs.length} design${designs.length > 1 ? "s" : ""}. Delete ${designs.length > 1 ? "them" : "it"} first to mark the week as no design discussed.`;
        else if (sameWeek.some(r => r.status === STATUS.NONE)) errors.status = `The ${DateUtil.short(f)} meeting is already marked as no design discussed.`;
      } else if (input.status === STATUS.DISCUSSED && (input.designName || "").trim()) {
        const n = input.designName.trim().toLowerCase();
        if (designs.some(r => (r.designName || "").trim().toLowerCase() === n))
          errors.designName = `"${input.designName.trim()}" is already recorded for the ${DateUtil.short(f)} meeting.`;
      }
    }
    return { errors, warnings, ok: Object.keys(errors).length === 0 };
  },

  normalize(input) {
    const meetingDate = input.meetingDate.trim();
    const none = input.status === STATUS.NONE;
    return {
      meetingDate,
      day: DateUtil.dayName(meetingDate),
      meetingTime: MEETING.time,
      status: none ? STATUS.NONE : STATUS.DISCUSSED,
      designName: none ? "" : input.designName.trim(),
      description: none ? "No design discussed" : input.description.trim(),
      owner: none ? "" : (input.owner || "").trim(),
      remarks: (input.remarks || "").trim()
    };
  }
};

/* ---------- Export builders (pure: return data, UI saves it) ---------- */
const Exporter = {
  detailColumns: ["Week", "Meeting Date", "Day", "Meeting Time", "Design Status", "Design Name", "Design Description", "Owner/Presenter", "Remarks"],
  detailRow: r => [`${r.weekLabel}, ${r.monthLabel}`, DateUtil.short(r.meetingDate), DateUtil.dayName(r.meetingDate), MEETING.time,
    r.status, r.designName || "—", r.description, r.owner, r.remarks],
  summaryColumns: ["Week", "Meeting Date", "Design Count", "Status"],
  summaryRow: w => [`${w.weekLabel}, ${w.monthLabel}`, DateUtil.short(w.friday), w.designCount, w.status],
  toCSV(columns, rows) {
    const esc = v => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return "\uFEFF" + [columns, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { STATUS, MEETING, DateUtil, WeeklyEngine, TableQuery, Validator, Exporter };
