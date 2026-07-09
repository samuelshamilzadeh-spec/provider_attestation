// Valid keys for the intake-time eligibility pre-screen questions (see
// yvy/prescreen.js for the question text and clinician-criteria mapping).
// Used server-side only to whitelist what gets stored on the record.
export const PRESCREEN_KEYS = [
  'medicaidHighUtilizer',
  'nysHealthHome',
  'smiSudIdd',
  'highRiskWeight',
  'highRiskChronic',
  'chronicIncarceration'
];

export function sanitizePreScreen(input) {
  return Array.isArray(input) ? input.filter(k => PRESCREEN_KEYS.includes(k)) : [];
}
