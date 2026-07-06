import { put, get, list } from '@vercel/blob';

// Visit records live in Vercel Blob as JSON, keyed by an internal UUID that
// never appears in any link. Each record has three independent, unguessable
// role tokens (patient / visit / docs). A tiny index blob maps each token back
// to its record + role, so knowing one link can never reveal the others — a
// patient's link cannot be edited into the clinician's link.
//
// The store is PRIVATE: every put()/get() uses access: 'private', so nothing
// here is reachable by a bare blob URL. Reads go through the SDK's get(),
// which is authenticated with the Blob token — never a raw, unauthenticated
// fetch().
const recordPath = (id) => `yvy/records/${id}.json`;
const tokenPath  = (tok) => `yvy/tok/${tok}.json`;

const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s || ''));

// All PHI (records, insurance-card photos, PDFs) is written to the PRIVATE Blob
// store. Prefer PRIVATE_BLOB_READ_WRITE_TOKEN so the private store is targeted
// explicitly, independent of the auto-managed BLOB_READ_WRITE_TOKEN (which may
// be tied to the public/logo store). Falls back to BLOB_READ_WRITE_TOKEN if the
// project only has one store.
const blobToken = () => process.env.PRIVATE_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;

export function assertBlobConfigured() {
  if (!blobToken()) {
    throw new Error('Server is missing the Blob token (PRIVATE_BLOB_READ_WRITE_TOKEN or BLOB_READ_WRITE_TOKEN)');
  }
}

// Reads and JSON-parses a private text blob by pathname or URL. Returns null
// if it doesn't exist.
async function getJson(urlOrPathname) {
  const result = await get(urlOrPathname, { access: 'private', token: blobToken() });
  if (!result || !result.stream) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

export async function saveRecord(record) {
  await put(recordPath(record.id), JSON.stringify(record, null, 2), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
    token: blobToken()
  });
}

export async function loadRecord(id) {
  if (!isUuid(id)) return null;
  try {
    return await getJson(recordPath(id));
  } catch {
    return null; // not found
  }
}

// Enumerates every stored visit record. Used for one-off admin/maintenance
// tasks (e.g. backfilling a downstream integration added after some visits
// already existed) — not part of the normal request flow.
export async function listRecords() {
  const records = [];
  let cursor;
  do {
    const page = await list({ prefix: 'yvy/records/', cursor, token: blobToken() });
    for (const blob of page.blobs) {
      const record = await getJson(blob.url).catch(() => null);
      if (record) records.push(record);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return records;
}

// Writes the token → {id, role} index blob. Tokens are immutable once issued.
export async function saveTokenIndex(token, id, role) {
  await put(tokenPath(token), JSON.stringify({ id, role }), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 31536000,
    token: blobToken()
  });
}

// Resolves a link token to its record, but ONLY if the token was issued for the
// expected role. Returns null on any mismatch — this is the access gate.
export async function loadRecordByToken(token, expectedRole) {
  if (!isUuid(token)) return null;
  let idx;
  try {
    idx = await getJson(tokenPath(token));
  } catch {
    return null; // unknown token
  }
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
// returns its private blob URL. Only ever read back via get() (see
// api/yvy/file.js) — never a public, directly-fetchable link.
export async function uploadDataUrl(pathname, dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Invalid file data');
  const buf = Buffer.from(m[2], 'base64');
  const { url } = await put(pathname, buf, {
    access: 'private',
    addRandomSuffix: true,
    contentType: m[1],
    token: blobToken()
  });
  return url;
}

export async function uploadBuffer(pathname, buf, contentType) {
  const { url } = await put(pathname, buf, {
    access: 'private',
    addRandomSuffix: true,
    contentType,
    token: blobToken()
  });
  return url;
}

// Reads back a private binary blob (card photo / PDF) as a Buffer, given the
// URL stored on the record. Used by api/yvy/file.js to stream it to a client
// that has already proven it holds a valid role token.
export async function downloadBlob(url) {
  const result = await get(url, { access: 'private', token: blobToken() });
  if (!result || !result.stream) return null;
  const buf = Buffer.from(await new Response(result.stream).arrayBuffer());
  return { buf, contentType: result.blob.contentType };
}

// Derives the public site origin from the request (works on any Vercel deploy
// URL or custom domain without extra configuration).
export function siteOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}
