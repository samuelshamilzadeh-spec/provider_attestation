import crypto from 'crypto';

// Logs each YVY visit as one row in a Google Sheet, updated in place as the
// visit progresses (sent -> scheduled -> completed). Uses a Google Cloud
// service account (JWT bearer flow) rather than the googleapis package, to
// keep this dependency-free like the rest of the app.
//
// Env vars (Vercel project settings):
//   GOOGLE_SHEETS_CLIENT_EMAIL     — service account email (…@…iam.gserviceaccount.com)
//   GOOGLE_SHEETS_PRIVATE_KEY      — the service account's private key (PEM, with \n's)
//   GOOGLE_SHEETS_SPREADSHEET_ID   — the target spreadsheet's ID (from its URL)
//   GOOGLE_SHEETS_TAB              — the tab name to write to (defaults to 'Sheet1')
//
// Best-effort: every function here swallows its own errors and returns without
// throwing — a Sheets outage or misconfiguration must never block a visit from
// being scheduled or completed.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// Visit ID is deliberately the LAST column (it's an internal matching key,
// not something staff need to look at) — findRowById() below reads from
// ID_COL, which must always point at wherever it ends up in this list.
const HEADERS = [
  'Completed At', 'Status', 'Appointment Date', 'Appointment Time',
  'Last Name', 'First Name', 'Date of Birth', 'Street Address', 'City', 'State', 'ZIP',
  'Phone', 'Insurance Carrier', 'Insurance Member ID',
  'Email', 'Language', 'Lead Entity', 'Card Front', 'Card Back', 'Intake Source',
  'Provider', 'Scheduled At', 'Visit ID'
];
const LAST_COL = 'W'; // must match HEADERS.length (23 columns, A..W)
const ID_COL = 'W';   // Visit ID's column — keep in sync with its position above

function configured() {
  return !!(process.env.GOOGLE_SHEETS_CLIENT_EMAIL && process.env.GOOGLE_SHEETS_PRIVATE_KEY && process.env.GOOGLE_SHEETS_SPREADSHEET_ID);
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Vercel's env var UI (and copy/pasting the JSON key file's value directly)
// commonly mangles a multi-line PEM key: literal `\n` instead of real
// newlines, or the whole `"private_key": "...pem...",` JSON line pasted
// verbatim (field name, colon, and quotes included, not just the value).
// Rather than guess which exact wrapping characters to strip, extract the PEM
// block by its own -----BEGIN/-----END markers — bulletproof against any
// surrounding text.
function normalizePrivateKey(raw) {
  let key = String(raw || '').replace(/\\n/g, '\n').replace(/\r\n/g, '\n');

  const beginIdx = key.indexOf('-----BEGIN');
  if (beginIdx === -1) return key.trim();
  const endLabelIdx = key.indexOf('-----END', beginIdx);
  let endIdx = key.length;
  if (endLabelIdx !== -1) {
    const closingDashes = key.indexOf('-----', endLabelIdx + '-----END'.length);
    endIdx = closingDashes !== -1 ? closingDashes + 5 : key.length;
  }
  return key.slice(beginIdx, endIdx).trim() + '\n';
}

// Structural fingerprint of the key for diagnostics — reveals shape (length,
// whether newlines/markers are intact), never any actual key material.
function keyFingerprint(raw) {
  const s = String(raw || '');
  const trimmed = s.trim();
  return {
    length: s.length,
    wrappedInQuotes: /^["'].*["']$/s.test(trimmed),
    literalBackslashN_count: (s.match(/\\n/g) || []).length,
    realNewline_count: (s.match(/\n/g) || []).length,
    hasCarriageReturn: s.includes('\r'),
    hasBeginMarker: s.includes('BEGIN PRIVATE KEY'),
    hasEndMarker: s.includes('END PRIVATE KEY'),
    startsWith: JSON.stringify(trimmed.slice(0, 15)),
    endsWith: JSON.stringify(trimmed.slice(-15))
  };
}

// Exchanges the service account's key for a short-lived OAuth access token
// (JWT bearer flow — no user interaction, no googleapis dependency).
async function getAccessToken() {
  const email = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  const key = normalizePrivateKey(rawKey);
  if (!key.includes('BEGIN PRIVATE KEY')) {
    throw new Error(`GOOGLE_SHEETS_PRIVATE_KEY does not look like a valid PEM key after normalizing. Diagnostic: ${JSON.stringify(keyFingerprint(rawKey))}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  let signature;
  try {
    signature = signer.sign(key, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch (err) {
    throw new Error(`Failed to sign JWT with GOOGLE_SHEETS_PRIVATE_KEY: ${err.message}. Diagnostic: ${JSON.stringify(keyFingerprint(rawKey))}`);
  }
  const jwt = `${unsigned}.${signature}`;

  const res = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Google token request failed (HTTP ${res.status}): ${JSON.stringify(body)}`);
  return body.access_token;
}

// fetch with a hard timeout — a hung Google request must never keep the whole
// serverless function alive until the platform kills it (which surfaces to the
// user as a non-JSON "Invalid server response").
async function fetchWithTimeout(url, opts = {}, ms = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function tabRange(a1) {
  const tab = (process.env.GOOGLE_SHEETS_TAB || 'Sheet1').replace(/'/g, "''");
  return `'${tab}'!${a1}`;
}

async function sheetsFetch(path, opts = {}) {
  const token = await getAccessToken();
  const res = await fetchWithTimeout(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_SPREADSHEET_ID}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Sheets API error (HTTP ${res.status}): ${JSON.stringify(body)}`);
  return body;
}

// Always (re)writes row 1 to the current canonical header. Cheap and
// idempotent, and guarantees the header can never drift out of sync with
// what buildRow() actually produces.
async function ensureHeaderRow() {
  await sheetsFetch(`/values/${encodeURIComponent(tabRange('A1'))}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [HEADERS] })
  });
}

