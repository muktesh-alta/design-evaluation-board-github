/* =====================================================================
   UI LAYER — reads from DataService, derives views via WeeklyEngine.
   ===================================================================== */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ICON = {
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
};

const PRESETS = [
  { id: "4w", label: "Last 4 weeks" },
  { id: "3m", label: "Last 3 months" },
  { id: "ytd", label: "This year" },
  { id: "all", label: "All records" }
];

const state = {
  ready: false, readOnly: false,
  range: { start: "", end: "" }, preset: "all",
  status: "all", designName: "", owner: "all", search: "", week: null,
  sort: { key: "date", dir: "desc" }, page: 1, pageSize: 10
};
let charts = { trend: null, donut: null };

/* ---------- range helpers ---------- */
function bounds() {
  const recs = DataService.getDesigns();
  const today = DateUtil.today();
  const lastFri = DateUtil.fridayOnOrBefore(today);
  if (!recs.length) return { start: DateUtil.addDays(lastFri, -21), end: today };
  const dates = recs.map(r => r.meetingDate).filter(DateUtil.isISO).sort();
  const lastRec = DateUtil.weekFriday(dates[dates.length - 1]);
  return { start: DateUtil.addDays(DateUtil.weekFriday(dates[0]), -6), end: lastRec > today ? lastRec : today };
}
function presetRange(id) {
  const b = bounds(), today = DateUtil.today(), lastFri = DateUtil.fridayOnOrBefore(today);
  if (id === "4w") return { start: DateUtil.addDays(lastFri, -27), end: b.end };
  if (id === "3m") { const d = DateUtil.parse(today); d.setUTCMonth(d.getUTCMonth() - 3); return { start: DateUtil.fmt(d), end: b.end }; }
  if (id === "ytd") return { start: today.slice(0, 4) + "-01-01", end: b.end };
  return b;
}
function resetFilters() {
  Object.assign(state, { preset: "all", range: presetRange("all"), status: "all", designName: "", owner: "all", search: "", week: null, page: 1 });
}

/* ---------- derived view ---------- */
function view() {
  const recs = DataService.getDesigns();
  const rangeOk = DateUtil.isISO(state.range.start) && DateUtil.isISO(state.range.end) && state.range.start <= state.range.end;
  const weeks = rangeOk ? WeeklyEngine.buildWeeks(recs, state.range) : [];
  const kpi = WeeklyEngine.kpis(weeks);
  const summaryWeeks = state.status === "all" ? weeks : weeks.filter(w => w.status === state.status);
  const allRows = WeeklyEngine.expandRows(weeks);
  const filtered = TableQuery.sort(TableQuery.apply(allRows, state), state.sort.key, state.sort.dir);
  return { recs, rangeOk, weeks, kpi, summaryWeeks, allRows, filtered, latest: WeeklyEngine.latest(recs) };
}

/* ---------- skeleton (rendered once) ---------- */
function mountSkeleton() {
  $("#app").innerHTML = `
  <section class="hero" aria-label="Overview">
    <article class="latest" id="latest"></article>
    <div class="kpis" id="kpis"></div>
  </section>

  <section class="filters" aria-label="Filters">
    <div class="field">
      <span class="lbl" id="rng-lbl">Date range (meeting Friday)</span>
      <div class="range" role="group" aria-labelledby="rng-lbl">
        <input class="input" type="date" id="fStart" aria-label="Start date">
        <span>to</span>
        <input class="input" type="date" id="fEnd" aria-label="End date">
      </div>
    </div>
    <div class="field">
      <span class="lbl">Quick range</span>
      <div class="presets" id="presets">${PRESETS.map(p => `<button class="chip" data-preset="${p.id}" aria-pressed="false">${p.label}</button>`).join("")}</div>
    </div>
    <div class="field">
      <label for="fStatus">Design status</label>
      <select class="input" id="fStatus">
        <option value="all">All</option>
        <option value="${STATUS.DISCUSSED}">Discussed</option>
        <option value="${STATUS.NONE}">No Design Discussed</option>
      </select>
    </div>
    <div class="field grow">
      <label for="fName">Design name</label>
      <input class="input" id="fName" placeholder="Filter by name" autocomplete="off">
    </div>
    <div class="field">
      <label for="fOwner">Owner or presenter</label>
      <select class="input" id="fOwner"></select>
    </div>
    <button class="btn push" id="resetBtn">Reset filters</button>
    <p class="filter-msg" id="filterMsg" role="status"></p>
  </section>

  <section class="panel" style="margin-bottom:20px" aria-labelledby="h-trend">
    <div class="panel-head">
      <div><h2 id="h-trend">Weekly design discussion trend</h2><p>Designs discussed at each Friday meeting in the selected range. Hatched bars mark Fridays where no design was discussed.</p></div>
      <div class="legend"><span><i class="d"></i>Designs discussed</span><span><i class="hatch"></i>No design discussed</span></div>
    </div>
    <div class="chart-box"><canvas id="trendChart" role="img" aria-label="Bar chart of designs discussed per Friday"></canvas></div>
  </section>

  <div class="grid two">
    <section class="panel" aria-labelledby="h-status">
      <div class="panel-head"><div><h2 id="h-status">Discussion status</h2><p>Share of Fridays in the range with at least one design.</p></div></div>
      <div class="donut-box"><canvas id="donutChart" role="img" aria-label="Doughnut chart of weeks with and without designs"></canvas><div class="donut-center" id="donutCenter"></div></div>
      <div class="donut-rows" id="donutRows"></div>
    </section>
    <section class="panel" aria-labelledby="h-summary">
      <div class="panel-head"><div><h2 id="h-summary">Weekly summary</h2><p>Every Friday in the range, grouped by month. Select a week to see its designs below.</p></div></div>
      <div class="scroll"><table id="summaryTable"></table></div>
    </section>
  </div>

  <section class="panel" aria-labelledby="h-details" id="detailsPanel">
    <div class="panel-head">
      <div><h2 id="h-details">Design discussion details</h2><p id="detailsSub">One row per design. Weeks with no design have a single row.</p></div>
      <div class="table-tools">
        <span id="focusChip"></span>
        <div class="search">${ICON.search}<input class="input" id="tSearch" type="search" placeholder="Search details" aria-label="Search design details"></div>
      </div>
    </div>
    <div class="scroll"><table id="detailTable"></table></div>
    <div class="pager" id="pager"></div>
  </section>`;
  bindFilterEvents();
}

