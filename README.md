# provider_attestation

NYS SCN Provider Attestation forms for Premier Assist. Two flows share one
codebase, one PDF template (`templates/attestation_template.pdf`), and one
Vercel deployment.

## Flow 1 — Stand Out Care (existing)

1. Patient / Stand Out Care office schedules through Jotform.
2. Office receives a pre-filled link: `/?patientFull=…&patientDate=…&medicaidId=…`
3. Clinician completes criteria + provider + signature at `/` (index.html).
4. `/api/submit` dispatches the `generate-attestation.yml` GitHub Action,
   which fills the PDF and emails it (SMTP secrets live in GitHub).

If the member doesn't qualify, the clinician takes the **does-not-qualify**
path instead (see below) — `/api/disqualify` emails the office and no Action is
dispatched.

## Flow 2 — Yeled V'Yalda (parent company)

1. **Staff intake — `/yvy/intake`** — two modes:
   - **Send link to patient** — YVY staff enters patient first/last name, DOB,
     visit language (English/Spanish), and the **SCN Lead Entity** printed on
     the attestation header (list in `yvy/config.js`), plus an optional patient
     email. The patient gets a personal link (emailed if an address was given,
     always shown for copy/paste) and fills in their own details (stage 2).
   - **Schedule for patient** — for when YVY staff schedules on the patient's
     behalf. Staff fills the same patient details themselves — address,
     insurance carrier + member ID, relationship, and the visit slot (same
     language-gated Mon–Fri windows) — **minus the insurance-card photos (the
     HIPAA-release step, not collected in this mode)**. The visit skips stage 2
     entirely, goes straight to `scheduled`, and the Premier office is notified
     immediately (same email + Teams card as a patient submission, flagged
     "Entered by YVY staff").
2. **Patient form — `/yvy/patient?t=<patientToken>`** (send-link mode only)
   Name + DOB are shown for confirmation. Patient adds home address, insurance
   carrier + member ID, uploads front/back photos of the insurance card
   (compressed client-side), selects their relationship to the patient, and
   picks a visit slot. Slots are Mon–Fri and auto-gated by language:
   English 9:30 AM–5:00 PM, Spanish 9:30 AM–8:00 PM (30-minute slots).
   Spanish visits render the whole form in Spanish.
3. **Office notification** — on patient submit, the office gets a branded email
   (`OFFICE_EMAIL`) and a Teams card (`TEAMS_WEBHOOK_URL`) with a button to the
   clinician visit form.
4. **Clinician visit — `/yvy/visit?t=<visitToken>`**
   Shows the patient's info + card photos, then the standard criteria /
   provider / signature flow. The PDF is generated serverlessly with the
   chosen lead entity in the header on all pages.
5. **Completion** — the signed PDF is stored and Yeled V'Yalda (`YVY_EMAIL`)
   receives an email linking to `/yvy/docs?t=<docsToken>` (PDF + card images).
6. **Google Sheets log** — each visit is written as one row (`lib/sheets.js`)
   in a Google Sheet, updated in place as it progresses: appended when
   scheduled (by patient or staff), updated with provider + completion time
   once the clinician finishes. Best-effort — a Sheets outage never blocks a
   visit from being scheduled or completed.

## Patient does not qualify (both flows)

Not every visit ends in an attestation. Both clinician forms carry the same
escape hatch, driven by one shared prompt (`/disqualify.js`) so they ask for
exactly the same things:

- **Explicit** — a *"This patient does not qualify"* button sits under the
  criteria list on the criteria step.
- **Detected** — pressing *Next: Provider & sign* (or *Submit*) with **zero**
  criteria checked opens the same prompt first: *Go back and review* or
  *Patient does not qualify*. An attestation can no longer be signed with an
  empty criteria list, which the forms previously allowed.

Either path opens one dialog asking for **provider**, **exam date** (prefilled with
the scheduled visit date, or today on the Stand Out form), a **reason** from a
fixed list, and optional **notes** (required for *Other*). No signature is
collected and **no PDF is generated** — nothing is being attested to.

The reason list lives in `lib/disqualify.js` (server, authoritative) and is
mirrored in `/disqualify.js` for display; the server always re-resolves the
submitted code to its own label.

| | Stand Out Care | Yeled V'Yalda |
| --- | --- | --- |
| Endpoint | `/api/disqualify` | `/api/yvy/disqualify` |
| Emails | `STANDOUT_EMAIL` | `OFFICE_EMAIL` + `YVY_EMAIL` |
| Override | — | `DISQUALIFIED_EMAIL` |
| Teams | yes (`TEAMS_WEBHOOK_URL`) | yes |
| Stored | nothing (no record in this flow) | visit → `not_qualified` |
| Sheet row | — | status `Not Qualified` + reason |

The email carries patient name, DOB, exam date, provider, reason and notes —
but deliberately **no link**, since it reaches Yeled V'Yalda and the clinician
visit token must never leave the office's inbox.

### Where each flow's mail goes

