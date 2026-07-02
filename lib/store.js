import { put, head } from '@vercel/blob';

// Visit records live in Vercel Blob as JSON, keyed by an internal UUID that
// never appears in any link. Each record has three independent, unguessable
// role tokens (patient / visit / docs). A tiny index blob maps each token back
// to its record + role, so knowing one link can never reveal the others — a
// patient's link cannot be edited into the clinician's link.
const recordPath = (id) => `yvy/records/${id}.json`;
const tokenPath  = (tok) => `yvy/tok/${tok}.json`;

const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s || ''));

export function assertBlobConfigured() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('Server is missing BLOB_READ_WRITE_TOKEN');
  }
}

export async function saveRecord(record) {
  await put(recordPath(record.id), JSON.stringify(record, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60
  });
}

export async function loadRecord(id) {
  if (!isUuid(id)) return null;
  let meta;
  try {
    meta = await head(recordPath(id));
  } catch {
    return null; // not found
  }
  // Unique query param busts the CDN cache so we always read the latest write.
  const res = await fetch(`${meta.url}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

// Writes the token → {id, role} index blob. Tokens are immutable once issued.
export async function saveTokenIndex(token, id, role) {
  await put(tokenPath(token), JSON.stringify({ id, role }), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 31536000
  });
}

// Resolves a link token to its record, but ONLY if the token was issued for the
// expected role. Returns null on any mismatch — this is the access gate.
export async function loadRecordByToken(token, expectedRole) {
  if (!isUuid(token)) return null;
  let meta;
  try {
    meta = await head(tokenPath(token));
  } catch {
    return null; // unknown token
  }
  const res = await fetch(meta.url, { cache: 'no-store' });
  if (!res.ok) return null;
  const idx = await res.json();
  if (!idx || idx.role !== expectedRole) return null;
  return loadRecord(idx.id);
}

// Strips the raw blob URLs out of the submission/completion the browser sees,
// leaving only booleans that say whether each file exists. The files are then
// fetched through /api/yvy/file (role-token gated), never by direct URL.
function sanitizeSubmission(s) {
  if (!s) return null;
  const { cardFrontUrl, cardBackUrl, ...rest } = s;
  return { ...rest, cardFront: !!cardFrontUrl, cardBack: !!cardBackUrl };
}
function sanitizeCompletion(c) {
  if (!c) return null;
  const { pdfUrl, ...rest } = c;
  return { ...rest, pdf: !!pdfUrl };
}

// Whitelists the fields returned to the browser for a given role. Tokens, the
// internal id, and raw blob URLs are NEVER serialized to a client.
export function publicRecord(record, role) {
  if (!record) return null;
  const base = {
    status: record.status,
    firstName: record.firstName,
    lastName: record.lastName,
    dob: record.dob,
    language: record.language
  };
  // The patient page only needs to confirm who the form is for.
  if (role === 'patient') return base;
  // Clinician (visit) and Yeled V'Yalda (docs) see the full working record,
  // minus the raw file URLs.
  return {
    ...base,
    leadEntity: record.leadEntity,
    createdAt: record.createdAt,
    submission: sanitizeSubmission(record.submission),
    completion: sanitizeCompletion(record.completion)
  };
}

// Uploads a binary asset (card photo / completed PDF) from a data URL and
// returns its public blob URL. Random suffix keeps the URL unguessable.
export async function uploadDataUrl(pathname, dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Invalid file data');
  const buf = Buffer.from(m[2], 'base64');
  const { url } = await put(pathname, buf, {
    access: 'public',
    addRandomSuffix: true,
    contentType: m[1]
  });
  return url;
}

export async function uploadBuffer(pathname, buf, contentType) {
  const { url } = await put(pathname, buf, {
    access: 'public',
    addRandomSuffix: true,
    contentType
  });
  return url;
}

// Derives the public site origin from the request (works on any Vercel deploy
// URL or custom domain without extra configuration).
export function siteOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}
