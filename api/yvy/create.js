import crypto from 'crypto';
import { assertBlobConfigured, saveRecord, siteOrigin } from '../../lib/store.js';
import { sendMail } from '../../lib/notify.js';

// Staff intake: creates a visit record and (optionally) emails the patient
// their personalized link.
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
    const record = {
      id,
      createdAt: new Date().toISOString(),
      status: 'sent',
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      dob,
      language,
      leadEntity: leadEntity.trim(),
      patientEmail: (patientEmail || '').trim()
    };
    await saveRecord(record);

    const patientLink = `${siteOrigin(req)}/yvy/patient?id=${id}`;

    let emailSent = false;
    if (record.patientEmail) {
      const en = {
        subject: 'Please complete your visit form',
        text: `Hello ${record.firstName},\n\nPlease complete your information and choose a visit time using your personal link below:\n\n${patientLink}\n\nThank you.`
      };
      const es = {
        subject: 'Por favor complete su formulario de visita',
        text: `Hola ${record.firstName},\n\nPor favor complete su información y elija un horario de visita usando su enlace personal a continuación:\n\n${patientLink}\n\nGracias.`
      };
      const msg = language === 'es' ? es : en;
      try {
        await sendMail({ to: record.patientEmail, subject: msg.subject, text: msg.text });
        emailSent = true;
      } catch (err) {
        // Surface the failure but still return the link so staff can send it manually.
        return res.status(200).json({ id, patientLink, emailSent: false, emailError: err.message });
      }
    }

    return res.status(200).json({ id, patientLink, emailSent });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
