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
      // branded prompt that explains why they're getting it (many won't connect
      // "telehealth visit" to the Yeled V'Yalda food benefit on their own).
      const copy = language === 'es'
        ? {
            subject: 'Un paso para comenzar sus beneficios de alimentos',
            heading: 'Un paso para comenzar sus beneficios',
            intro: [
              'Usted se inscribió recientemente para recibir beneficios de alimentos y otros apoyos. Antes de que puedan comenzar, un proveedor de salud debe completar una breve certificación con usted durante una llamada telefónica corta. Es gratis y solo toma unos minutos.',
              'Toque el botón de abajo para ingresar algunos datos y elegir el horario que mejor le convenga. Por favor tenga a la mano su tarjeta de seguro, ya que agregará una foto de ella en el formulario.'
            ],
            button: 'Programar mi visita',
            footer: 'Un proveedor le llamará por teléfono a la hora que elija.'
          }
        : {
            subject: 'One step to start your food benefits',
            heading: 'One step to start your benefits',
            intro: [
              "You recently signed up to receive food and other support benefits. Before they can begin, a healthcare provider needs to complete a short attestation with you during a brief phone visit. It's free and takes just a few minutes.",
              "Tap the button below to enter a few details and choose a time that works for you. Please have your insurance card nearby, since you'll add a photo of it in the form."
            ],
            button: 'Schedule my visit',
            footer: 'A provider will call you by phone at the time you choose.'
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
