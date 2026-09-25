# Design Evaluation Board — Weekly Dashboard

Tracks the designs discussed at the Design Evaluation Board, every Friday at 5:00 PM.
Every Friday is accounted for: a Friday with no record shows as **0 designs, No Design Discussed**.

```
GitHub Pages (this repo)  ──GET/POST──▶  n8n webhooks  ──▶  Google Sheet "Designs"
                                                               ▲
                     n8n schedule, Fri 6:30 PM IST ─read───────┘──▶  weekly email
```

## Repository layout

| Path | What it is |
| --- | --- |
| `index.html`, `css/`, `js/` | The dashboard (HTML, CSS, JavaScript, Chart.js) |
| `config.js` | **The only file you normally edit**: storage mode, n8n URL and API key |
| `js/logic.js` | Business rules: Friday generation, KPIs, validation, exports (no UI code) |
| `js/data-service.js` | Data access layer and adapters (browser storage, n8n, REST example) |
| `js/ui.js` | Rendering and interaction |
| `n8n/deb-dashboard-api.workflow.json` | n8n workflow: the dashboard's read/save API on top of Google Sheets |
| `n8n/deb-weekly-email.workflow.json` | n8n workflow: weekly summary email |
| `n8n/*.code.js` | Readable copies of the Code-node scripts embedded in the workflows |
| `data/designs-sheet-template.csv` | Header row for the Google Sheet |
| `data/designs-demo-data.csv` | Optional demo rows (8 Fridays, 3 with no design) |
| `.github/workflows/pages.yml` | Publishes the site to GitHub Pages on every push to `main` |

---

## Step 1: Publish on GitHub Pages

1. Create a repository on GitHub, for example `design-evaluation-board`.
2. Upload the contents of this folder, including the hidden `.github` folder and `.nojekyll`, or push with git:
   ```bash
   git init && git add . && git commit -m "Design Evaluation Board dashboard"
   git branch -M main
   git remote add origin https://github.com/YOUR-USER/design-evaluation-board.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
4. Open the **Actions** tab and wait for "Deploy dashboard to GitHub Pages" to finish.
   Your site is at `https://YOUR-USER.github.io/design-evaluation-board/`.

At this point the dashboard works with `storage: "local"`, which saves records in each person's browser only.
Steps 2 and 3 make records shared and let n8n read them for the email.

> GitHub Pages sites are public, even from a private repo on most plans. If the design names are confidential, use GitHub Enterprise with private Pages, or host `index.html` on an internal server instead.

## Step 2: Create the Google Sheet

1. Create a Google Sheet and rename the first tab to **`Designs`** (exact spelling).
2. Paste this header into row 1 (or import `data/designs-sheet-template.csv`):
   `id, meetingDate, day, meetingTime, status, designName, description, owner, remarks, createdAt, updatedAt, deleted`
3. Select column **B (meetingDate)** and choose **Format → Number → Plain text**. This stops Sheets from turning dates into `9/4/2026`. The workflows also normalise dates if this is missed.
4. Optional: import `data/designs-demo-data.csv` to see the dashboard with sample data.
5. Copy the sheet's URL.

Deletes are soft: the row stays with `deleted = TRUE`, which gives you an audit trail. Filter or remove those rows whenever you like.

## Step 3: Set up n8n

### 3a. Credentials (n8n → Credentials → Add)

| Credential | Used by | Notes |
| --- | --- | --- |
| **Google Sheets OAuth2** | Both workflows | Sign in with an account that can edit the sheet |
| **Header Auth** | API webhooks | Name: `X-API-Key`. Value: a long random string. The same value goes in `config.js` |
| **SMTP** (or swap in Gmail / Outlook) | Email workflow | Your company mail server or an app password |

### 3b. Dashboard API workflow

1. **Workflows → Import from file →** `n8n/deb-dashboard-api.workflow.json`.
2. On both **Read sheet** and **Upsert row**: select your Google credential, paste the sheet URL, and pick the `Designs` tab.
   On **Upsert row**, check that *Column to match on* is `id` and *Mapping* is *Map automatically*.
