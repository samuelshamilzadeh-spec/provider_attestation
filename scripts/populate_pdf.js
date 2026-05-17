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
// Member DOB (same row as Member Name)
const MEMBER_DOB   = { x: 485, y: 685 };
// Member CIN — Client Identification Number (underline at y≈666)
const MEMBER_CIN   = { x: 252, y: 668 };

// LEFT COLUMN checkboxes (template box left edge at x≈54)
// Behavioral (SUD / SMI / I-DD) — grouped checkbox
const CB_BEHAVIORAL      = { x: 55, y: 558 };
// Pregnant / up to 12 months postpartum
const CB_PREG_12MO       = { x: 55, y: 506 };
// Pregnant — requires refrigeration for breast milk
const CB_PREG_REFRIG     = { x: 55, y: 488 };
// High-risk child under 18
const CB_HIGH_RISK_CHILD = { x: 55, y: 468 };
// Children obese / underweight / malnutrition
const CB_CHILD_OBESE     = { x: 55, y: 437 };
// Requirement for pre-procedure
const CB_PRE_PROCEDURE   = { x: 55, y: 389 };
// Requirement for post-hospitalization care
const CB_POST_HOSP       = { x: 55, y: 371 };
// Receiving enteral / parenteral nutritional therapy
const CB_ENTERAL         = { x: 55, y: 269 };
// Need for medically necessary home modifications
const CB_HOME_MODS       = { x: 55, y: 251 };
// Health condition exacerbated by moisture / mold / pests
const CB_HOME_ENV        = { x: 55, y: 212 };
// Need for medical necessity of home remediation
const CB_HOME_REMED      = { x: 55, y: 175 };

// RIGHT COLUMN checkboxes (template box left edge at x≈318)
// Thermoregulation
const CB_THERMO          = { x: 319, y: 557 };
// Previous heat-related ER/urgent-care visit
const CB_HEAT_ER         = { x: 319, y: 510 };
// Previous cold-related ER/urgent-care visit
const CB_COLD_ER         = { x: 319, y: 489 };
// Chronic condition
const CB_CHRONIC         = { x: 319, y: 450 };
// Refrigerated medications for chronic condition
const CB_REFRIG_MEDS     = { x: 319, y: 425 };
// Asthma — 1+ hospital inpatient stay (last 12 mo)
const CB_ASTHMA_IP       = { x: 319, y: 380 };
// Asthma — 2+ ED visits
const CB_ASTHMA_ED       = { x: 319, y: 357 };
// Asthma — 2+ urgent care visits
const CB_ASTHMA_UC       = { x: 319, y: 331 };
// Asthma — 2+ oral steroid prescribing events
const CB_ASTHMA_STEROID  = { x: 319, y: 305 };
// Asthma — 3–11 rescue inhaler prescriptions
const CB_ASTHMA_INHALER  = { x: 319, y: 279 };
// Medicaid high utilizer
const CB_HIGH_UTIL       = { x: 319, y: 239 };
// Enrolled in NYS Health Home
const CB_HEALTH_HOME     = { x: 319, y: 224 };
// Homeless
const CB_HOMELESS        = { x: 319, y: 209 };
// Transitioned out of institutional care
const CB_INSTITUTIONAL   = { x: 319, y: 190 };

// PAGE 2 (page 3 — provider info + signature)
// SCN Lead Entity Name header (sits lower on this page; underline at y≈718)
const SCN_NAME_P3    = { x: 152, y: 720 };
// "I, ___ [print full name]" — provider name blank (underline at y≈640)
const PROV_NAME_LINE = { x: 110, y: 642 };
// Provider Individual NPI (underline at y≈595)
const PROV_NPI       = { x: 152, y: 597 };
// Medicaid Provider ID (MMIS Number) — same row as NPI
const PROV_MEDICAID  = { x: 480, y: 597 };
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
const BEHAVIORAL_TRIGGERS = [
  'Substance Use Disorder (SUD)',
  'Severe Mental Illness (SMI)',
  'Intellectual or Developmental Disability (I/DD)'
];

const CRITERIA_MAP = {
  'Pregnant or postpartum within 12 months': CB_PREG_12MO,
  'Pregnant — refrigerated medication': CB_PREG_REFRIG,
  'High-risk child': CB_HIGH_RISK_CHILD,
  'Child obesity': CB_CHILD_OBESE,
  'Pre-procedure': CB_PRE_PROCEDURE,
  'Post-hospitalization': CB_POST_HOSP,
  'Enteral nutrition': CB_ENTERAL,
  'Home modifications': CB_HOME_MODS,
  'Home environmental': CB_HOME_ENV,
  'Home remediation': CB_HOME_REMED,
  'Thermoregulation': CB_THERMO,
  'Heat-related ER visit': CB_HEAT_ER,
  'Cold-related ER visit': CB_COLD_ER,
  'Chronic condition': CB_CHRONIC,
  'Refrigerated medications': CB_REFRIG_MEDS,
  'Asthma — inpatient': CB_ASTHMA_IP,
  'Asthma — ED': CB_ASTHMA_ED,
  'Asthma — urgent care': CB_ASTHMA_UC,
  'Asthma — steroid use': CB_ASTHMA_STEROID,
  'Asthma — inhaler use': CB_ASTHMA_INHALER,
  'High utilizer': CB_HIGH_UTIL,
  'Health Home enrollee': CB_HEALTH_HOME,
  'Homeless': CB_HOMELESS,
  'Institutional setting': CB_INSTITUTIONAL
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

  // The DOB field on page 2 and the date row on page 3 read more naturally as
  // MM/DD/YYYY than the ISO strings the frontend sends; the DOB template also
  // has pre-drawn "/__/__/" separators that line up with US-format dates.
  const isoToUS = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? `${m[2]}/${m[3]}/${m[1]}` : (iso || '');
  };
  const dobStr  = isoToUS(dob);
  const dateStr = isoToUS(date);

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
  draw(page2, MEMBER_DOB,   dobStr);
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
