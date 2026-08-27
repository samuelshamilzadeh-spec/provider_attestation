import { sendMail, postTeamsMessage, renderEmail } from './notify.js';

// Shared logic for the "patient does not qualify" outcome, used by both flows:
//   /api/disqualify      — Stand Out Care form (index.html)
//   /api/yvy/disqualify  — Yeled V'Yalda clinician visit form (yvy/visit.html)
//
// A disqualification produces NO attestation PDF — nothing is being sworn to.
// The notification email IS the deliverable here, so callers await it and
// report failure, unlike the completion flow where the signed PDF is the
// artifact and the email is a side effect.

// Reasons a clinician can pick from. Keep in sync with the client-side copy in
// /disqualify.js — the browser renders these labels, but the server always
// re-resolves the code to its OWN label so a tampered client can never inject
// arbitrary text into the notification email.
export const DISQUALIFY_REASONS = [
  { code: 'no_criteria',  label: 'Does not meet any SCN eligibility criteria' },
  { code: 'declined',     label: 'Patient declined the visit or the service' },
  { code: 'no_show',      label: 'Patient did not show for the scheduled visit' },
  { code: 'unreachable',  label: 'Unable to reach the patient' },
  { code: 'wrong_info',   label: 'Patient information is incorrect or does not match' },
  { code: 'not_enrolled', label: 'Not enrolled in Medicaid / not eligible for SCN services' },
  { code: 'duplicate',    label: 'Duplicate — an attestation already exists for this patient' },
  { code: 'other',        label: 'Other' }
];

const NOTES_MAX = 2000;

export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (iso || '');
}

function validIsoDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}

// Validates and normalizes the submitted disqualification. Returns
// { error } on any problem, otherwise the clean fields to store and email.
export function parseDisqualification(body) {
  const provider = String((body && body.provider) || '').trim().slice(0, 120);
  const code = String((body && body.reasonCode) || '').trim();
  const notes = String((body && body.notes) || '').trim().slice(0, NOTES_MAX);
  const examDate = String((body && body.examDate) || '').trim();

  if (!provider) return { error: 'Please select a provider.' };
  const reason = DISQUALIFY_REASONS.find(r => r.code === code);
  if (!reason) return { error: 'Please choose a reason.' };
  // "Other" carries no meaning on its own — the note is the reason.
  if (reason.code === 'other' && !notes) return { error: 'Please describe the reason.' };
  if (examDate && !validIsoDate(examDate)) return { error: 'Please enter a valid exam date.' };

  return { provider, reasonCode: reason.code, reasonLabel: reason.label, notes, examDate };
}

// A newer outcome — a signed attestation, or the patient re-booking —
// supersedes an earlier "does not qualify". Keep it on the record for audit,
// but clear the live flag so the visit page and the Sheet row show the current
// state and never a stale reason next to a Scheduled/Completed status.
export function supersedeDisqualification(record) {
  if (!record || !record.disqualification) return false;
  record.priorDisqualifications = [...(record.priorDisqualifications || []), record.disqualification];
  delete record.disqualification;
  return true;
}

// Where the notification goes. Each flow has exactly one knob:
//
//   'standout' — STANDOUT_EMAIL, the Stand Out Care inbox. Yeled V'Yalda has
//                no part in that flow and must never receive its mail. Falls
//                back to OFFICE_EMAIL only so an unconfigured deploy still
//                delivers somewhere; set STANDOUT_EMAIL to separate them.
//                (Set the RECIPIENT_EMAIL GitHub secret to the same address to
//                route the signed-attestation email there too — that one is
//                sent by the generate-attestation Action, not by this app.)
//
//   'yvy'      — office + Yeled V'Yalda, since YVY referred the patient.
//                DISQUALIFIED_EMAIL overrides both if you want these notices
//                somewhere other than the scheduling/completion inboxes.
export function disqualifyRecipients(flow) {
  if (flow === 'standout') {
    return process.env.STANDOUT_EMAIL || process.env.OFFICE_EMAIL || '';
  }
  if (process.env.DISQUALIFIED_EMAIL) return process.env.DISQUALIFIED_EMAIL;
  // Dedupe — the two vars may well point at the same inbox.
  return [...new Set([process.env.OFFICE_EMAIL, process.env.YVY_EMAIL].filter(Boolean))].join(', ');
}

// Emails the "did not qualify" notice and posts the matching Teams card.
// Throws if the email cannot be sent (the caller surfaces that to the
// provider); the Teams post is best-effort and never throws.
//
// No link is included on purpose: this email reaches Yeled V'Yalda, and the
// clinician visit token must never leave the office's inbox (see the role
// token table in README.md).
export async function notifyDisqualification({
  flow, patientName, patientDob, examDate, examTime,
  provider, reasonLabel, notes, leadEntity, intakeSource
}) {
  const to = disqualifyRecipients(flow);
  if (!to) {
    throw new Error(flow === 'standout'
      ? 'No notification recipient is configured (set STANDOUT_EMAIL)'
      : 'No notification recipient is configured (set OFFICE_EMAIL or DISQUALIFIED_EMAIL)');
  }

  const examWhen = examDate
    ? fmtDate(examDate) + (examTime ? ` at ${examTime}` : '')
    : 'Not provided';

  const rows = [
    ['Patient', patientName],
    ['Date of birth', fmtDate(patientDob) || 'Not provided'],
    ['Exam date', examWhen],
    ['Provider', provider],
    ['Reason', reasonLabel]
  ];
  if (notes) rows.push(['Notes', notes]);
  if (leadEntity) rows.push(['Lead Entity', leadEntity]);
  if (intakeSource) rows.push(['Intake', intakeSource]);

  await sendMail({
    to,
    subject: `Patient Did Not Qualify: ${patientName}${examDate ? `, ${fmtDate(examDate)}` : ''}`,
    text:
`No attestation was completed for this patient — the provider determined the patient does not qualify.

Patient:      ${patientName}
DOB:          ${fmtDate(patientDob) || 'Not provided'}
Exam Date:    ${examWhen}
Provider:     ${provider}
Reason:       ${reasonLabel}${notes ? `\nNotes:        ${notes}` : ''}${leadEntity ? `\nLead Entity:  ${leadEntity}` : ''}

No attestation PDF was generated for this visit.`,
    html: renderEmail({
      heading: 'Patient did not qualify',
      intro: [
        `${provider} reviewed ${patientName} and determined the patient does not qualify for a provider attestation.`,
        'No attestation was signed and no PDF was generated for this visit.'
      ],
      rows,
      footerNote: 'Premier Assist · Provider Attestation'
    })
  });

  // Best-effort — postTeamsMessage swallows its own errors.
  await postTeamsMessage(
`**Patient Did Not Qualify**

**Patient Full Name:**
${patientName}

**Patient Date of Birth:**
${fmtDate(patientDob) || 'Not provided'}

**Exam Date:**
${examWhen}

**Provider:**
${provider}

**Reason:**
${reasonLabel}${notes ? `\n\n**Notes:**\n${notes}` : ''}`
  );
}