3. On both webhook nodes (**GET records**, **POST save record**): select the Header Auth credential.
   Under *Options → Allowed Origins (CORS)*, replace `*` with your Pages origin, e.g. `https://YOUR-USER.github.io`.
4. **Save**, then switch the workflow to **Active**.
5. Copy the **Production URL** from the GET webhook, e.g. `https://YOUR-N8N/webhook/deb-records`. The part before `/deb-records` is your `baseUrl`.
6. Test from a terminal:
   ```bash
   curl -H "X-API-Key: YOUR-KEY" https://YOUR-N8N/webhook/deb-records
   # → {"records":[...],"count":13,...}
   ```

### 3c. Point the dashboard at n8n

Edit `config.js`, then commit and push:

```js
storage: "n8n",
n8n: {
  baseUrl: "https://YOUR-N8N/webhook",   // no trailing slash
  apiKey:  "the same value as the Header Auth credential",
  ...
}
```

Reload the site. The header should read **Saved to Google Sheets via n8n**.
Colleagues' changes appear within about a minute; `pollSeconds` controls how often the page checks.

### 3d. Weekly email workflow

1. Import `n8n/deb-weekly-email.workflow.json`.
2. **Read sheet**: select the Google credential, sheet URL and `Designs` tab.
3. **Build weekly email**: at the top of the code, set `DASHBOARD_URL` to your GitHub Pages URL. Optionally change `WEEKS_IN_SUMMARY`.
4. **Send email**: select the SMTP credential and set **From** and **To**. Separate multiple recipients with commas.
   To use Gmail or Outlook instead, replace this node and map `{{ $json.subject }}` and `{{ $json.html }}`.
5. Click **Test workflow**. The *Send test now* trigger sends one immediately.
6. Switch the workflow to **Active**.

**Schedule:** every Friday at 6:30 PM, in the workflow timezone `Asia/Kolkata`. That's 90 minutes after the board, so records can be entered first.
To change it, edit the cron `30 18 * * 5` on the trigger node. For example, `0 9 * * 1` sends a Monday 9 AM recap of the previous Friday.
To change the timezone: **Workflow → Settings → Timezone**.

**What the email contains:**
- The latest Friday's designs, or "0 designs. No Design Discussed."
- A nudge with a link if nothing was recorded for that Friday.
- KPIs and the status of the last 4 Fridays, with empty weeks highlighted.

---

## Weekly use

1. During or after the Friday board, open the dashboard and select **Add weekly record**.
2. Add each design. Use **Save and add another** to keep the same date for the next design.
3. If nothing was presented, choose **No design discussed**. You can also skip it: unrecorded Fridays already count as no design.
4. The email goes out automatically at 6:30 PM.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Couldn't reach n8n" | The workflow isn't **Active**, the `baseUrl` is wrong (use the *Production* URL, not *Test*), or CORS: set *Allowed Origins* on **both** webhook nodes to your `github.io` origin |
| "n8n rejected the API key" | `config.js` `apiKey` doesn't match the Header Auth credential value |
| Saves fail with a 400 error | The toast shows the reason from **Validate record**, e.g. a missing design name |
| Dates look wrong in the sheet | Format column B as Plain text (Step 2.3) |
| Email shows "No design" but designs exist | They were saved in a browser-only (`local`) dashboard. Switch `config.js` to `n8n` and re-enter them |

## Switching storage later

The UI only talks to `DataService` (`getDesigns`, `addDesign`, `updateDesign`, `deleteDesign`, `getWeeklySummary`).
To move to PostgreSQL, a REST API or Excel, add an adapter class in `js/data-service.js` with
`load`, `add`, `update`, `remove` and optionally `subscribe`, then select it in the boot section of `js/ui.js`.
A commented `RestApiAdapter` example is included. The n8n API can also be pointed at Postgres by replacing
the two Google Sheets nodes with Postgres nodes; the dashboard doesn't change.