/* ---------- renderers ---------- */
function render() {
  if (!state.ready) return;
  const v = view();
  renderStore(); renderLatest(v); renderKpis(v); renderFilters(v); renderCharts(v); renderSummary(v); renderDetails(v);
  $("#foot").textContent = `${v.recs.length} stored record${v.recs.length === 1 ? "" : "s"}. Fridays without a record are added automatically as No Design Discussed.`;
}

function renderStore() {
  const el = $("#store");
  el.classList.toggle("live", DataService.kind.includes("shared"));
  el.lastElementChild.textContent = DataService.kind + (state.readOnly ? " (view only)" : "");
  $("#addBtn").disabled = state.readOnly;
}

function renderLatest({ latest }) {
  const el = $("#latest");
  if (!latest) {
    el.className = "latest empty-week";
    el.innerHTML = `<h2>Latest Design Evaluation Board</h2><div class="when">No meetings recorded yet<small>Add this Friday's outcome to start the record.</small></div>`;
    return;
  }
  const none = latest.designCount === 0;
  el.className = "latest" + (none ? " empty-week" : "");
  const names = latest.designs.slice(0, 4).map(d => `<li><b>${esc(d.designName)}</b>${d.owner ? `, ${esc(d.owner)}` : ""}</li>`).join("");
  const more = latest.designs.length > 4 ? `<li>and ${latest.designs.length - 4} more</li>` : "";
  el.innerHTML = `
    <h2>Latest Design Evaluation Board</h2>
    <div class="when">${DateUtil.long(latest.friday)}<small>${MEETING.time}</small></div>
    <div class="big"><b>${latest.designCount}</b><span>design${latest.designCount === 1 ? "" : "s"} discussed</span></div>
    <span class="pill ${none ? "n" : "d"}">${none ? "No Design Discussed" : "Design Discussed"}</span>
    ${none ? (latest.remarks ? `<ul><li>${esc(latest.remarks)}</li></ul>` : "") : `<ul>${names}${more}</ul>`}`;
}

function renderKpis({ kpi, rangeOk }) {
  const pct = rangeOk && kpi.totalWeeks ? Math.round(kpi.rate) : 0;
  $("#kpis").innerHTML = `
    <div class="kpi"><span class="lbl">Total weeks</span><span class="val">${kpi.totalWeeks}</span><span class="sub">Fridays in the selected range</span></div>
    <div class="kpi"><span class="lbl">Designs discussed</span><span class="val">${kpi.designsDiscussed}</span><span class="sub">Across ${kpi.weeksWithDesigns} meeting${kpi.weeksWithDesigns === 1 ? "" : "s"}</span></div>
    <div class="kpi none"><span class="lbl">No design discussed</span><span class="val">${kpi.notDiscussed}</span><span class="sub">Weekly slots with zero designs</span></div>
    <div class="kpi"><span class="lbl">Discussion rate</span><span class="val">${kpi.totalWeeks ? pct + "%" : "—"}</span>
      <span class="meter ${kpi.totalWeeks ? "hatch" : ""}" aria-hidden="true"><i style="width:${pct}%"></i><i></i></span>
      <span class="sub">Weeks with designs ÷ total weeks</span></div>`;
}

