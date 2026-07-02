import { loadRecordByToken, downloadBlob } from '../../lib/store.js';

// Streams a stored card photo or completed PDF through the app, gated by the
// same role token as everything else. The underlying blob URL is never sent to
// the browser or put in an email — the only way to reach these files is with a
// valid visit (clinician) or docs (Yeled V'Yalda) token. Patients only upload
// files, never view them, so the patient role is not accepted here.
const ROLES = new Set(['visit', 'docs']);
const WHICH = { cardFront: 'image/jpeg', cardBack: 'image/jpeg', pdf: 'application/pdf' };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const role = String(req.query.role || '');
  const which = String(req.query.which || '');
  if (!ROLES.has(role)) return res.status(403).json({ error: 'Forbidden' });
  if (!WHICH[which]) return res.status(400).json({ error: 'Invalid file' });

  try {
    const record = await loadRecordByToken(req.query.t, role);
    if (!record) return res.status(404).json({ error: 'Not found' });

    const s = record.submission || {};
    const c = record.completion || {};
    const url = which === 'cardFront' ? s.cardFrontUrl
              : which === 'cardBack'  ? s.cardBackUrl
              : c.pdfUrl;
    if (!url) return res.status(404).json({ error: 'Not found' });

    const file = await downloadBlob(url);
    if (!file) return res.status(502).json({ error: 'Upstream error' });

    res.setHeader('Content-Type', file.contentType || WHICH[which]);
    res.setHeader('Cache-Control', 'private, no-store');
    if (which === 'pdf') {
      const name = `${record.firstName}_${record.lastName}`.replace(/[^A-Za-z0-9_-]+/g, '_') || 'attestation';
      res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
    }
    res.statusCode = 200;
    return res.end(file.buf);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
