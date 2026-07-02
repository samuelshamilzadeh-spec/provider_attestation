import { loadRecordByToken, publicRecord } from '../../lib/store.js';

// Fetches a visit record by role token. The link token is the access key AND it
// is bound to exactly one role — a patient token can only ever load the patient
// view, never the clinician (visit) or documents (docs) view.
const ROLES = new Set(['patient', 'visit', 'docs']);

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
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(publicRecord(record, role));
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