function renderFilters({ recs, rangeOk, weeks }) {
  $("#fStart").value = state.range.start; $("#fEnd").value = state.range.end;
  $("#fStatus").value = state.status;
  if (document.activeElement !== $("#fName")) $("#fName").value = state.designName;
  document.querySelectorAll("#presets .chip").forEach(c => c.setAttribute("aria-pressed", String(c.dataset.preset === state.preset)));
  const owners = [...new Set(recs.map(r => (r.owner || "").trim()).filter(Boolean))].sort();
  if (state.owner !== "all" && !owners.includes(state.owner)) owners.push(state.owner);
  $("#fOwner").innerHTML = `<option value="all">All</option>` + owners.map(o => `<option ${o === state.owner ? "selected" : ""}>${esc(o)}</option>`).join("");
  $("#ownerList").innerHTML = owners.map(o => `<option value="${esc(o)}">`).join("");
  const msg = $("#filterMsg");
  if (!rangeOk) msg.textContent = !state.range.start || !state.range.end ? "Choose both a start and an end date." : "The start date is after the end date. Swap them to see results.";
  else if (!weeks.length) msg.textContent = "There are no past Fridays in this range. Widen the range to include at least one Friday.";
  else msg.textContent = "";
}

function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function hatchPattern() {
  const c = document.createElement("canvas"); c.width = c.height = 8;
  const x = c.getContext("2d");
  x.fillStyle = cssVar("--ochre-soft"); x.fillRect(0, 0, 8, 8);
  x.strokeStyle = cssVar("--hatch"); x.lineWidth = 2;
  x.beginPath(); x.moveTo(-2, 10); x.lineTo(10, -2); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke();
  return x.createPattern(c, "repeat");
}

