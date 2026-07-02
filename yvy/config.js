// ── Yeled V'Yalda flow configuration ─────────────────────────────────────────
// EDIT HERE: the SCN Lead Entity names YVY staff can choose from. The selected
// name is printed in the "SCN Lead Entity Name" header on every page of the
// attestation PDF.
window.YVY_LEAD_ENTITIES = [
  'SOMOS',
  'HEALI',
  'SIPPS'
];

// Visit start-time windows by language (minutes since midnight), Mon–Fri.
// English 9:30 AM–5:00 PM, Spanish 9:30 AM–8:00 PM. Slots every 30 minutes;
// the last bookable start time leaves room for a full slot before close.
// Must match WINDOW/SLOT_MINUTES in api/yvy/patient-submit.js.
window.YVY_SCHEDULE = {
  en: { open: 9 * 60 + 30, close: 17 * 60 },
  es: { open: 9 * 60 + 30, close: 20 * 60 },
  slotMinutes: 30
};
