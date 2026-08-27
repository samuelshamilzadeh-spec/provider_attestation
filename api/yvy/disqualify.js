import { assertBlobConfigured, loadRecordByToken, saveRecord, siteOrigin } from '../../lib/store.js';
import { parseDisqualification, notifyDisqualification } from '../../lib/disqualify.js';
import { syncVisitRow } from '../../lib/sheets.js';
import { fmtTime } from '../../lib/visit.js';

// Bounds a best-effort side task so a slow integration can never delay the
// provider's confirmation.
function bestEffort(promise, ms, label) {
  return Promise.race([
    Promise.resolve().then(() => promise).catch(err => console.error(`${label} failed:`, err && err.message)),
    new Promise(res => setTimeout(res, ms))
  ]);
}

// Yeled V'Yalda flow: the clinician determined the patient does not qualify.
// Marks the visit `not_qualified`, notifies the office + Yeled V'Yalda, and
// updates the visit's Google Sheet row. No PDF is generated.
//
// Requires the VISIT token — a patient token is rejected by loadRecordByToken,
// so a patient can never mark their own visit.
//
// The visit link deliberately stays usable afterwards: a misclick is undone by
// simply completing the attestation, which supersedes this (see complete.js).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }

  const parsed = parseDisqualification(body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    assertBlobConfigured();

    const record = await loadRecordByToken(body && body.t, 'visit');
    if (!record) return res.status(404).json({ error: 'Visit not found' });

    // A signed attestation is a legal document — it can't be walked back
    // through this form. Voiding one is an office/manual matter.
    if (record.status === 'completed') {
      return res.status(409).json({
        error: 'This attestation has already been completed and signed. Contact the office to have it voided.'
      });
    }

    const s = record.submission || {};
    const patientName = `${record.firstName} ${record.lastName}`;
    // Prefer the date the provider entered; fall back to the scheduled slot.
    const examDate = parsed.examDate || s.visitDate || '';
    const examTime = (!parsed.examDate || parsed.examDate === s.visitDate) && s.visitTime
      ? fmtTime(s.visitTime)
      : '';

    record.status = 'not_qualified';
    record.disqualification = {
      at: new Date().toISOString(),
      provider: parsed.provider,
      examDate,
      reasonCode: parsed.reasonCode,
      reasonLabel: parsed.reasonLabel,
      notes: parsed.notes
    };
    // Persist before notifying: the provider's decision must survive even if
    // the mail server is down.
    await saveRecord(record);

    let emailed = true;
    try {
      await notifyDisqualification({
        flow: 'yvy',
        patientName,
        patientDob: record.dob,
        examDate,
        examTime,
        provider: parsed.provider,
        reasonLabel: parsed.reasonLabel,
        notes: parsed.notes,
        leadEntity: record.leadEntity,
        intakeSource: s.source === 'staff' ? "Entered by Yeled V'Yalda staff" : 'Submitted by patient'
      });
    } catch (err) {
      // The record is already saved, so don't fail the request and risk the
      // provider re-submitting — report it and let the page say so.
      console.error('Disqualification notification failed:', err.message);
      emailed = false;
    }

    await bestEffort(syncVisitRow(record, siteOrigin(req)), 6500, 'disqualify sheet sync');

    return res.status(200).json({ success: true, emailed });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