function renderCharts({ weeks, kpi }) {
  if ($("#donutCenter")) $("#donutCenter").innerHTML = `<b>${kpi.totalWeeks ? Math.round(kpi.rate) + "%" : "—"}</b><span>discussion rate</span>`;
  $("#donutRows").innerHTML = `
    <div><span><span class="legend"><span><i class="d"></i>Weeks with designs discussed</span></span></span><b>${kpi.weeksWithDesigns}</b></div>
    <div><span><span class="legend"><span><i class="hatch"></i>Weeks with no design discussed</span></span></span><b>${kpi.notDiscussed}</b></div>`;
  if (typeof Chart === "undefined") {
    if (!$("#trendChart")) return;
    $("#donutChart").closest(".donut-box").remove();
    $("#trendChart").parentElement.innerHTML = `<div class="empty"><b>Charts couldn't load</b>Check the connection and reload the page. Tables and KPIs still work.</div>`;
    return;
  }
  Chart.defaults.font.family = cssVar("--font");
  Chart.defaults.color = cssVar("--muted");
  const labels = weeks.map(w => DateUtil.tick(w.friday));
  const discussed = weeks.map(w => w.designCount);
  const none = weeks.map(w => w.notDiscussedCount);
  const grid = cssVar("--line-2"), cobalt = cssVar("--cobalt"), hatch = hatchPattern(), ochre = cssVar("--ochre");
  const maxY = Math.max(2, ...discussed);

  const trendCfg = {
    type: "bar",
    data: { labels, datasets: [
      { label: "Designs discussed", data: discussed, backgroundColor: cobalt, borderRadius: 4, maxBarThickness: 44, stack: "s" },
      { label: "No design discussed", data: none, backgroundColor: hatch, borderColor: ochre, borderWidth: { top: 2 }, borderSkipped: "bottom", maxBarThickness: 44, stack: "s" }
    ]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false }, tooltip: {
        filter: i => i.raw > 0,
        callbacks: {
          title: it => DateUtil.long(weeks[it[0].dataIndex].friday),
          label: i => i.datasetIndex === 0 ? ` ${i.raw} design${i.raw === 1 ? "" : "s"} discussed` : " No design discussed (0 designs)"
        } } },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 12 } },
        y: { stacked: true, beginAtZero: true, suggestedMax: maxY + 1, ticks: { precision: 0, stepSize: maxY > 10 ? undefined : 1 }, grid: { color: grid }, border: { display: false },
             title: { display: true, text: "Number of designs" } }
      },
      onClick: (e, els) => { if (els[0]) focusWeek(weeks[els[0].index].friday); }
    }
  };
  if (charts.trend) { charts.trend.data = trendCfg.data; charts.trend.options = trendCfg.options; charts.trend.update(); }
  else charts.trend = new Chart($("#trendChart"), trendCfg);

  const donutData = kpi.totalWeeks ? [kpi.weeksWithDesigns, kpi.notDiscussed] : [0, 0];
  const donutCfg = {
    type: "doughnut",
    data: { labels: ["Weeks with designs", "Weeks with no design"], datasets: [{
      data: kpi.totalWeeks ? donutData : [1], backgroundColor: kpi.totalWeeks ? [cobalt, hatch] : [grid], borderColor: cssVar("--surface"), borderWidth: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "70%", animation: { duration: 250 },
      plugins: { legend: { display: false }, tooltip: { enabled: kpi.totalWeeks > 0, callbacks: { label: i => ` ${i.raw} week${i.raw === 1 ? "" : "s"}` } } } }
  };
  if (charts.donut) { charts.donut.data = donutCfg.data; charts.donut.options = donutCfg.options; charts.donut.update(); }
  else charts.donut = new Chart($("#donutChart"), donutCfg);

}
function rebuildCharts() { charts.trend?.destroy(); charts.donut?.destroy(); charts = { trend: null, donut: null }; render(); }

function renderSummary({ summaryWeeks, weeks }) {
  const t = $("#summaryTable");
  if (!summaryWeeks.length) {
    t.innerHTML = `<tbody><tr><td><div class="empty"><b>No weeks to show</b>${weeks.length ? "No week in this range matches the status filter." : "Adjust the date range to include past Fridays."}</div></td></tr></tbody>`;
    return;
  }
  const max = Math.max(1, ...summaryWeeks.map(w => w.designCount));
  const list = [...summaryWeeks].sort((a, b) => b.friday.localeCompare(a.friday));
  let html = `<thead><tr><th>Week</th><th>Meeting date</th><th>Designs discussed</th><th>Status</th></tr></thead><tbody>`;
  let month = "";
  for (const w of list) {
    if (w.monthKey !== month) { month = w.monthKey; html += `<tr class="month"><td colspan="4">${w.monthLabel}</td></tr>`; }
    const none = !w.designCount;
    html += `<tr class="clickable ${none ? "nodesign" : ""} ${state.week === w.friday ? "focus" : ""}" data-week="${w.friday}" tabindex="0" aria-label="Show designs for ${DateUtil.short(w.friday)}">
      <td class="nowrap">${w.weekLabel}</td>
      <td class="nowrap">${DateUtil.short(w.friday)}</td>
      <td><div class="bar"><span class="track ${none ? "hatch" : ""}"><i style="width:${(w.designCount / max) * 100}%"></i></span><b>${w.designCount}</b></div></td>
      <td>${none ? `<span class="pill n">No Design Discussed</span>` : `<span class="pill d">Discussed</span>`}${none && !w.explicitNone ? `<span class="auto">Added automatically</span>` : ""}</td></tr>`;
  }
  t.innerHTML = html + "</tbody>";
}

function renderDetails(v) {
  const { filtered, allRows } = v;
  const cols = [
    ["week", "Week"], ["date", "Meeting date"], ["status", "Design status"], ["designName", "Design name"],
    [null, "Design description"], ["owner", "Owner or presenter"], [null, "Remarks"], [null, "<span class='sr'>Actions</span>"]
  ];
  const head = cols.map(([k, l]) => {
    if (!k) return `<th>${l}</th>`;
    const on = state.sort.key === k;
    return `<th ${on ? `aria-sort="${state.sort.dir === "asc" ? "ascending" : "descending"}"` : ""}><button class="sort" data-sort="${k}">${l}<span class="arr">${on && state.sort.dir === "asc" ? "▲" : "▼"}</span></button></th>`;
  }).join("");
  const pg = TableQuery.paginate(filtered, state.page, state.pageSize);
  state.page = pg.page;
  const t = $("#detailTable");
  if (!pg.items.length) {
    const noData = !v.recs.length;
    t.innerHTML = `<thead><tr>${head}</tr></thead><tbody><tr><td colspan="8"><div class="empty">
      <b>${noData ? "No records yet" : allRows.length ? "No rows match these filters" : "No Fridays in this range"}</b>
      ${noData ? "Add the outcome of a Friday meeting to begin the weekly record." : allRows.length ? "Clear the search or reset filters to see all rows." : "Widen the date range to include at least one past Friday."}
      ${noData && !state.readOnly ? `<div><button class="btn primary" data-act="first">Add weekly record</button>${DataService.kind.includes("browser") ? ` <button class="btn" data-act="demo">Load demo data</button>` : ""}</div>` : allRows.length ? `<div><button class="btn" data-act="reset">Reset filters</button></div>` : ""}
    </div></td></tr></tbody>`;
  } else {
    t.innerHTML = `<thead><tr>${head}</tr></thead><tbody>` + pg.items.map(r => {
      const none = r.status === STATUS.NONE;
      const acts = state.readOnly ? "" : r.synthetic
        ? `<button class="icon-btn" data-act="addfor" data-date="${r.friday}" aria-label="Add a design for ${DateUtil.short(r.friday)}" title="Add a design for this week">${ICON.plus}</button>`
        : `<button class="icon-btn" data-act="edit" data-id="${esc(r.id)}" aria-label="Edit record" title="Edit">${ICON.edit}</button>
           <button class="icon-btn" data-act="del" data-id="${esc(r.id)}" aria-label="Delete record" title="Delete">${ICON.del}</button>`;
      return `<tr class="${none ? "nodesign" : ""}">
        <td class="nowrap">${r.weekLabel}<span class="auto">${r.monthLabel}</span></td>
        <td class="nowrap">${DateUtil.short(r.meetingDate)}${r.meetingDate !== r.friday ? `<span class="auto">${DateUtil.dayName(r.meetingDate)}</span>` : ""}</td>
        <td>${none ? `<span class="pill n">No Design Discussed</span>` : `<span class="pill d">Discussed</span>`}</td>
        <td>${none ? `<span class="muted">—</span>` : `<b>${esc(r.designName)}</b>`}</td>
        <td class="desc">${esc(r.description)}${r.synthetic ? `<span class="auto">No record entered for this Friday</span>` : ""}</td>
        <td class="nowrap">${esc(r.owner) || `<span class="muted">—</span>`}</td>
        <td class="desc" style="min-width:140px">${esc(r.remarks) || `<span class="muted">—</span>`}</td>
        <td><div class="row-actions">${acts}</div></td></tr>`;
    }).join("") + "</tbody>";
  }
  $("#focusChip").innerHTML = state.week ? `<span class="focus-chip">Week of ${DateUtil.short(state.week)}<button data-act="unfocus" aria-label="Show all weeks">✕</button></span>` : "";
  if (document.activeElement !== $("#tSearch")) $("#tSearch").value = state.search;
  const from = pg.total ? (pg.page - 1) * state.pageSize + 1 : 0, to = Math.min(pg.total, pg.page * state.pageSize);
  $("#pager").innerHTML = pg.total ? `
    <span>Showing ${from}–${to} of ${pg.total} row${pg.total === 1 ? "" : "s"}</span>
    <div class="pages">
      <label for="pgSize">Rows per page</label>
      <select class="input" id="pgSize">${[10, 25, 50, 100].map(n => `<option ${n === state.pageSize ? "selected" : ""}>${n}</option>`).join("")}</select>
      <button class="btn" data-page="${pg.page - 1}" ${pg.page <= 1 ? "disabled" : ""}>Previous</button>
      <span>Page ${pg.page} of ${pg.pages}</span>
      <button class="btn" data-page="${pg.page + 1}" ${pg.page >= pg.pages ? "disabled" : ""}>Next</button>
    </div>` : "";
}

function focusWeek(f) {
  state.week = state.week === f ? null : f; state.page = 1; render();
  if (state.week) $("#detailsPanel").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

/* ---------- events ---------- */
function bindFilterEvents() {
  const onRange = () => { state.range = { start: $("#fStart").value, end: $("#fEnd").value }; state.preset = null; state.week = null; state.page = 1; render(); };
  $("#fStart").addEventListener("change", onRange);
  $("#fEnd").addEventListener("change", onRange);
  $("#presets").addEventListener("click", e => { const b = e.target.closest("[data-preset]"); if (!b) return; state.preset = b.dataset.preset; state.range = presetRange(b.dataset.preset); state.week = null; state.page = 1; render(); });
  $("#fStatus").addEventListener("change", e => { state.status = e.target.value; state.page = 1; render(); });
  $("#fName").addEventListener("input", e => { state.designName = e.target.value; state.page = 1; render(); });
  $("#fOwner").addEventListener("change", e => { state.owner = e.target.value; state.page = 1; render(); });
  $("#tSearch").addEventListener("input", e => { state.search = e.target.value; state.page = 1; render(); });
  $("#resetBtn").addEventListener("click", () => { resetFilters(); render(); toast("Filters reset to all records."); });

  $("#summaryTable").addEventListener("click", e => { const tr = e.target.closest("[data-week]"); if (tr) focusWeek(tr.dataset.week); });
  $("#summaryTable").addEventListener("keydown", e => { const tr = e.target.closest("[data-week]"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); focusWeek(tr.dataset.week); } });

  $("#detailsPanel").addEventListener("click", e => {
    const s = e.target.closest("[data-sort]");
    if (s) { const k = s.dataset.sort; state.sort = { key: k, dir: state.sort.key === k && state.sort.dir === "asc" ? "desc" : state.sort.key === k ? "asc" : (k === "date" || k === "week" ? "desc" : "asc") }; render(); return; }
    const p = e.target.closest("[data-page]"); if (p) { state.page = +p.dataset.page; render(); return; }
    const a = e.target.closest("[data-act]"); if (!a) return;
    const act = a.dataset.act;
    if (act === "edit") openRecord(DataService.getDesigns().find(r => r.id === a.dataset.id));
    else if (act === "del") confirmDelete(a.dataset.id);
    else if (act === "addfor") openRecord(null, { meetingDate: a.dataset.date });
    else if (act === "first") openRecord();
    else if (act === "reset") { resetFilters(); render(); }
    else if (act === "unfocus") { state.week = null; render(); }
    else if (act === "demo") loadDemo();
  });
  $("#detailsPanel").addEventListener("change", e => { if (e.target.id === "pgSize") { state.pageSize = +e.target.value; state.page = 1; render(); } });
}

/* ---------- record dialog ---------- */
const dlg = { el: null, editing: null, confirmedWarn: false };
function statusValue() { return document.querySelector('input[name="st"]:checked').value; }
function syncStatusFields() {
  const none = statusValue() === STATUS.NONE;
  $("#designFields").classList.toggle("hide", none);
  $("#noneFields").classList.toggle("hide", !none);
  $("#saveAnother").classList.toggle("hide", none || !!dlg.editing);
}
function clearErrors() {
  ["meetingDate", "status", "designName", "description"].forEach(k => { const e = $("#e-" + k); if (e) e.textContent = ""; });
  $("#w-meetingDate").textContent = ""; $("#formAlert").textContent = "";
  ["#f-date", "#f-name", "#f-desc"].forEach(s => $(s).removeAttribute("aria-invalid"));
}
function openRecord(rec = null, preset = {}) {
  if (state.readOnly) return;
  dlg.editing = rec; dlg.confirmedWarn = false;
  clearErrors();
  const src = rec || { meetingDate: preset.meetingDate || DateUtil.fridayOnOrBefore(DateUtil.today()), status: STATUS.DISCUSSED };
  $("#dlgTitle").textContent = rec ? "Edit record" : "Add weekly record";
  $("#dlgSub").textContent = rec ? `Meeting on ${DateUtil.long(rec.meetingDate)}` : "Record a design from a Friday meeting, or mark a week with no design.";
  $("#f-date").value = src.meetingDate || "";
  $(src.status === STATUS.NONE ? "#st-none" : "#st-disc").checked = true;
  $("#f-name").value = src.designName || ""; $("#f-desc").value = rec && rec.status === STATUS.DISCUSSED ? rec.description || "" : "";
  $("#f-owner").value = src.owner || ""; $("#f-remarks").value = src.remarks || ""; $("#f-remarks2").value = src.remarks || "";
  $("#saveBtn").textContent = rec ? "Save changes" : "Save record";
  syncStatusFields();
  $("#recordDlg").showModal();
  setTimeout(() => (rec ? $("#f-name") : $("#f-date")).focus(), 30);
}
function readForm() {
  const none = statusValue() === STATUS.NONE;
  return { meetingDate: $("#f-date").value, status: statusValue(), designName: $("#f-name").value, description: $("#f-desc").value,
    owner: $("#f-owner").value, remarks: none ? $("#f-remarks2").value : $("#f-remarks").value };
}
async function saveRecord(another) {
  clearErrors();
  const input = readForm();
  const res = Validator.validate(input, DataService.getDesigns(), dlg.editing?.id ?? null);
  const map = { meetingDate: "#f-date", designName: "#f-name", description: "#f-desc" };
  for (const [k, m] of Object.entries(res.errors)) { $("#e-" + k).textContent = m; if (map[k]) $(map[k]).setAttribute("aria-invalid", "true"); }
  if (!res.ok) { const first = Object.keys(res.errors).find(k => map[k]); if (first) $(map[first]).focus(); return; }
  if (res.warnings.meetingDate && !dlg.confirmedWarn) {
    $("#w-meetingDate").textContent = res.warnings.meetingDate + " Select save again to confirm.";
    dlg.confirmedWarn = true; $("#saveBtn").textContent = "Save anyway"; return;
  }
  const rec = Validator.normalize(input);
  const btns = [$("#saveBtn"), $("#saveAnother")]; btns.forEach(b => b.disabled = true);
  try {
    if (dlg.editing) await DataService.updateDesign(dlg.editing.id, rec);
    else await DataService.addDesign(rec);
    // A real design replaces any "no design" marker for the same week.
    let replaced = 0;
    if (rec.status === STATUS.DISCUSSED) {
      const f = DateUtil.weekFriday(rec.meetingDate);
      for (const p of DataService.getDesigns().filter(r => r.status === STATUS.NONE && r.id !== dlg.editing?.id && DateUtil.weekFriday(r.meetingDate) === f)) { await DataService.deleteDesign(p.id); replaced++; }
    }
    const when = DateUtil.short(DateUtil.weekFriday(rec.meetingDate));
    toast(dlg.editing ? "Changes saved." : rec.status === STATUS.NONE ? `${when} saved as no design discussed.` : `"${rec.designName}" added to ${when}.` + (replaced ? " The no design marker for that week was removed." : ""));
    ensureInRange(rec.meetingDate);
    if (another) {
      $("#f-name").value = ""; $("#f-desc").value = ""; $("#f-remarks").value = ""; $("#f-name").focus(); dlg.confirmedWarn = true;
    } else $("#recordDlg").close();
  } catch (e) { handleWriteError(e, $("#formAlert")); }
  finally { btns.forEach(b => b.disabled = false); if (!dlg.editing && !another) $("#saveBtn").textContent = "Save record"; }
}
function ensureInRange(date) {
  const f = DateUtil.weekFriday(date);
  if (state.preset === "all" || (state.range.start && f < state.range.start) || (state.range.end && f > state.range.end)) {
    const b = bounds();
    if (state.preset === "all") state.range = b;
    else { if (f < state.range.start) state.range.start = DateUtil.addDays(f, -6); if (f > state.range.end) state.range.end = f; state.preset = null; }
    render();
  }
}
function handleWriteError(e, target) {
  const code = e?.code;
  let msg = "The record couldn't be saved. Try again in a moment.";
  if (code === "invalid_argument" || code === "not_granted") { msg = "You have view-only access to this board, so records can't be changed here."; state.readOnly = true; render(); }
  else if (code === "quota_exceeded") msg = "The board has reached its storage limit. Delete old records or export and archive them before adding more.";
  else if (code === "revoked") msg = "Access to this board changed. Reload the page to continue.";
  else if (["storage", "network", "auth", "server"].includes(code)) msg = e.message;
  if (target) target.textContent = msg; else toast(msg, true);
}

let pendingDelete = null;
function confirmDelete(id) {
  const r = DataService.getDesigns().find(x => x.id === id); if (!r) return;
  pendingDelete = id;
  $("#cfText").textContent = r.status === STATUS.NONE
    ? `The no design marker for ${DateUtil.short(r.meetingDate)} will be removed. The week will still appear as No Design Discussed.`
    : `"${r.designName}" from the ${DateUtil.short(r.meetingDate)} meeting will be permanently removed.`;
  $("#confirmDlg").showModal();
}
async function loadDemo() {
  const d = (m, n, desc, o, rem = "") => ({ meetingDate: m, status: STATUS.DISCUSSED, designName: n, description: desc, owner: o, remarks: rem });
  const base = DateUtil.fridayOnOrBefore(DateUtil.today()), w = k => DateUtil.addDays(base, -7 * k);
  const demo = [
    d(w(3), "Navigation Design", "Navigation flow enhancement", "QA Team"), d(w(3), "PUC Design", "PUC workflow changes", "QA Team"),
    d(w(2), "Dashboard Design", "New dashboard layout", "Design Team"),
    d(w(0), "Execution Design", "Live execution monitoring", "QA Team")
  ];
  try { for (const r of demo) await DataService.addDesign(Validator.normalize(r)); resetFilters(); render(); toast("Demo data loaded. One week was left empty on purpose."); }
  catch (e) { handleWriteError(e); }
}

/* ---------- exports ---------- */
let downloadsNs;
async function saveFile(filename, data, mime) {
  if (downloadsNs === undefined) downloadsNs = window.claude?.use ? await window.claude.use("downloads") : null;
  if (downloadsNs) {
    try { await downloadsNs.save({ filename, data }); toast(`${filename} is ready.`); }
    catch (e) { if (e?.code !== "declined") toast(e?.code === "rate_limited" ? "A save prompt is already open." : "The file couldn't be saved here.", true); }
    return;
  }
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function stamp() { return `${state.range.start || "start"}_to_${state.range.end || "end"}`; }
async function doExport(kind) {
  const v = view();
  if (kind === "csv") {
    if (!v.filtered.length) return toast("No rows match the current filters, so there's nothing to export.", true);
    return saveFile(`design-evaluation-details_${stamp()}.csv`, Exporter.toCSV(Exporter.detailColumns, v.filtered.map(Exporter.detailRow)), "text/csv");
  }
  if (kind === "summary") {
    if (!v.summaryWeeks.length) return toast("No weeks in the current range to export.", true);
    const weeks = [...v.summaryWeeks].sort((a, b) => a.friday.localeCompare(b.friday));
    return saveFile(`design-evaluation-weekly-summary_${stamp()}.csv`, Exporter.toCSV(Exporter.summaryColumns, weeks.map(Exporter.summaryRow)), "text/csv");
  }
  if (kind === "xlsx") {
    if (typeof XLSX === "undefined") return toast("The Excel library didn't load. Use Export CSV instead.", true);
    const wb = XLSX.utils.book_new();
    const det = XLSX.utils.aoa_to_sheet([Exporter.detailColumns, ...v.filtered.map(Exporter.detailRow)]);
    det["!cols"] = [18, 14, 10, 12, 20, 26, 44, 20, 30].map(w => ({ wch: w }));
    const weeks = [...v.summaryWeeks].sort((a, b) => a.friday.localeCompare(b.friday));
    const sum = XLSX.utils.aoa_to_sheet([Exporter.summaryColumns, ...weeks.map(Exporter.summaryRow), [], ["Total weeks", v.kpi.totalWeeks], ["Designs discussed", v.kpi.designsDiscussed], ["No design discussed", v.kpi.notDiscussed], ["Discussion rate", `${Math.round(v.kpi.rate)}%`]]);
    sum["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, det, "Design details");
    XLSX.utils.book_append_sheet(wb, sum, "Weekly summary");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    return saveFile(`design-evaluation-board_${stamp()}.xlsx`, buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }
}

/* ---------- toasts ---------- */
function toast(msg, bad = false) {
  const t = Object.assign(document.createElement("div"), { className: "toast" + (bad ? " bad" : ""), textContent: msg });
  $("#toasts").appendChild(t); setTimeout(() => t.remove(), 4200);
}

/* ---------- global wiring ---------- */
function wireGlobal() {
  $("#addBtn").addEventListener("click", () => openRecord());
  document.querySelectorAll('input[name="st"]').forEach(r => r.addEventListener("change", () => { clearErrors(); syncStatusFields(); }));
  $("#f-date").addEventListener("change", () => { dlg.confirmedWarn = false; $("#w-meetingDate").textContent = ""; $("#saveBtn").textContent = dlg.editing ? "Save changes" : "Save record"; });
  $("#saveBtn").addEventListener("click", () => saveRecord(false));
  $("#saveAnother").addEventListener("click", () => saveRecord(true));
  document.querySelectorAll("dialog [data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
  $("#cfOk").addEventListener("click", async () => {
    const id = pendingDelete; $("#confirmDlg").close(); if (!id) return;
    try { await DataService.deleteDesign(id); toast("Record deleted."); } catch (e) { handleWriteError(e); }
  });
  const menu = $("#exportMenu");
  $("#exportBtn").addEventListener("click", e => { e.stopPropagation(); const o = menu.classList.toggle("open"); $("#exportBtn").setAttribute("aria-expanded", String(o)); });
  document.addEventListener("click", e => { if (!menu.contains(e.target)) { menu.classList.remove("open"); $("#exportBtn").setAttribute("aria-expanded", "false"); } });
  document.addEventListener("keydown", e => { if (e.key === "Escape") menu.classList.remove("open"); });
  menu.addEventListener("click", e => { const b = e.target.closest("[data-export]"); if (b) { menu.classList.remove("open"); doExport(b.dataset.export); } });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rebuildCharts);
  new MutationObserver(rebuildCharts).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

function showConnectionError(e) {
  const msg = e?.message || "The records couldn't be loaded.";
  setTimeout(() => {
    const el = document.createElement("div");
    el.className = "form-alert"; el.setAttribute("role", "alert"); el.style.marginBottom = "20px";
    el.innerHTML = `<b>Records couldn't be loaded.</b> ${esc(msg)} <button class="btn" style="margin-left:8px;min-height:30px" onclick="location.reload()">Try again</button>`;
    $("#app").prepend(el);
  });
}

/* ---------- boot ---------- */
(async function boot() {
  wireGlobal();
  const cfg = window.DEB_CONFIG || { storage: "local" };
  let adapter = null;
  if (cfg.storage === "n8n") {
    adapter = new N8nApiAdapter(cfg.n8n);
  } else {
    try {
      const db = window.claude?.use ? await window.claude.use("db") : null;
      if (db) { const a = new ClaudeDbAdapter(db); await a.load(); adapter = a; }
    } catch (e) { console.warn("Shared store unavailable, using browser storage", e); }
  }
  if (!adapter) adapter = new LocalStorageAdapter();
  let first = true;
  DataService.onChange(() => {
    if (first) return;
    if (state.preset === "all") state.range = presetRange("all");
    render();
  });
  try {
    await DataService.init(adapter, err => { if (err?.code === "revoked") { state.readOnly = true; render(); } });
  } catch (e) {
    state.readOnly = true;
    await DataService.init({ kind: "Not connected", load: async () => [] });
    showConnectionError(e);
  }
  first = false;
  mountSkeleton();
  resetFilters();
  state.ready = true;
  render();
})();
