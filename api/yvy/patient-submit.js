import { assertBlobConfigured, loadRecordByToken, saveRecord, uploadDataUrl, siteOrigin } from '../../lib/store.js';
import { validSlot, validPhone, notifyOffice } from '../../lib/visit.js';
import { syncVisitRow } from '../../lib/sheets.js';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

// Whitelist of the intake pre-screen keys (mirrors yvy/prescreen.js on the
// client). Kept inline so this serverless function has no extra module to
// resolve at load time.
const PRESCREEN_KEYS = ['medicaidHighUtilizer', 'nysHealthHome', 'smiSudIdd', 'highRiskWeight', 'highRiskChronic', 'chronicIncarceration'];
const cleanPreScreen = v => Array.isArray(v) ? v.filter(k => PRESCREEN_KEYS.includes(k)) : [];

// Runs a best-effort side task (office notification, sheet sync) that must
// never fail or hang the request: the visit is already saved, so we swallow
// errors and give up after `ms` to guarantee a prompt JSON response well
// within the platform's function time limit.
function bestEffort(promise, ms, label) {
  return Promise.race([
    Promise.resolve().then(() => promise).catch(err => console.error(`${label} failed:`, err && err.message)),
    new Promise(res => setTimeout(res, ms))
  ]);
}

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
      preScreen: cleanPreScreen(preScreen)
    };
    await saveRecord(record);

    // The clinician link carries the VISIT token and is only ever sent to the
    // office — the patient never receives it.
    const visitLink = `${siteOrigin(req)}/yvy/visit?t=${record.visitToken}`;
    // Best-effort: the visit is already saved, so notification + sheet sync
    // must never fail or hang the patient's submission.
    await bestEffort(Promise.all([
      notifyOffice({ record, visitLink }),
      syncVisitRow(record, siteOrigin(req))
    ]), 6500, 'notify/sync');

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