async function findRowById(id) {
  const data = await sheetsFetch(`/values/${encodeURIComponent(tabRange(`${ID_COL}:${ID_COL}`))}`);
  const col = data.values || [];
  for (let i = 0; i < col.length; i++) {
    if (col[i][0] === id) return i + 1; // 1-indexed row number
  }
  return null;
}

function fmtDateVal(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  // Fallback for anything not in plain YYYY-MM-DD — parse and reformat rather
  // than passing through a raw value that wouldn't read as MM/DD/YYYY. Uses
  // UTC getters so a date-only string doesn't shift a day from local timezone.
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
}
function fmtTimeVal(hhmm) {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// Normalizes casing (some intake entries came in as ALL CAPS) —
// "MARIA GONZALEZ" -> "Maria Gonzalez", "MARY-JANE O'BRIEN" -> "Mary-Jane O'Brien",
// "123 MAIN ST" -> "123 Main St". Used for name, street address, and city.
function toTitleCase(s) {
  return String(s || '').trim().toLowerCase().split(' ').filter(Boolean).map(word =>
    word.split('-').map(part =>
      part.split("'").map(seg => seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : seg).join("'")
    ).join('-')
  ).join(' ');
}

function buildRow(record, origin) {
  const s = record.submission || {};
  const c = record.completion || {};
  const statusLabel = record.status === 'completed' ? 'Completed' : record.status === 'scheduled' ? 'Scheduled' : 'Sent';
  const cardLink = (which) => (origin && record.visitToken && s[`${which}Url`])
    ? `${origin}/api/yvy/file?role=visit&which=${which}&t=${record.visitToken}`
    : '';
  // Column order here MUST match HEADERS above exactly.
  return [
    c.completedAt ? new Date(c.completedAt).toLocaleString() : '',
    statusLabel,
    fmtDateVal(s.visitDate),
    fmtTimeVal(s.visitTime),
    toTitleCase(record.lastName),
    toTitleCase(record.firstName),
    fmtDateVal(record.dob),
    toTitleCase(s.address),
    toTitleCase(s.city),
    (s.state || '').toUpperCase(),
    s.zip || '',
    s.phone || '',
    s.insuranceCarrier || '',
    s.insuranceMemberId || '',
    record.patientEmail || '',
    record.language === 'es' ? 'Spanish' : 'English',
    record.leadEntity || '',
    cardLink('cardFront'),
    cardLink('cardBack'),
    s.source === 'staff' ? 'YVY Staff' : 'Patient',
    c.provider || '',
    s.submittedAt ? new Date(s.submittedAt).toLocaleString() : '',
    record.id
  ];
}

// Writes (or updates) the one row for this visit. Safe to call at any stage —
// looks up the existing row by Visit ID and overwrites it, or appends a new
// one if it's not there yet. `origin` (e.g. https://partners.premierassist.com,
// from lib/store.js's siteOrigin(req)) is needed to build the card-photo
// links; omit it and those two columns are just left blank. Never throws.
export async function syncVisitRow(record, origin) {
  if (!configured()) return false;
  try {
    await ensureHeaderRow();
    const row = buildRow(record, origin);
    const rowNum = await findRowById(record.id);
    if (rowNum) {
      await sheetsFetch(`/values/${encodeURIComponent(tabRange(`A${rowNum}:${LAST_COL}${rowNum}`))}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: [row] })
      });
    } else {
      await sheetsFetch(`/values/${encodeURIComponent(tabRange(`A:${LAST_COL}`))}:append?valueInputOption=RAW`, {
        method: 'POST',
        body: JSON.stringify({ values: [row] })
      });
    }
    return true;
  } catch (err) {
    console.error('Google Sheets sync failed:', err.message);
    return false;
  }
}
