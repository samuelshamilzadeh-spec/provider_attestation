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
  const {memberName, firstName, lastName, dob, cin, criteria, provider, date, signature} = body || {};

  if ((!memberName && !firstName && !lastName) || !provider) {
    return res.status(400).json({error: 'Missing required fields'});
  }
  const criteriaList = Array.isArray(criteria) ? criteria : [];
  const fullName = (memberName || `${firstName||''} ${lastName||''}`).trim();
  const first = firstName || fullName.split(' ').slice(0,-1).join(' ') || fullName;
  const last  = lastName  || fullName.split(' ').slice(-1).join(' ');

  // Split YYYY-MM-DD → parts
  const splitDate = (iso) => {
    if (!iso) return null;
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return {year: m[1], month: m[2], day: m[3]};
  };
  const dobParts  = splitDate(dob);
  const dateParts = splitDate(date);

  const matchField = (q, key) => {
    const t  = (q.text || '').toLowerCase().trim();
    const nm = (q.name || '').toLowerCase();
    switch (key) {
      case 'name':      return t.includes('member name') || t === 'name' || t.includes('full name') || nm.includes('membername') || nm === 'name';
      case 'dob':       return t.includes('dob') || t.includes('date of birth') || nm.includes('memberdob') || nm.includes('dob');
      case 'cin':       return t.includes('cin') || t.includes('client ident');
      case 'criteria':  return t.includes('check all') || t.includes('criteria') || t.includes('eligibility') || nm === 'scnprogram' || nm.includes('criteria');
      case 'provider':  return nm === 'provider' || t === 'provider' || t.includes('provider name') || (t.includes('provider') && !t.includes('signature'));
      case 'signature': return q.type === 'control_signature' || t.includes('signature') || nm.includes('signature');
      case 'date':      return (q.type === 'control_datetime' || t.includes('date')) && !t.includes('dob') && !t.includes('birth') && !t.includes('created') && !t.includes('scn');
    }
    return false;
  };

  const appendField = (params, q, id, value, kind) => {
    const type = q.type || '';
    if (kind === 'name' && type === 'control_fullname') {
      params.append(`submission[${id}][first]`, first);
      params.append(`submission[${id}][last]`, last);
      return;
    }
    if ((kind === 'dob' || kind === 'date') && type === 'control_datetime') {
      const parts = kind === 'dob' ? dobParts : dateParts;
      if (parts) {
        params.append(`submission[${id}][month]`, parts.month);
        params.append(`submission[${id}][day]`,   parts.day);
        params.append(`submission[${id}][year]`,  parts.year);
      }
      return;
    }
    if (kind === 'signature') {
      // Jotform signature field accepts a data URL
      params.append(`submission[${id}]`, value || '');
      return;
    }
    if (kind === 'criteria' && Array.isArray(value)) {
      // Checkbox/multi: send each option separately; textareas/text get joined string
      if (type === 'control_checkbox') {
        value.forEach(v => params.append(`submission[${id}][]`, v));
      } else {
        params.append(`submission[${id}]`, value.join('\n'));
      }
      return;
    }
    params.append(`submission[${id}]`, value == null ? '' : String(value));
  };

  try {
    const qRes = await fetch(`https://api.jotform.com/form/${encodeURIComponent(formId)}/questions?apiKey=${encodeURIComponent(apiKey)}`);
    if (!qRes.ok) {
      return res.status(502).json({error: `Failed to fetch form questions (${qRes.status})`});
    }
    const qData = await qRes.json();
    const qs = qData.content || {};

    const params = new URLSearchParams();
    const mapped = {};
    Object.entries(qs).forEach(([id, q]) => {
      if (matchField(q, 'name'))      { appendField(params, q, id, fullName, 'name');         mapped[id] = 'name'; return; }
      if (matchField(q, 'dob'))       { appendField(params, q, id, dob, 'dob');               mapped[id] = 'dob'; return; }
      if (matchField(q, 'cin'))       { appendField(params, q, id, cin || '', 'cin');         mapped[id] = 'cin'; return; }
      if (matchField(q, 'criteria'))  { appendField(params, q, id, criteriaList, 'criteria'); mapped[id] = 'criteria'; return; }
      if (matchField(q, 'provider'))  { appendField(params, q, id, provider, 'provider');     mapped[id] = 'provider'; return; }
      if (matchField(q, 'signature')) { appendField(params, q, id, signature, 'signature');   mapped[id] = 'signature'; return; }
      if (matchField(q, 'date'))      { appendField(params, q, id, date, 'date');             mapped[id] = 'date'; return; }
    });

    const subRes = await fetch(`https://api.jotform.com/form/${encodeURIComponent(formId)}/submissions?apiKey=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: params.toString()
    });
    const subData = await subRes.json().catch(() => ({}));

    if (subData.responseCode !== 200 && subData.responseCode !== 201) {
      return res.status(502).json({error: subData.message || 'Jotform submission failed', mapped});
    }

    return res.status(200).json({success: true, mapped});
  } catch (err) {
    return res.status(500).json({error: err.message || 'Internal error'});
  }
}
