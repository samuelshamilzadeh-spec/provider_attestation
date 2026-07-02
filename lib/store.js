import { put, head } from '@vercel/blob';

// Visit records live in Vercel Blob as JSON, keyed by an unguessable UUID.
// The UUID in the link is the only access control — same posture as the
// existing pre-filled attestation links.
const recordPath = (id) => `yvy/records/${id}.json`;

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
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
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
