/* =====================================================================
   DATA ACCESS LAYER — the UI only ever talks to DataService.
   To move to an API / database / Google Sheets / Excel / PostgreSQL,
   write an adapter with the same five methods and pass it to init().
   ===================================================================== */

/** Adapter contract:
 *  kind: string label shown in the UI
 *  load(): Promise<Record[]>
 *  subscribe(onChange: (records) => void): unsubscribe   (optional; live updates)
 *  add(record): Promise<Record>      update(id, patch): Promise<void>      remove(id): Promise<void>
 */

class LocalStorageAdapter {
  constructor(key = "deb.designs.v1") { this.key = key; this.kind = "Saved in this browser"; this.listeners = new Set(); }
  _read() { try { return JSON.parse(localStorage.getItem(this.key) || "[]"); } catch { return []; } }
  _write(list) { try { localStorage.setItem(this.key, JSON.stringify(list)); } catch (e) { throw { code: "storage", message: "This browser blocked saving." }; } this.listeners.forEach(fn => fn(list)); }
  async load() { return this._read(); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async add(rec) { const r = { ...rec, id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }; this._write([...this._read(), r]); return r; }
  async update(id, patch) { this._write(this._read().map(r => r.id === id ? { ...r, ...patch } : r)); }
  async remove(id) { this._write(this._read().filter(r => r.id !== id)); }
}

/** Shared store provided by the claude.ai artifact runtime (used only when the page runs inside claude.ai) (collection "designs", one doc per record). */
class ClaudeDbAdapter {
  constructor(db, collection = "designs") { this.col = db.collection(collection); this.kind = "Saved to the shared board"; }
  async load() { const s = await this.col.get(); return s.docs.map(d => ({ ...d.data(), id: d.id })); }
  subscribe(fn, onError) { return this.col.onSnapshot(s => fn(s.docs.map(d => ({ ...d.data(), id: d.id }))), onError); }
  async add(rec) { const ref = this.col.doc(); const r = { ...rec, id: ref.id }; await ref.set(r); return r; }
  async update(id, patch) { await this.col.doc(id).update(patch); }
  async remove(id) { await this.col.doc(id).delete(); }
}


/** n8n webhooks in front of a Google Sheet (see /n8n in the repo).
 *  Saves are upserts keyed on `id`; deletes are soft (deleted = TRUE),
 *  which also leaves an audit trail in the sheet. */
class N8nApiAdapter {
  constructor(cfg) {
    this.cfg = cfg; this.kind = "Saved to Google Sheets via n8n";
    this.cache = []; this.listeners = new Set(); this.timer = null; this.lastLoad = 0;
  }
  async _req(method, path, body) {
    let res;
    try {
      res = await fetch(this.cfg.baseUrl.replace(/\/$/, "") + path, {
        method, mode: "cors",
        headers: { "Content-Type": "application/json", [this.cfg.apiKeyHeader || "X-API-Key"]: this.cfg.apiKey },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) { throw { code: "network", message: "Couldn't reach n8n. Check the webhook URL, that the workflow is active, and its allowed origins (CORS)." }; }
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
    if (res.status === 401 || res.status === 403) throw { code: "auth", message: "n8n rejected the API key. Make sure config.js and the n8n Header Auth credential match." };
    if (!res.ok) throw { code: "server", message: (json && json.error) || `n8n returned ${res.status}.` };
    if (!json) throw { code: "server", message: "n8n returned a response that isn't JSON. Check the Respond to Webhook node." };
    return json;
  }
  _emit() { this.listeners.forEach(fn => fn(this.cache)); }
  async load() {
    const json = await this._req("GET", this.cfg.readPath);
    const list = Array.isArray(json) ? json : (json.records || []);
    this.cache = list.filter(r => r && r.id && DateUtil.isISO(r.meetingDate));
    this.lastLoad = Date.now();
    return this.cache;
  }
  async _refresh() {
    const before = JSON.stringify(this.cache);
    try { await this.load(); } catch (e) { console.warn("n8n refresh failed", e); return; }
    if (JSON.stringify(this.cache) !== before) this._emit();
  }
  /* Each refresh is one n8n execution, so keep them rare:
     pollSeconds > 0 polls while the tab is visible (min 60s); 0 turns polling off.
     Returning to the tab refreshes only if the data is older than focusRefreshSeconds. */
  subscribe(fn) {
    this.listeners.add(fn);
    if (!this.timer) {
      this.timer = true;
      const poll = Number(this.cfg.pollSeconds) || 0;
      if (poll > 0) setInterval(() => document.visibilityState === "visible" && this._refresh(), Math.max(60, poll) * 1000);
      const stale = Math.max(60, Number(this.cfg.focusRefreshSeconds) || 300) * 1000;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && Date.now() - this.lastLoad > stale) this._refresh();
      });
    }
    return () => this.listeners.delete(fn);
  }
  async _save(record) {
    await this._req("POST", this.cfg.savePath, { record });
    const i = this.cache.findIndex(r => r.id === record.id);
    if (record.deleted) { if (i >= 0) this.cache.splice(i, 1); }
    else if (i >= 0) this.cache[i] = record; else this.cache.push(record);
    this.cache = this.cache.slice(); this._emit();
  }
  newId() { return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  async add(rec) { const r = { ...rec, id: this.newId(), deleted: false }; await this._save(r); return r; }
  async update(id, patch) { const cur = this.cache.find(r => r.id === id); if (!cur) throw { code: "server", message: "That record no longer exists. Refresh the page." }; await this._save({ ...cur, ...patch, deleted: false }); }
  async remove(id) { const cur = this.cache.find(r => r.id === id); if (!cur) return; await this._save({ ...cur, deleted: true, updatedAt: new Date().toISOString() }); }
}

/* Example for later — same contract, REST backend:
class RestApiAdapter {
  constructor(base) { this.base = base; this.kind = "Saved to server"; }
  async load() { return (await fetch(`${this.base}/designs`)).json(); }
  async add(rec) { return (await fetch(`${this.base}/designs`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(rec) })).json(); }
  async update(id, patch) { await fetch(`${this.base}/designs/${id}`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify(patch) }); }
  async remove(id) { await fetch(`${this.base}/designs/${id}`, { method: "DELETE" }); }
}
*/

const DataService = (() => {
  let adapter = null, records = [], unsub = null;
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => { try { fn(records); } catch (e) { console.error(e); } });
  const set = list => { records = list.slice(); emit(); };

  return {
    async init(a, onError) {
      adapter = a;
      set(await a.load());
      if (a.subscribe) unsub = a.subscribe(set, onError);
    },
    get kind() { return adapter ? adapter.kind : ""; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getDesigns() { return records; },
    async addDesign(input) {
      const now = new Date().toISOString();
      const rec = await adapter.add({ ...input, createdAt: now, updatedAt: now });
      if (!adapter.subscribe) set([...records, rec]);
      return rec;
    },
    async updateDesign(id, patch) {
      await adapter.update(id, { ...patch, updatedAt: new Date().toISOString() });
      if (!adapter.subscribe) set(records.map(r => r.id === id ? { ...r, ...patch } : r));
    },
    async deleteDesign(id) {
      await adapter.remove(id);
      if (!adapter.subscribe) set(records.filter(r => r.id !== id));
    },
    getWeeklySummary(range, today) { return WeeklyEngine.buildWeeks(records, range, today); }
  };
})();
