import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

const TEMPLATE_PATH = path.resolve('templates/attestation_template.pdf');

// ── Pre-populated values ─────────────────────────────────────────────────────
const SCN_LEAD_ENTITY = 'HEALI';
const FACILITY_NAME   = 'Premier Assist';
const TELEPHONE       = '718-500-4888';
const FAX             = '718-719-1430';

// ── Provider lookup ──────────────────────────────────────────────────────────
const PROVIDERS = {
  'Esther Sobel':   { display: 'Esther Sobel, PA',   npi: '1316653736', medicaidId: '08174590' },
  'Osnat Cohen':    { display: 'Osnat Cohen, PA',    npi: '1447773569', medicaidId: '05348449' },
  'Jennifer Kahan': { display: 'Jennifer Kahan, PA', npi: '1578227443', medicaidId: '07204626' }
};

// ── Coordinate map (US Letter 612x792, origin bottom-left) ───────────────────
// Calibrated against the rendered template at 200 DPI on 2026-05-17.
// Text positions use the BASELINE y (pdf-lib draws text from its baseline).
// Checkbox positions are the BOTTOM-LEFT of a 7×7 filled square that sits inside
// the template's hollow ~9pt box.

// PAGE 0 (page 1 — instructions cover)
// SCN Lead Entity Name header (underline at y≈745)
const SCN_NAME_P1 = { x: 152, y: 747 };

// PAGE 1 (page 2 — member info + checkboxes)
// SCN Lead Entity Name header
const SCN_NAME_P2  = { x: 152, y: 747 };
// Member Name (underline at y≈683)
const MEMBER_NAME  = { x: 110, y: 685 };
// Member DOB — template has three blanks separated by "/" slashes:
//   MM:   underline x≈422-466 (slash at x≈467)
//   DD:   underline x≈469-510 (slash at x≈513)
//   YYYY: underline x≈513-554
// Positions below center the digits in each blank for Helvetica 10pt.
const MEMBER_DOB_MM   = { x: 438, y: 685 };
const MEMBER_DOB_DD   = { x: 484, y: 685 };
const MEMBER_DOB_YYYY = { x: 522, y: 685 };
// Member CIN — Client Identification Number (underline at y≈666)
const MEMBER_CIN   = { x: 252, y: 668 };

// LEFT COLUMN checkboxes — x matches the template box's left edge.
const CB_BEHAVIORAL      = { x: 45, y: 562 };
const CB_PREG_12MO       = { x: 45, y: 505 };
const CB_PREG_REFRIG     = { x: 45, y: 482 };
const CB_HIGH_RISK_CHILD = { x: 45, y: 459 };
const CB_CHILD_OBESE     = { x: 45, y: 436 };
const CB_PRE_PROCEDURE   = { x: 45, y: 380 };
const CB_POST_HOSP       = { x: 45, y: 367 };
const CB_ENTERAL         = { x: 45, y: 266 };
const CB_HOME_MODS       = { x: 45, y: 254 };
const CB_HOME_ENV        = { x: 45, y: 219 };
const CB_HOME_REMED      = { x: 45, y: 174 };

// RIGHT COLUMN checkboxes
const CB_THERMO          = { x: 294, y: 562 };
const CB_HEAT_ER         = { x: 294, y: 505 };
const CB_COLD_ER         = { x: 294, y: 482 };
const CB_CHRONIC         = { x: 294, y: 448 };
const CB_REFRIG_MEDS     = { x: 294, y: 425 };
const CB_ASTHMA_IP       = { x: 294, y: 394 };
const CB_ASTHMA_ED       = { x: 294, y: 371 };
const CB_ASTHMA_UC       = { x: 294, y: 348 };
const CB_ASTHMA_STEROID  = { x: 294, y: 335 };
const CB_ASTHMA_INHALER  = { x: 294, y: 313 };
const CB_HIGH_UTIL       = { x: 294, y: 270 };
const CB_HEALTH_HOME     = { x: 294, y: 255 };
const CB_HOMELESS        = { x: 294, y: 243 };
const CB_INSTITUTIONAL   = { x: 294, y: 225 };

