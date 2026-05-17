export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({error: 'Method not allowed'});
  }

  const apiKey = process.env.JOTFORM_API_KEY;
  const formId = process.env.JOTFORM_FORM_ID;
  if (!apiKey || !formId) {
    return res.status(500).json({error: 'Server is missing JOTFORM_API_KEY or JOTFORM_FORM_ID'});
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({error: 'Invalid JSON body'}); }
  }
  const {memberName, dob, cin, criteria, provider, date} = body || {};

  if (!memberName || !dob || !provider) {
    return res.status(400).json({error: 'Missing required fields'});
  }
  const criteriaList = Array.isArray(criteria) ? criteria : [];

  try {
    const qRes = await fetch(`https://api.jotform.com/form/${encodeURIComponent(formId)}/questions?apiKey=${encodeURIComponent(apiKey)}`);
    if (!qRes.ok) {
      return res.status(502).json({error: `Failed to fetch form questions (${qRes.status})`});
    }
    const qData = await qRes.json();
    const qs = qData.content || {};

    const params = new URLSearchParams();
    Object.entries(qs).forEach(([id, q]) => {
      const t = (q.text || q.name || '').toLowerCase().trim();
      const nm = (q.name || '').toLowerCase();
      if (t.includes('member name'))                          params.append(`submission[${id}]`, memberName);
      if (t.includes('member dob') || nm === 'memberdob')     params.append(`submission[${id}]`, dob || '');
      if (t.includes('cin') || t.includes('client ident'))    params.append(`submission[${id}]`, cin || '');
      if (t.includes('check all') || nm === 'scnprogram')     params.append(`submission[${id}]`, criteriaList.join('\n'));
      if (nm === 'provider' || t === 'provider')              params.append(`submission[${id}]`, provider);
      if (t.includes('date') && !t.includes('dob') && !t.includes('scn') && !t.includes('created')) {
        params.append(`submission[${id}]`, date || '');
      }
    });

    const subRes = await fetch(`https://api.jotform.com/form/${encodeURIComponent(formId)}/submissions?apiKey=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: params.toString()
    });
    const subData = await subRes.json().catch(() => ({}));

    if (subData.responseCode !== 200 && subData.responseCode !== 201) {
      return res.status(502).json({error: subData.message || 'Jotform submission failed'});
    }

    return res.status(200).json({success: true});
  } catch (err) {
    return res.status(500).json({error: err.message || 'Internal error'});
  }
}
