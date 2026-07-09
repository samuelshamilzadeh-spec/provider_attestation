import { assertBlobConfigured, loadRecordByToken, saveRecord, uploadDataUrl, siteOrigin } from '../../lib/store.js';
import { validSlot, validPhone, notifyOffice } from '../../lib/visit.js';
import { syncVisitRow } from '../../lib/sheets.js';
import { sanitizePreScreen } from '../../lib/prescreen.js';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

// Patient submission: address + insurance + card photos + relationship +
// visit slot. Notifies the office (email + Teams) on success.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }
  const {
    t, phone, address, city, state, zip, insuranceCarrier, insuranceMemberId,
    relationship, fillerName, visitDate, visitTime, cardFront, cardBack, preScreen
  } = body || {};

  try {
    assertBlobConfigured();

    const record = await loadRecordByToken(t, 'patient');
    if (!record) return res.status(404).json({ error: 'Visit not found' });
    if (record.status === 'completed') return res.status(409).json({ error: 'This visit has already been completed.' });

    if (!validPhone(phone)) return res.status(400).json({ error: 'A valid 10-digit phone number is required.' });
    if (!address?.trim() || !city?.trim() || !state?.trim() || !zip?.trim()) {
      return res.status(400).json({ error: 'Full address is required.' });
    }
    if (!insuranceCarrier?.trim() || !insuranceMemberId?.trim()) {
      return res.status(400).json({ error: 'Insurance carrier and member ID are required.' });
    }
    if (!relationship?.trim()) return res.status(400).json({ error: 'Relationship to patient is required.' });
    if (!cardFront || !cardBack) return res.status(400).json({ error: 'Photos of the front and back of the insurance card are required.' });

    const slotErr = validSlot(record.language, visitDate, visitTime);
    if (slotErr) return res.status(400).json({ error: slotErr });

    const [cardFrontUrl, cardBackUrl] = await Promise.all([
      uploadDataUrl(`yvy/cards/${record.id}-front.jpg`, cardFront),
      uploadDataUrl(`yvy/cards/${record.id}-back.jpg`, cardBack)
    ]);

    record.status = 'scheduled';
    record.submission = {
      submittedAt: new Date().toISOString(),
      source: 'patient',
      phone: phone.trim(),
      address: address.trim(),
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
      insuranceCarrier: insuranceCarrier.trim(),
      insuranceMemberId: insuranceMemberId.trim(),
      relationship: relationship.trim(),
      fillerName: (fillerName || '').trim(),
      visitDate,
      visitTime,
      cardFrontUrl,
      cardBackUrl,
      preScreen: sanitizePreScreen(preScreen)
    };
    await saveRecord(record);

    // The clinician link carries the VISIT token and is only ever sent to the
    // office — the patient never receives it.
    const visitLink = `${siteOrigin(req)}/yvy/visit?t=${record.visitToken}`;
    await Promise.all([
      notifyOffice({ record, visitLink }),
      syncVisitRow(record, siteOrigin(req))
    ]);

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
