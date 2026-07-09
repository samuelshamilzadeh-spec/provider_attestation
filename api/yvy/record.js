import { loadRecordByToken, publicRecord, saveRecord, siteOrigin } from '../../lib/store.js';
import { syncVisitRow } from '../../lib/sheets.js';

// Fetches a visit record by role token. The link token is the access key AND it
// is bound to exactly one role — a patient token can only ever load the patient
// view, never the clinician (visit) or documents (docs) view.
const ROLES = new Set(['patient', 'visit', 'docs']);

// Bounds a best-effort side task so a slow sheet sync can't hang the page load.
function bestEffort(promise, ms, label) {
  return Promise.race([
    Promise.resolve().then(() => promise).catch(err => console.error(`${label} failed:`, err && err.message)),
    new Promise(res => setTimeout(res, ms))
  ]);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const role = String(req.query.role || '');
  if (!ROLES.has(role)) return res.status(400).json({ error: 'Invalid role' });

  try {
    const record = await loadRecordByToken(req.query.t, role);
    if (!record) return res.status(404).json({ error: 'Not found' });

    // Stamp the first time the office opens the clinician (visit) link. This is
    // the "Complete Attestation" button in the office notification email — so a
    // row that has been opened but never completed flags a visit that happened
    // but was never signed. Best-effort: never let it fail or slow the load.
    if (role === 'visit' && !record.openedAt) {
      record.openedAt = new Date().toISOString();
      try {
        await saveRecord(record);
        await bestEffort(syncVisitRow(record, siteOrigin(req)), 6500, 'openedAt sync');
      } catch (err) {
        console.error('Failed to record visit open:', err.message);
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(publicRecord(record, role));
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
