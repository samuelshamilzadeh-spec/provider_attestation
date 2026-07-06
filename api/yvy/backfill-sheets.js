import { assertBlobConfigured, listRecords } from '../../lib/store.js';
import { syncVisitRow } from '../../lib/sheets.js';

// One-off maintenance tool: pushes every existing visit record into the
// Google Sheet. Needed because some visits were created before the Sheets
// integration (or before its credentials were working) and so were never
// synced. Safe to run more than once — syncVisitRow() is an upsert keyed by
// visit ID, so re-running this just re-writes the same rows.
//
// Gated by a query param matching GOOGLE_SHEETS_SPREADSHEET_ID (something only
// someone with Vercel dashboard access would know) rather than a dedicated
// secret, so it needs no extra setup. The response never includes patient
// details — only internal visit IDs and pass/fail counts.
//
// Meant to be deleted (or left — it's idempotent and harmless) once the
// backfill has been run.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const expected = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!expected || req.query.confirm !== expected) {
    return res.status(403).json({ error: 'Missing or incorrect ?confirm=<spreadsheet ID>' });
  }

  try {
    assertBlobConfigured();
    const records = await listRecords();
    const results = [];
    for (const record of records) {
      const ok = await syncVisitRow(record);
      results.push({ id: record.id, status: record.status, synced: ok });
    }
    const synced = results.filter(r => r.synced).length;
    return res.status(200).json({ total: results.length, synced, failed: results.length - synced, results });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
