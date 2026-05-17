export default async function handler(req, res) {
  const apiKey = process.env.JOTFORM_API_KEY;
  const formId = process.env.JOTFORM_FORM_ID;
  if (!apiKey || !formId) {
    return res.status(500).json({error: 'Server is missing JOTFORM_API_KEY or JOTFORM_FORM_ID'});
  }
  try {
    const r = await fetch(`https://api.jotform.com/form/${encodeURIComponent(formId)}/questions?apiKey=${encodeURIComponent(apiKey)}`);
    const d = await r.json();
    const summary = Object.entries(d.content || {}).map(([id, q]) => ({
      id, type: q.type, name: q.name, text: q.text
    }));
    return res.status(200).json({count: summary.length, questions: summary});
  } catch (e) {
    return res.status(500).json({error: e.message});
  }
}
