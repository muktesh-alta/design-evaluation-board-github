/* =====================================================================
   DASHBOARD CONFIGURATION — the only file you normally edit.
   ===================================================================== */
window.DEB_CONFIG = {
  /* "local" = records saved in this browser only (works with no setup).
     "n8n"   = records read/saved through your n8n webhooks + Google Sheet. */
  storage: "n8n",

  n8n: {
    /* Production webhook base, WITHOUT a trailing slash.
       n8n Cloud:    https://YOUR-NAME.app.n8n.cloud/webhook
       Self-hosted:  https://n8n.your-company.com/webhook               */
    baseUrl: "https://autoflows-dev.altametrics.com/webhook",
    readPath: "/deb-records",        // GET  -> { records: [...] }
    savePath: "/deb-records-save",   // POST { record } -> { ok, id }
    /* Must match the value of the "Header Auth" credential in n8n.
       NOTE: GitHub Pages is public, so anyone can read this key in the
       page source. It stops casual/bot traffic, not a determined user. */
    apiKey: "133a6fea8e411273d8f546bef5bf7311a780dd02ce174485",
    apiKeyHeader: "X-API-Key",
    /* Every refresh is one n8n execution.
       pollSeconds: auto-refresh interval while the page is open (min 60).
                    0 = off; data loads on page open, after saves, and on return to the tab.
       focusRefreshSeconds: on returning to the tab, refresh only if data is older than this. */
    pollSeconds: 0,
    focusRefreshSeconds: 300
  }
};
