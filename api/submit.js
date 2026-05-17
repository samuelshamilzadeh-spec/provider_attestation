const PROVIDERS = {
  'Esther Sobel':    { displayName: 'Esther Sobel, PA',    medicaidId: '08174590', npi: '1316653736' },
  'Osnat Cohen':     { displayName: 'Osnat Cohen, PA',     medicaidId: '05348449', npi: '1447773569' },
  'Jennifer Kahan':  { displayName: 'Jennifer Kahan, PA',  medicaidId: '07204626', npi: '1578227443' }
};

// Fuzzy-match a freeform criterion string to one of a checkbox field's defined options.
// Jotform silently drops checkbox values that don't exactly match an option label.
function matchOption(value, options) {
  if (!options || !options.length) return null;
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const v = norm(value);
  // exact normalized
  for (const o of options) if (norm(o) === v) return o;
  // option text is contained in value (or vice versa)
  for (const o of options) { const on = norm(o); if (on && (v.includes(on) || on.includes(v))) return o; }
  // significant token overlap
  const vt = new Set(v.split(' ').filter(t => t.length > 3));
  let best = null, bestScore = 0;
  for (const o of options) {
    const ot = norm(o).split(' ').filter(t => t.length > 3);
    let s = 0; for (const t of ot) if (vt.has(t)) s++;
    if (s > bestScore) { bestScore = s; best = o; }
  }
  return bestScore >= 2 ? best : null;
}

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
  const provInfo = PROVIDERS[provider] || { displayName: provider, medicaidId: '', npi: '' };

  const splitDate = (iso) => {
    if (!iso) return null;
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return {year: m[1], month: m[2], day: m[3]};
  };
  const dobParts  = splitDate(dob);
  const dateParts = splitDate(date);

  const isWidgetSignature = (q) => {
    if (q.type === 'control_signature') return true;
    if (q.type !== 'control_widget') return false;
    const cf = (q.cfname || q.widgetType || '').toLowerCase();
    return cf.includes('signature') || cf.includes('smooth') || cf.includes('e-sign');
  };

  const matchField = (q, key) => {
    const t  = (q.text || '').toLowerCase().trim();
    const nm = (q.name || '').toLowerCase();
    const hasId  = / id$|^id$|\bid\b/.test(t) || /id$/.test(nm) || nm.includes('_id');
    const hasNpi = t.includes('npi') || nm.includes('npi');
    const hasMedicaid = t.includes('medicaid');
    switch (key) {
      case 'name':         return (t.includes('member name') || t === 'name' || t.includes('full name') || nm.includes('membername') || nm === 'name') && !hasId && !t.includes('provider');
      case 'dob':          return t.includes('dob') || t.includes('date of birth') || nm.includes('memberdob') || nm.includes('dob');
      case 'cin':          return t.includes('cin') || t.includes('client ident');
      case 'criteria':     return t.includes('check all') || t.includes('criteria') || t.includes('eligibility') || nm === 'scnprogram' || nm.includes('criteria');
      case 'provider':     return !isWidgetSignature(q) && !hasId && !hasNpi && !hasMedicaid && (nm === 'provider' || t === 'provider' || (t.includes('provider') && !t.includes('name') && !t.includes('signature')));
      case 'providerName': return !hasId && !hasNpi && (t.includes('provider name') || nm.includes('providername'));
      case 'medicaidId':   return hasMedicaid && (hasId || t.includes('provider')) ;
      case 'npi':          return hasNpi;
      case 'signature':    return isWidgetSignature(q) || t.includes('signature') || nm.includes('signature');
      case 'date':         return (q.type === 'control_datetime' || t.includes('date')) && !t.includes('dob') && !t.includes('birth') && !t.includes('created') && !t.includes('scn');
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
      // Send the full data URL — Jotform's signature widget stores it as-is and renders it back from this format
      params.append(`submission[${id}]`, String(value || ''));
      return;
    }
    if (kind === 'criteria' && Array.isArray(value)) {
      if (type === 'control_checkbox') {
        // Parse defined options and align each submitted value to one
        const opts = String(q.options || '').split('|').map(s => s.trim()).filter(Boolean);
        const seen = new Set();
        for (const v of value) {
          const matched = matchOption(v, opts);
          if (matched && !seen.has(matched)) { seen.add(matched); params.append(`submission[${id}][]`, matched); }
        }
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
      if (matchField(q, 'name'))         { appendField(params, q, id, fullName, 'name');         mapped[id] = 'name'; return; }
      if (matchField(q, 'dob'))          { appendField(params, q, id, dob, 'dob');               mapped[id] = 'dob'; return; }
      if (matchField(q, 'cin'))          { appendField(params, q, id, cin || '', 'cin');         mapped[id] = 'cin'; return; }
      if (matchField(q, 'criteria'))     { appendField(params, q, id, criteriaList, 'criteria'); mapped[id] = 'criteria'; return; }
      if (matchField(q, 'medicaidId'))   { appendField(params, q, id, provInfo.medicaidId, 'medicaidId'); mapped[id] = 'medicaidId'; return; }
      if (matchField(q, 'npi'))          { appendField(params, q, id, provInfo.npi, 'npi');      mapped[id] = 'npi'; return; }
      if (matchField(q, 'providerName')) { appendField(params, q, id, provInfo.displayName, 'providerName'); mapped[id] = 'providerName'; return; }
      if (matchField(q, 'provider'))     { appendField(params, q, id, provider, 'provider');     mapped[id] = 'provider'; return; }
      if (matchField(q, 'signature'))    { appendField(params, q, id, signature, 'signature');   mapped[id] = 'signature'; return; }
      if (matchField(q, 'date'))         { appendField(params, q, id, date, 'date');             mapped[id] = 'date'; return; }

      // Forward defaults for any field we didn't fill — covers hidden / prefilled fields
      const def = q.defaultValue ?? q.default ?? '';
      if (def !== '' && def != null) {
        const type = q.type || '';
        if (type === 'control_datetime') {
          const m = String(def).match(/(\d{4})-(\d{2})-(\d{2})/) || String(def).match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (m) {
            const [year, month, day] = m[0].includes('-') ? [m[1], m[2], m[3]] : [m[3], m[1], m[2]];
            params.append(`submission[${id}][month]`, month);
            params.append(`submission[${id}][day]`,   day);
            params.append(`submission[${id}][year]`,  year);
          } else {
            params.append(`submission[${id}]`, String(def));
          }
        } else {
          params.append(`submission[${id}]`, String(def));
        }
        mapped[id] = 'default';
      }
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

    // Fire-and-forget: dispatch GitHub Action to generate + email the populated PDF.
    if (process.env.GH_REPO && process.env.GH_PAT) {
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
      fetch(`https://api.github.com/repos/${process.env.GH_REPO}/actions/workflows/generate-attestation.yml/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GH_PAT}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({ ref: 'main', inputs: { payload: b64payload } })
      }).catch(() => {});
    }

    return res.status(200).json({success: true, mapped});
  } catch (err) {
    return res.status(500).json({error: err.message || 'Internal error'});
  }
}
