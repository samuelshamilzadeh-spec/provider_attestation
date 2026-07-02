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

## Flow 2 — Yeled V'Yalda (parent company)

1. **Staff intake — `/yvy/intake`**
   YVY staff enters patient first/last name, DOB, visit language
   (English/Spanish), and picks the **SCN Lead Entity** printed on the
   attestation header (list lives in `yvy/config.js`). Optionally enters the
   patient's email — if provided, the personal link is emailed automatically;
   either way the link is shown for copy/paste.
2. **Patient form — `/yvy/patient?t=<patientToken>`**
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
`sent → scheduled → completed`); each token maps to its record + role via a
tiny index blob at `yvy/tok/<token>.json`.

### Environment variables (Vercel project)

| Var | Purpose |
| --- | --- |
| `GH_REPO`, `GH_PAT` | existing — Stand Out flow Action dispatch |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (auto-set when a Blob store is connected) |
| `SMTP_USER`, `SMTP_PASS` | Gmail SMTP (same creds as the GitHub Action secrets) |
| `OFFICE_EMAIL` | office inbox for new-visit notifications |
| `YVY_EMAIL` | Yeled V'Yalda inbox for completed-attestation notifications |
| `TEAMS_WEBHOOK_URL` | optional — Teams incoming webhook / Workflows URL |

### Configuration to review before go-live

- **Lead entity names** — edit `window.YVY_LEAD_ENTITIES` in `yvy/config.js`
  (exact spellings appear on the legal form header).
- **Visit hours / slot length** — `yvy/config.js` (client) must match
  `WINDOW` / `SLOT_MINUTES` in `api/yvy/patient-submit.js` (server).
- Providers + facility info — `lib/attestation_pdf.js`.
