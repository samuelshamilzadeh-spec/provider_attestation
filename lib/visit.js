import { sendMail, postTeamsCard, renderEmail } from './notify.js';

// Scheduling windows (visit start times, Mon–Fri), shared by the patient form
// and the staff "schedule for patient" path:
//   English: 9:30 AM – 5:00 PM  (last start 4:30 PM)
//   Spanish: 9:30 AM – 8:00 PM  (last start 7:30 PM)
// Keep in sync with window.YVY_SCHEDULE in yvy/config.js (client side).
export const WINDOW = { en: { open: 9 * 60 + 30, close: 17 * 60 }, es: { open: 9 * 60 + 30, close: 20 * 60 } };
export const SLOT_MINUTES = 30;

// Returns null if the slot is valid, otherwise an error message.
export function validSlot(language, dateIso, time) {
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

export function fmtTime(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

// Notifies the Premier office of a newly scheduled visit — the same email +
// Teams card whether the patient submitted it or YVY staff scheduled it.
// `visitLink` carries the clinician (visit) token.
export async function notifyOffice({ record, visitLink }) {
  const s = record.submission || {};
  const patientName = `${record.firstName} ${record.lastName}`;
  const when = s.visitDate ? `${fmtDate(s.visitDate)} at ${fmtTime(s.visitTime)}` : '—';
  const langLabel = record.language === 'es' ? 'Spanish' : 'English';
  const byStaff = s.source === 'staff';
  const insurance = s.insuranceCarrier ? `${s.insuranceCarrier} — ${s.insuranceMemberId}` : '—';

  const tasks = [];
  if (process.env.OFFICE_EMAIL) {
    const rows = [
      ['Patient', patientName],
      ['Date of birth', fmtDate(record.dob)],
      ['Language', langLabel],
      ['Lead Entity', record.leadEntity],
      ['Appointment Time', when],
      ['Insurance', insurance],
      ['Intake', byStaff ? 'Entered by Yeled V\'Yalda staff' : 'Submitted by patient']
    ];
    tasks.push(sendMail({
      to: process.env.OFFICE_EMAIL,
      subject: `New Provider Attestation Visit — ${patientName} — ${when}`,
      text:
`A new provider attestation visit has been scheduled${byStaff ? ' by Yeled V\'Yalda staff' : ''}.

Patient:      ${patientName}
DOB:          ${fmtDate(record.dob)}
Language:     ${langLabel}
Lead Entity:  ${record.leadEntity}
Visit:        ${when}
Insurance:    ${insurance}
Intake:       ${byStaff ? 'Entered by YVY staff (no insurance card photos)' : 'Submitted by patient'}

Open the visit form at the time of the visit:
${visitLink}`,
      html: renderEmail({
        heading: 'New attestation visit',
        intro: byStaff
          ? 'Yeled V\'Yalda staff scheduled this visit on the patient\'s behalf. Review the details below and complete the attestation at the time of the visit.'
          : 'A patient just completed their intake. Review the details below and complete the attestation at the time of the visit.',
        rows,
        buttonText: 'Complete Attestation',
        buttonUrl: visitLink,
        footerNote: 'Premier Assist · Provider Attestation'
      })
    }).catch(err => console.error('Office email failed:', err.message)));
  }

  tasks.push(postTeamsCard({
    title: '🩺 New Provider Attestation Visit',
    facts: [
      ['Patient', patientName],
      ['DOB', fmtDate(record.dob)],
      ['Language', langLabel],
      ['Lead Entity', record.leadEntity],
      ['Visit', when],
      ['Intake', byStaff ? 'YVY staff' : 'Patient']
    ],
    linkText: 'Open visit form',
    linkUrl: visitLink
  }));

  await Promise.all(tasks);
}