// PAGE 2 (page 3 — provider info + signature)
// SCN Lead Entity Name header (sits lower on this page; underline at y≈718)
const SCN_NAME_P3    = { x: 152, y: 720 };
// "I, ___ [print full name]" — provider name blank.
// The "I," letter baseline sits at y≈648; the underline (rendered as `___`
// characters) descends below the baseline, so we anchor to the LABEL baseline,
// not the underline, to keep the provider name in the same row as the "I,".
const PROV_NAME_LINE = { x: 110, y: 648 };
// Provider Individual NPI (underline at y≈595)
const PROV_NPI       = { x: 152, y: 599 };
// Medicaid Provider ID (MMIS Number) — same row as NPI
const PROV_MEDICAID  = { x: 480, y: 599 };
// Facility Name (underline at y≈578)
const FACILITY       = { x: 113, y: 580 };
// Telephone (same row as Facility)
const TELEPHONE_POS  = { x: 305, y: 580 };
// Fax (same row as Facility)
const FAX_POS        = { x: 445, y: 580 };
// HIPAA email — left blank by design
const HIPAA_EMAIL    = { x: 220, y: 562 };
// Provider Signature image (underline at y≈478)
// Box height kept modest so the canvas's empty whitespace doesn't overlap the
// italic paragraph above (which ends at ~y=510). The signature PNG is transparent
// so only the strokes show.
const SIGNATURE_IMG  = { x: 135, y: 480, width: 180, height: 28 };
// Date (same row as signature; underline at y≈478)
const DATE_POS       = { x: 460, y: 480 };

// ── Criteria → checkbox map ──────────────────────────────────────────────────
// Keys here MUST match the exact `value` strings on the checkboxes in index.html —
// the frontend passes those strings unchanged.
const BEHAVIORAL_TRIGGERS = [
  'Substance Use Disorder (SUD)',
  'Severe Mental Illness (SMI)',
  'Intellectual or Developmental Disability (I/DD)'
];

const CRITERIA_MAP = {
  'Pregnant or up to 12 months postpartum': CB_PREG_12MO,
  'Pregnant / postpartum requiring refrigerated breast milk': CB_PREG_REFRIG,
  'High-risk child under 18': CB_HIGH_RISK_CHILD,
  'Child under 18 — obese, underweight, or malnourished': CB_CHILD_OBESE,
  'Pre-procedure requirement': CB_PRE_PROCEDURE,
  'Post-hospitalization care': CB_POST_HOSP,
  'Enteral or parenteral nutritional therapy': CB_ENTERAL,
  'Need for medically necessary home modifications': CB_HOME_MODS,
  'Health condition exacerbated by home environment': CB_HOME_ENV,
  'Medical necessity for home remediation': CB_HOME_REMED,
  'Condition affecting thermoregulation': CB_THERMO,
  'Previous heat-related illness (ER/urgent care in last 12 months)': CB_HEAT_ER,
  'Previous cold-related illness (ER/urgent care in last 12 months)': CB_COLD_ER,
  'Chronic condition': CB_CHRONIC,
  'Requires refrigerated medications for a chronic condition': CB_REFRIG_MEDS,
  '1+ inpatient hospital stay for asthma (last 12 months)': CB_ASTHMA_IP,
  '2+ ED visits for asthma (last 12 months)': CB_ASTHMA_ED,
  '2+ urgent care visits for asthma (last 12 months)': CB_ASTHMA_UC,
  '2+ oral steroid prescribing events for asthma (last 12 months)': CB_ASTHMA_STEROID,
  '3–11 rescue inhaler prescriptions (last 12 months)': CB_ASTHMA_INHALER,
  'Medicaid high utilizer': CB_HIGH_UTIL,
  'Enrolled in NYS Health Home': CB_HEALTH_HOME,
  'Homeless': CB_HOMELESS,
  'Transitioning out of institutional / congregate care (last 90 days)': CB_INSTITUTIONAL
};

