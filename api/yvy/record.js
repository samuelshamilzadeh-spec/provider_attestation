import { loadRecord } from '../../lib/store.js';

// Fetches a visit record by id. The unguessable UUID in the link is the
// access token — used by the patient, visit, and docs pages.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const record = await loadRecord(req.query.id);
    if (!record) return res.status(404).json({ error: 'Visit not found' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(record);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
