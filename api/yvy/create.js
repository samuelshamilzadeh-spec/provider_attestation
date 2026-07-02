import crypto from 'crypto';
import { assertBlobConfigured, saveRecord, saveTokenIndex, uploadDataUrl, siteOrigin } from '../../lib/store.js';
import { sendMail, renderEmail } from '../../lib/notify.js';
import { validSlot, notifyOffice } from '../../lib/visit.js';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

// Staff intake. Two modes:
//   'send'  — create the visit and email/hand the patient a link to fill in
//             their own details (address, insurance, card photos, schedule).
//   'staff' — YVY staff fills the patient details themselves (minus the
//             insurance-card photos / HIPAA release) and the visit goes
//             straight to the Premier office as a scheduled visit.
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
    mode = 'send', firstName, lastName, dob, language, leadEntity, patientEmail,
    // staff-mode fields
    address, city, state, zip, insuranceCarrier, insuranceMemberId,
    visitDate, visitTime, cardFront, cardBack
  } = body || {};

  if (!firstName?.trim() || !lastName?.trim()) return res.status(400).json({ error: 'Patient first and last name are required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || ''))  return res.status(400).json({ error: 'Valid date of birth is required' });
  if (!['en', 'es'].includes(language))        return res.status(400).json({ error: 'Visit language must be English or Spanish' });
  if (!leadEntity?.trim())                     return res.status(400).json({ error: 'SCN Lead Entity is required' });
  if (!['send', 'staff'].includes(mode))       return res.status(400).json({ error: 'Invalid mode' });

  try {
    assertBlobConfigured();

    const id = crypto.randomUUID();
    const patientToken = crypto.randomUUID();
    const visitToken   = crypto.randomUUID();
    const docsToken    = crypto.randomUUID();

    const record = {
      id,
      createdAt: new Date().toISOString(),
      status: 'sent',
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      dob,
      language,
      leadEntity: leadEntity.trim(),
      patientEmail: (patientEmail || '').trim(),
      patientToken,
      visitToken,
      docsToken
    };

    // ── STAFF MODE: staff fills the patient details now. Insurance-card photos
    //    are OPTIONAL here; relationship is not collected. ────────────────────
    if (mode === 'staff') {
      if (!address?.trim() || !city?.trim() || !state?.trim() || !zip?.trim()) {
        return res.status(400).json({ error: 'Full address is required.' });
      }
      if (!insuranceCarrier?.trim() || !insuranceMemberId?.trim()) {
        return res.status(400).json({ error: 'Insurance carrier and member ID are required.' });
      }
      const slotErr = validSlot(language, visitDate, visitTime);
      if (slotErr) return res.status(400).json({ error: slotErr });

      // Optional card photos — upload only what was provided.
      let cardFrontUrl = '', cardBackUrl = '';
      if (cardFront) cardFrontUrl = await uploadDataUrl(`yvy/cards/${id}-front.jpg`, cardFront);
      if (cardBack)  cardBackUrl  = await uploadDataUrl(`yvy/cards/${id}-back.jpg`, cardBack);

      record.status = 'scheduled';
      record.submission = {
        submittedAt: new Date().toISOString(),
        source: 'staff',
        address: address.trim(),
        city: city.trim(),
        state: state.trim(),
        zip: zip.trim(),
        insuranceCarrier: insuranceCarrier.trim(),
        insuranceMemberId: insuranceMemberId.trim(),
        relationship: '',
        fillerName: '',
        visitDate,
        visitTime,
        cardFrontUrl,
        cardBackUrl
      };
    }

    await saveRecord(record);
    await Promise.all([
      saveTokenIndex(patientToken, id, 'patient'),
      saveTokenIndex(visitToken, id, 'visit'),
      saveTokenIndex(docsToken, id, 'docs')
    ]);

    if (mode === 'staff') {
      const visitLink = `${siteOrigin(req)}/yvy/visit?t=${visitToken}`;
      await notifyOffice({ record, visitLink });
      return res.status(200).json({ scheduled: true });
    }

    // ── SEND MODE: hand/email the patient their link ────────────────────────
    const patientLink = `${siteOrigin(req)}/yvy/patient?t=${patientToken}`;

    let emailSent = false;
    if (record.patientEmail) {
      // No name or other sensitive detail in the patient invite — just a clean,
      // branded prompt with the office's own wording.
      const copy = language === 'es'
        ? {
            subject: 'Programe su cita',
            heading: 'Programe su cita',
            intro: [
              'Gracias por su interés en programar una cita con nuestra oficina.',
              'Esperamos conocerle. Durante su visita, uno de nuestros proveedores hablará con usted sobre sus necesidades de salud o las de su hijo/a. Si es apropiado según su evaluación, proporcionará la certificación necesaria.',
              'Para programar su cita, por favor use el enlace a continuación para seleccionar la fecha y hora que le sea más conveniente.'
            ],
            button: 'Programar mi cita',
            footer: 'Agradecemos la oportunidad de cuidar a su hijo/a y esperamos poder ayudar a su familia.'
          }
        : {
            subject: 'Schedule Your Appointment',
            heading: 'Schedule Your Appointment',
            intro: [
              'Thank you for your interest in scheduling an appointment with our office.',
              "We look forward to meeting with you. During your visit, one of our providers will discuss yours/your child's health needs with you. If appropriate based on their evaluation, they will provide the necessary attestation.",
              'To schedule your appointment, please use the link below to select the date and time that is most convenient for you.'
            ],
            button: 'Schedule my appointment',
            footer: 'We appreciate the opportunity to care for your child and look forward to assisting your family.'
          };
      try {
        await sendMail({
          to: record.patientEmail,
          subject: copy.subject,
          text: `${copy.heading}\n\n${[].concat(copy.intro).join('\n\n')}\n\n${copy.button}: ${patientLink}\n\n${copy.footer}`,
          html: renderEmail({ heading: copy.heading, intro: copy.intro, buttonText: copy.button, buttonUrl: patientLink, footerNote: copy.footer })
        });
        emailSent = true;
      } catch (err) {
        return res.status(200).json({ patientLink, emailSent: false, emailError: err.message });
      }
    }

    return res.status(200).json({ patientLink, emailSent });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
