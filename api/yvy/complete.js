import { assertBlobConfigured, loadRecordByToken, saveRecord, uploadBuffer, siteOrigin } from '../../lib/store.js';
import { sendMail, renderEmail } from '../../lib/notify.js';
import { generateAttestationPdf } from '../../lib/attestation_pdf.js';
import { syncVisitRow } from '../../lib/sheets.js';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

// Clinician completion: fills the attestation PDF (header = the lead entity
// chosen at intake), stores it, and emails Yeled V'Yalda a link to the docs.
// Requires the VISIT token — a patient token is rejected by loadRecordByToken.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }
  const { t, cin, criteria, provider, date, signature } = body || {};

  if (!provider) return res.status(400).json({ error: 'Provider is required' });

  try {
    assertBlobConfigured();

    const record = await loadRecordByToken(t, 'visit');
    if (!record) return res.status(404).json({ error: 'Visit not found' });

    const memberName = `${record.firstName} ${record.lastName}`;
    const pdfBytes = await generateAttestationPdf({
      memberName,
      dob: record.dob,
      cin: cin || '',
      criteria: Array.isArray(criteria) ? criteria : [],
      provider,
      date,
      signatureDataUrl: signature || '',
      scnLeadEntity: record.leadEntity
    });

    const safe = s => String(s).trim().replace(/[^A-Za-z0-9\-]+/g, '_').replace(/^_+|_+$/g, '') || 'attestation';
    const pdfUrl = await uploadBuffer(
      `yvy/completed/${safe(memberName)}_${safe(record.dob)}.pdf`,
      Buffer.from(pdfBytes),
      'application/pdf'
    );

    record.status = 'completed';
    record.completion = {
      completedAt: new Date().toISOString(),
      provider,
      cin: cin || '',
      pdfUrl
    };
    await saveRecord(record);
    await syncVisitRow(record, siteOrigin(req));

    // Docs link carries the DOCS token and is only ever sent to Yeled V'Yalda.
    const docsLink = `${siteOrigin(req)}/yvy/docs?t=${record.docsToken}`;
    if (process.env.YVY_EMAIL) {
      await sendMail({
        to: process.env.YVY_EMAIL,
        subject: `Provider Attestation Completed: ${memberName}`,
        text:
`The provider attestation for ${memberName} (DOB ${fmtDate(record.dob)}) has been completed.

Lead Entity: ${record.leadEntity}
Provider:    ${provider}

View the completed documents (including the signed PDF) here:
${docsLink}`,
        html: renderEmail({
          heading: 'Attestation completed',
          intro: `The provider attestation for ${memberName} has been completed and signed. View the documents below.`,
          rows: [
            ['Patient', memberName],
            ['Date of birth', fmtDate(record.dob)],
            ['Lead Entity', record.leadEntity],
            ['Provider', provider]
          ],
          buttonText: 'View Documents',
          buttonUrl: docsLink,
          footerNote: 'Premier Assist · Provider Attestation'
        })
      }).catch(err => console.error('YVY email failed:', err.message));
    }

    return res.status(200).json({ success: true, docsLink });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