The two flows are kept apart on purpose: **nothing from Stand Out Care reaches
Yeled V'Yalda**. Stand Out's two emails are configured in two different systems,
because they are sent by two different things:

| Stand Out Care email | Sent by | Set in |
| --- | --- | --- |
| Signed attestation (PDF attached) | `generate-attestation.yml` Action | `RECIPIENT_EMAIL` — **GitHub Actions secret** |
| Patient did not qualify | `/api/disqualify` | `STANDOUT_EMAIL` — **Vercel env var** |

To send both to one inbox, set **both** values to that address. They can't be
collapsed into one: the Action deliberately reads its recipient from a GitHub
secret rather than from the dispatch payload, because `/api/submit` is a public
endpoint — taking the address from the request would let anyone have a signed
attestation PDF mailed anywhere.

`STANDOUT_EMAIL` falls back to `OFFICE_EMAIL` when unset, so an existing deploy
keeps delivering; set it to stop Stand Out mail landing in the YVY-side inbox.

**Reversibility.** Marking a YVY visit not-qualified is undoable: the visit
link keeps working and shows a banner naming who marked it, when, and why.
Any later outcome supersedes it (`supersedeDisqualification()`) — completing
the attestation, or the patient re-booking through their own still-valid link
after a no-show. The flag is cleared, the previous one is kept under
`priorDisqualifications` for audit, and the row reads `Completed` /
`Scheduled` with no stale reason beside it. The reverse is blocked: once an
attestation is **signed**, the button is hidden and the endpoint returns `409`
— voiding a signed legal document is an office matter, not a web-form one.

If the notification email fails, the YVY outcome is still saved and the success
screen says the email didn't go out. The Stand Out flow has no record to fall
back on, so a send failure returns `502` and the provider can retry.

### Links & access control

Each visit issues **three independent, unguessable role tokens** — never the
same value, and one cannot be derived from another:

| Role | Link | Delivered via |
| --- | --- | --- |
| Patient | `/yvy/patient?t=<patientToken>` | intake screen / patient invite email |
| Clinician | `/yvy/visit?t=<visitToken>` | office email + Teams card **only** |
| Yeled V'Yalda | `/yvy/docs?t=<docsToken>` | completion email **only** |

`/api/yvy/record` requires a `role` and only returns a record when the token
was issued for that exact role, so a patient link **cannot** be edited into the
clinician link. The `complete` endpoint (which generates the signed PDF) accepts
only the visit token — a patient can never self-attest. Tokens and the internal
record id are never serialized to the browser.

### Storage

Records, card photos, and completed PDFs are stored in Vercel Blob.
Records live at `yvy/records/<internalId>.json` (statuses
`sent → scheduled → completed`, or `not_qualified` when the clinician records
that the patient doesn't qualify); each token maps to its record + role via a
tiny index blob at `yvy/tok/<token>.json`.

### Environment variables (Vercel project)

| Var | Purpose |
| --- | --- |
| `GH_REPO`, `GH_PAT` | existing — Stand Out flow Action dispatch |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (auto-set when a Blob store is connected) |
| `SMTP_USER`, `SMTP_PASS` | Gmail SMTP (same creds as the GitHub Action secrets) |
| `OFFICE_EMAIL` | office inbox for new-visit notifications (YVY flow) |
| `YVY_EMAIL` | Yeled V'Yalda inbox for completed-attestation notifications |
| `STANDOUT_EMAIL` | Stand Out Care inbox for "did not qualify" notices (falls back to `OFFICE_EMAIL`). Match it with the `RECIPIENT_EMAIL` GitHub secret to route both Stand Out emails to one address |
| `DISQUALIFIED_EMAIL` | optional — overrides the recipients for the **YVY** "did not qualify" notice |
| `TEAMS_WEBHOOK_URL` | optional — Teams incoming webhook / Workflows URL |
| `GOOGLE_SHEETS_CLIENT_EMAIL` | service account email (`…@…iam.gserviceaccount.com`) |
| `GOOGLE_SHEETS_PRIVATE_KEY` | service account private key (PEM, with `\n`s) |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | target spreadsheet ID (from its URL) |
| `GOOGLE_SHEETS_TAB` | tab name to write to (defaults to `Sheet1`) |

### Configuration to review before go-live

- **Lead entity names** — edit `window.YVY_LEAD_ENTITIES` in `yvy/config.js`
  (exact spellings appear on the legal form header).
- **Does-not-qualify reasons** — `DISQUALIFY_REASONS` in `lib/disqualify.js`;
  mirror any edit in the `REASONS` array at the top of `/disqualify.js`.
- The Google Sheet gained two columns (`Not Qualified At`, `Not Qualified
  Reason`) appended after `Link Opened At`. `Visit ID` stays in column W, so
  existing rows still match; the header row is rewritten automatically on the
  next sync.
- **Visit hours / slot length** — `yvy/config.js` (client) must match
  `WINDOW` / `SLOT_MINUTES` in `api/yvy/patient-submit.js` (server).
- Providers + facility info — `lib/attestation_pdf.js`.
