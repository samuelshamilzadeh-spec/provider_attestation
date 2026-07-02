import crypto from 'crypto';
import { assertBlobConfigured, saveRecord, saveTokenIndex, siteOrigin } from '../../lib/store.js';
import { sendMail, renderEmail } from '../../lib/notify.js';

// Staff intake: creates a visit record with three independent role tokens and
// (optionally) emails the patient their personalized link.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }
  const { firstName, lastName, dob, language, leadEntity, patientEmail } = body || {};

  if (!firstName?.trim() || !lastName?.trim()) return res.status(400).json({ error: 'Patient first and last name are required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || ''))  return res.status(400).json({ error: 'Valid date of birth is required' });
  if (!['en', 'es'].includes(language))        return res.status(400).json({ error: 'Visit language must be English or Spanish' });
  if (!leadEntity?.trim())                     return res.status(400).json({ error: 'SCN Lead Entity is required' });

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
    await saveRecord(record);
    await Promise.all([
      saveTokenIndex(patientToken, id, 'patient'),
      saveTokenIndex(visitToken, id, 'visit'),
      saveTokenIndex(docsToken, id, 'docs')
    ]);

    const patientLink = `${siteOrigin(req)}/yvy/patient?t=${patientToken}`;

    let emailSent = false;
    if (record.patientEmail) {
      const copy = language === 'es'
        ? {
            subject: 'Por favor complete su formulario de visita',
            heading: `Hola ${record.firstName},`,
            intro: 'Por favor complete su información y elija un horario de visita usando su enlace personal a continuación.',
            button: 'Completar mi formulario',
            footer: 'Si no esperaba este correo, puede ignorarlo.'
          }
        : {
            subject: 'Please complete your visit form',
            heading: `Hello ${record.firstName},`,
            intro: 'Please complete your information and choose a visit time using your personal link below.',
            button: 'Complete my form',
            footer: 'If you were not expecting this email, you can ignore it.'
          };
      try {
        await sendMail({
          to: record.patientEmail,
          subject: copy.subject,
          text: `${copy.heading}\n\n${copy.intro}\n\n${patientLink}`,
          html: renderEmail({ heading: copy.heading, intro: copy.intro, buttonText: copy.button, buttonUrl: patientLink, footerNote: copy.footer })
        });
        emailSent = true;
      } catch (err) {
        // Surface the failure but still return the link so staff can send it manually.
        return res.status(200).json({ patientLink, emailSent: false, emailError: err.message });
      }
    }

    return res.status(200).json({ patientLink, emailSent });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