function drawCheckbox(page, pos) {
  page.drawRectangle({
    x: pos.x,
    y: pos.y,
    width: 7,
    height: 7,
    color: rgb(0, 0, 0)
  });
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node populate_pdf.js <base64-json-payload>');
    process.exit(1);
  }

  const payload = JSON.parse(Buffer.from(arg, 'base64').toString('utf8'));
  const { memberName, dob, cin, criteria = [], provider, date, signatureDataUrl } = payload;

  // Frontend sends ISO (YYYY-MM-DD). Split into parts for the DOB template's
  // three pre-printed blanks, and format the signature date as MM/DD/YYYY.
  const splitIso = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? { mm: m[2], dd: m[3], yyyy: m[1] } : null;
  };
  const dobParts = splitIso(dob);
  const dateStr  = (() => {
    const p = splitIso(date);
    return p ? `${p.mm}/${p.dd}/${p.yyyy}` : (date || '');
  })();

  const provInfo = PROVIDERS[provider] || { display: provider, npi: '', medicaidId: '' };

  const tplBytes = fs.readFileSync(TEMPLATE_PATH);
  const pdf = await PDFDocument.load(tplBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const [page1, page2, page3] = pages;

  const draw = (page, pos, text) => {
    if (text == null || text === '') return;
    page.drawText(String(text), { x: pos.x, y: pos.y, size: 10, font, color: rgb(0, 0, 0) });
  };

  // Page 1 — SCN header
  draw(page1, SCN_NAME_P1, SCN_LEAD_ENTITY);

  // Page 2 — header + member info
  draw(page2, SCN_NAME_P2,  SCN_LEAD_ENTITY);
  draw(page2, MEMBER_NAME,  memberName);
  if (dobParts) {
    draw(page2, MEMBER_DOB_MM,   dobParts.mm);
    draw(page2, MEMBER_DOB_DD,   dobParts.dd);
    draw(page2, MEMBER_DOB_YYYY, dobParts.yyyy);
  }
  draw(page2, MEMBER_CIN,   cin);

  // Page 2 — checkboxes
  const checked = new Set(criteria);
  const isBehavioral = BEHAVIORAL_TRIGGERS.some(t => checked.has(t));
  if (isBehavioral) drawCheckbox(page2, CB_BEHAVIORAL);

  for (const c of criteria) {
    if (BEHAVIORAL_TRIGGERS.includes(c)) continue;
    const pos = CRITERIA_MAP[c];
    if (pos) drawCheckbox(page2, pos);
  }

  // Page 3 — header + provider info
  draw(page3, SCN_NAME_P3,    SCN_LEAD_ENTITY);
  draw(page3, PROV_NAME_LINE, provInfo.display);
  draw(page3, PROV_NPI,       provInfo.npi);
  draw(page3, PROV_MEDICAID,  provInfo.medicaidId);
  draw(page3, FACILITY,       FACILITY_NAME);
  draw(page3, TELEPHONE_POS,  TELEPHONE);
  draw(page3, FAX_POS,        FAX);
  // HIPAA_EMAIL left blank
  draw(page3, DATE_POS,       dateStr);

  // Signature image
  if (signatureDataUrl && signatureDataUrl.startsWith('data:image/')) {
    const b64 = signatureDataUrl.split(',')[1];
    if (b64) {
      const imgBytes = Buffer.from(b64, 'base64');
      const img = signatureDataUrl.includes('image/jpeg')
        ? await pdf.embedJpg(imgBytes)
        : await pdf.embedPng(imgBytes);
      page3.drawImage(img, {
        x: SIGNATURE_IMG.x,
        y: SIGNATURE_IMG.y,
        width: SIGNATURE_IMG.width,
        height: SIGNATURE_IMG.height
      });
    }
  }

  const outBytes = await pdf.save();
  const outPath = `/tmp/attestation_${Date.now()}.pdf`;
  fs.writeFileSync(outPath, outBytes);
  console.log(outPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
