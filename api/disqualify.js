import { parseDisqualification, notifyDisqualification } from '../lib/disqualify.js';

// Stand Out Care flow: the clinician determined the patient does not qualify,
// so there is nothing to attest to. Unlike /api/submit this dispatches no
// GitHub Action and produces no PDF — it only notifies the office.
//
// There is no stored record in this flow, so the email is the entire outcome:
// it is awaited, and a send failure is reported so the provider can retry.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }
  const { memberName, firstName, lastName, dob } = body || {};

  const patientName = String(memberName || `${firstName || ''} ${lastName || ''}`).trim();
  if (!patientName) return res.status(400).json({ error: 'Patient name is required.' });

  const parsed = parseDisqualification(body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    await notifyDisqualification({
      flow: 'standout',
      patientName,
      patientDob: dob || '',
      examDate: parsed.examDate,
      provider: parsed.provider,
      reasonLabel: parsed.reasonLabel,
      notes: parsed.notes
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Disqualification notification failed:', err.message);
    return res.status(502).json({ error: `Could not send the notification email: ${err.message}` });
  }
}
