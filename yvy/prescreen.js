// ── Yeled V'Yalda eligibility pre-screening ─────────────────────────────────
// Six intake-time questions (asked of the patient in yvy/patient.html, or of
// staff in intake.html's "Schedule for patient" mode) that pre-populate the
// clinician's criteria checklist in yvy/visit.html.
//
// `criteria` lists the exact checkbox `value`s from yvy/visit.html to
// pre-check when the question is answered yes. An empty `criteria` list means
// don't pre-check anything — it's too broad a category to guess which single
// box applies — and `flagNote` is shown to the clinician instead so they know
// to look closer.
window.YVY_PRESCREEN = [
  {
    key: 'medicaidHighUtilizer',
    label: 'High Medicaid utilizer',
    criteria: ['Medicaid high utilizer']
  },
  {
    key: 'nysHealthHome',
    label: 'Enrolled in a NYS Health Home',
    criteria: ['Enrolled in NYS Health Home']
  },
  {
    key: 'smiSudIdd',
    label: 'Severe Mental Illness (SMI), Substance Use Disorder (SUD), or Intellectual/Developmental Disability (I/DD)',
    criteria: [],
    flagNote: 'A behavioral health need (SMI, SUD, or I/DD) was indicated at intake — review the Behavioral & Developmental Health Needs section below.'
  },
  {
    key: 'highRiskWeight',
    label: 'High risk under age 18 (overweight, underweight, or malnourished)',
    criteria: ['Child under 18 — obese, underweight, or malnourished']
  },
  {
    key: 'highRiskChronic',
    label: 'High risk under age 18 with a chronic condition',
    criteria: ['High-risk child under 18', 'Chronic condition']
  },
  {
    key: 'chronicIncarceration',
    label: 'Chronic condition, released from incarceration within the last 90 days',
    criteria: ['Chronic condition', 'Transitioning out of institutional / congregate care (last 90 days)']
  }
];
