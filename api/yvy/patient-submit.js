import { assertBlobConfigured, loadRecordByToken, saveRecord, uploadDataUrl, siteOrigin } from '../../lib/store.js';
import { sendMail, postTeamsCard, renderEmail } from '../../lib/notify.js';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

// Scheduling windows (visit start times, Mon–Fri):
//   English: 9:30 AM – 5:00 PM  (last start 4:30 PM)
//   Spanish: 9:30 AM – 8:00 PM  (last start 7:30 PM)
const WINDOW = { en: { open: 9 * 60 + 30, close: 17 * 60 }, es: { open: 9 * 60 + 30, close: 20 * 60 } };
const SLOT_MINUTES = 30;

function validSlot(language, dateIso, time) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateIso || ''));
  const tm = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
  if (!dm || !tm) return 'Please choose a visit date and time.';
  const d = new Date(+dm[1], +dm[2] - 1, +dm[3]);
  if (d.getFullYear() !== +dm[1] || d.getMonth() !== +dm[2] - 1 || d.getDate() !== +dm[3]) return 'Invalid visit date.';
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return 'Visits are available Monday through Friday.';
  const w = WINDOW[language] || WINDOW.en;
  const mins = +tm[1] * 60 + +tm[2];
  if (mins < w.open || mins + SLOT_MINUTES > w.close || (mins - w.open) % SLOT_MINUTES !== 0) {
    return 'The selected time is outside the available hours.';
  }
  return null;
}

function fmtTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ampm}`;
}
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

// Patient submission: address + insurance + card photos + relationship +
// visit slot. Notifies the office by email and Teams.
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
    t, address, city, state, zip, insuranceCarrier, insuranceMemberId,
    relationship, fillerName, visitDate, visitTime, cardFront, cardBack
  } = body || {};

  try {
    assertBlobConfigured();

    const record = await loadRecordByToken(t, 'patient');
    if (!record) return res.status(404).json({ error: 'Visit not found' });
    if (record.status === 'completed') return res.status(409).json({ error: 'This visit has already been completed.' });

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
      cardBackUrl
    };
    await saveRecord(record);

    // The clinician link carries the VISIT token and is only ever sent here, to
    // the office — the patient never receives it.
    const visitLink = `${siteOrigin(req)}/yvy/visit?t=${record.visitToken}`;
    const patientName = `${record.firstName} ${record.lastName}`;
    const when = `${fmtDate(visitDate)} at ${fmtTime(visitTime)}`;
    const langLabel = record.language === 'es' ? 'Spanish' : 'English';

    const notifications = [];
    if (process.env.OFFICE_EMAIL) {
      const rows = [
        ['Patient', patientName],
        ['Date of birth', fmtDate(record.dob)],
        ['Language', langLabel],
        ['Lead Entity', record.leadEntity],
        ['Appointment Time', when],
        ['Insurance', `${record.submission.insuranceCarrier} — ${record.submission.insuranceMemberId}`]
      ];
      notifications.push(sendMail({
        to: process.env.OFFICE_EMAIL,
        subject: `New Provider Attestation Visit — ${patientName} — ${when}`,
        text:
`A new provider attestation visit has been scheduled.

Patient:      ${patientName}
DOB:          ${fmtDate(record.dob)}
Language:     ${langLabel}
Lead Entity:  ${record.leadEntity}
Visit:        ${when}
Insurance:    ${record.submission.insuranceCarrier} — ${record.submission.insuranceMemberId}

Open the visit form at the time of the visit:
${visitLink}`,
        html: renderEmail({
          heading: 'New attestation visit',
          intro: 'A patient just completed their intake. Review the details below and complete the attestation at the time of the visit.',
          rows,
          buttonText: 'Complete Attestation',
          buttonUrl: visitLink,
          footerNote: 'Premier Assist · Provider Attestation'
        })
      }).catch(err => console.error('Office email failed:', err.message)));
    }
    notifications.push(postTeamsCard({
      title: '🩺 New Provider Attestation Visit',
      facts: [
        ['Patient', patientName],
        ['DOB', fmtDate(record.dob)],
        ['Language', langLabel],
        ['Lead Entity', record.leadEntity],
        ['Visit', when]
      ],
      linkText: 'Open visit form',
      linkUrl: visitLink
    }));
    await Promise.all(notifications);

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
