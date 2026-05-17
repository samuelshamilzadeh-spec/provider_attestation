const PROVIDERS = {
  'Esther Sobel':    { displayName: 'Esther Sobel, PA',    medicaidId: '08174590', npi: '1316653736' },
  'Osnat Cohen':     { displayName: 'Osnat Cohen, PA',     medicaidId: '05348449', npi: '1447773569' },
  'Jennifer Kahan':  { displayName: 'Jennifer Kahan, PA',  medicaidId: '07204626', npi: '1578227443' }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({error: 'Method not allowed'});
  }

  if (!process.env.GH_REPO || !process.env.GH_PAT) {
    return res.status(500).json({error: 'Server is missing GH_REPO or GH_PAT'});
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({error: 'Invalid JSON body'}); }
  }
  const {memberName, firstName, lastName, dob, cin, criteria, provider, date, signature} = body || {};

  if ((!memberName && !firstName && !lastName) || !provider) {
    return res.status(400).json({error: 'Missing required fields'});
  }

  const fullName = (memberName || `${firstName||''} ${lastName||''}`).trim();
  const provInfo = PROVIDERS[provider] || { displayName: provider, medicaidId: '', npi: '' };
  const criteriaList = Array.isArray(criteria) ? criteria : [];

  const payload = {
    memberName: fullName,
    dob,
    cin: cin || '',
    criteria: criteriaList,
    provider,
    npi: provInfo.npi,
    medicaidId: provInfo.medicaidId,
    date,
    signatureDataUrl: signature || ''
  };
  const b64payload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

  try {
    const r = await fetch(
      `https://api.github.com/repos/${process.env.GH_REPO}/actions/workflows/generate-attestation.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GH_PAT}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({ ref: 'main', inputs: { payload: b64payload } })
      }
    );
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(502).json({error: `Workflow dispatch failed (${r.status}): ${txt}`});
    }
    return res.status(200).json({success: true});
  } catch (err) {
    return res.status(500).json({error: err.message || 'Internal error'});
  }
}
