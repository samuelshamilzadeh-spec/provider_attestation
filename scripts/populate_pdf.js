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

// PAGE 0 (page 1 — instructions cover)
// SCN Lead Entity Name header
const SCN_NAME_P1 = { x: 200, y: 737 };

// PAGE 1 (page 2 — member info + checkboxes)
// SCN Lead Entity Name header
const SCN_NAME_P2  = { x: 200, y: 737 };
// Member Name
const MEMBER_NAME  = { x: 130, y: 693 };
// Member DOB
const MEMBER_DOB   = { x: 455, y: 693 };
// Member CIN (Client Identification Number)
const MEMBER_CIN   = { x: 175, y: 679 };

// LEFT COLUMN checkboxes (x: 57)
// Behavioral (SUD / SMI / I-DD) — grouped checkbox
const CB_BEHAVIORAL      = { x: 57, y: 596 };
// Pregnant / postpartum within 12 months
const CB_PREG_12MO       = { x: 57, y: 551 };
// Pregnant — refrigerated medication
const CB_PREG_REFRIG     = { x: 57, y: 533 };
// High-risk child
const CB_HIGH_RISK_CHILD = { x: 57, y: 508 };
// Child obesity
const CB_CHILD_OBESE     = { x: 57, y: 476 };
// Pre-procedure
const CB_PRE_PROCEDURE   = { x: 57, y: 436 };
// Post-hospitalization
const CB_POST_HOSP       = { x: 57, y: 418 };
// Enteral nutrition
const CB_ENTERAL         = { x: 57, y: 376 };
// Home modifications
const CB_HOME_MODS       = { x: 57, y: 352 };
// Home environmental
const CB_HOME_ENV        = { x: 57, y: 326 };
// Home remediation
const CB_HOME_REMED      = { x: 57, y: 298 };

// RIGHT COLUMN checkboxes (x: 318)
// Thermoregulation
const CB_THERMO          = { x: 318, y: 596 };
// Heat-related ER visit
const CB_HEAT_ER         = { x: 318, y: 548 };
// Cold-related ER visit
const CB_COLD_ER         = { x: 318, y: 530 };
// Chronic condition
const CB_CHRONIC         = { x: 318, y: 492 };
// Refrigerated medications
const CB_REFRIG_MEDS     = { x: 318, y: 470 };
// Asthma — inpatient
const CB_ASTHMA_IP       = { x: 318, y: 440 };
// Asthma — ED
const CB_ASTHMA_ED       = { x: 318, y: 424 };
// Asthma — urgent care
const CB_ASTHMA_UC       = { x: 318, y: 408 };
// Asthma — steroid use
const CB_ASTHMA_STEROID  = { x: 318, y: 392 };
// Asthma — inhaler use
const CB_ASTHMA_INHALER  = { x: 318, y: 370 };
// High utilizer
const CB_HIGH_UTIL       = { x: 318, y: 342 };
// Health Home enrollee
const CB_HEALTH_HOME     = { x: 318, y: 326 };
// Homeless
const CB_HOMELESS        = { x: 318, y: 312 };
// Institutional setting
const CB_INSTITUTIONAL   = { x: 318, y: 288 };

// PAGE 2 (page 3 — provider info + signature)
// SCN Lead Entity Name header
const SCN_NAME_P3    = { x: 200, y: 737 };
// Provider name line ("I, ___")
const PROV_NAME_LINE = { x: 108, y: 678 };
// Provider NPI
const PROV_NPI       = { x: 175, y: 641 };
// Provider Medicaid ID
const PROV_MEDICAID  = { x: 430, y: 641 };
// Facility
const FACILITY       = { x: 115, y: 624 };
// Telephone
const TELEPHONE_POS  = { x: 300, y: 624 };
// Fax
const FAX_POS        = { x: 452, y: 624 };
// HIPAA email (leave blank)
const HIPAA_EMAIL    = { x: 218, y: 608 };
// Signature image
const SIGNATURE_IMG  = { x: 108, y: 530, width: 180, height: 50 };
// Date
const DATE_POS       = { x: 430, y: 542 };

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
  draw(page2, MEMBER_DOB,   dob);
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
  draw(page3, DATE_POS,       date);

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
