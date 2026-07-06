import crypto from 'crypto';

// Logs each YVY visit as one row in a Google Sheet, updated in place as the
// visit progresses (scheduled -> completed). Uses a Google Cloud service
// account (JWT bearer flow) rather than the googleapis package, to keep this
// dependency-free like the rest of the app.
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

const HEADERS = [
  'Visit ID', 'Status', 'Patient Name', 'Date of Birth', 'Phone', 'Language',
  'Lead Entity', 'Address', 'Insurance Carrier', 'Insurance Member ID',
  'Appointment Date', 'Appointment Time', 'Intake Source', 'Provider', 'Completed At'
];

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

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Google token request failed (HTTP ${res.status}): ${JSON.stringify(body)}`);
  return body.access_token;
}

function tabRange(a1) {
  const tab = (process.env.GOOGLE_SHEETS_TAB || 'Sheet1').replace(/'/g, "''");
  return `'${tab}'!${a1}`;
}

async function sheetsFetch(path, opts = {}) {
  const token = await getAccessToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_SPREADSHEET_ID}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Sheets API error (HTTP ${res.status}): ${JSON.stringify(body)}`);
  return body;
}

async function ensureHeaderRow() {
  const data = await sheetsFetch(`/values/${encodeURIComponent(tabRange('A1:O1'))}`);
  const firstRow = data.values && data.values[0];
  if (!firstRow || firstRow.length === 0) {
    await sheetsFetch(`/values/${encodeURIComponent(tabRange('A1'))}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [HEADERS] })
    });
  }
}

async function findRowById(id) {
  const data = await sheetsFetch(`/values/${encodeURIComponent(tabRange('A:A'))}`);
  const col = data.values || [];
  for (let i = 0; i < col.length; i++) {
    if (col[i][0] === id) return i + 1; // 1-indexed row number
  }
  return null;
}

function fmtDateVal(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (iso || '');
}
function fmtTimeVal(hhmm) {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function buildRow(record) {
  const s = record.submission || {};
  const c = record.completion || {};
  const statusLabel = record.status === 'completed' ? 'Completed' : record.status === 'scheduled' ? 'Scheduled' : 'Sent';
  const address = s.address ? `${s.address}, ${s.city}, ${s.state} ${s.zip}` : '';
  return [
    record.id,
    statusLabel,
    `${record.firstName} ${record.lastName}`,
    fmtDateVal(record.dob),
    s.phone || '',
    record.language === 'es' ? 'Spanish' : 'English',
    record.leadEntity || '',
    address,
    s.insuranceCarrier || '',
    s.insuranceMemberId || '',
    fmtDateVal(s.visitDate),
    fmtTimeVal(s.visitTime),
    s.source === 'staff' ? 'YVY Staff' : 'Patient',
    c.provider || '',
    c.completedAt ? new Date(c.completedAt).toLocaleString() : ''
  ];
}

// Writes (or updates) the one row for this visit. Safe to call at any stage —
// looks up the existing row by Visit ID and overwrites it, or appends a new
// one if it's not there yet. Never throws.
export async function syncVisitRow(record) {
  if (!configured()) return false;
  try {
    await ensureHeaderRow();
    const row = buildRow(record);
    const rowNum = await findRowById(record.id);
    if (rowNum) {
      await sheetsFetch(`/values/${encodeURIComponent(tabRange(`A${rowNum}:O${rowNum}`))}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: [row] })
      });
    } else {
      await sheetsFetch(`/values/${encodeURIComponent(tabRange('A:O'))}:append?valueInputOption=RAW`, {
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
