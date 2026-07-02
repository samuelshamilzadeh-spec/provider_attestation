import nodemailer from 'nodemailer';

// Email + Teams notifications for the Yeled V'Yalda flow.
// Env vars (Vercel project settings):
//   SMTP_USER / SMTP_PASS  — same Gmail credentials as the GitHub Action
//   OFFICE_EMAIL           — office inbox notified when a patient books a visit
//   YVY_EMAIL              — Yeled V'Yalda inbox notified when docs are ready
//   TEAMS_WEBHOOK_URL      — Teams incoming-webhook / Workflows URL (optional)

export function mailer() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('Server is missing SMTP_USER or SMTP_PASS');
  }
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

export async function sendMail({ to, subject, text, html, attachments }) {
  const t = mailer();
  await t.sendMail({ from: process.env.SMTP_USER, to, subject, text, html, attachments });
}

// Posts an Adaptive Card to a Teams channel via an incoming-webhook /
// Power Automate Workflows URL. No-op (returns false) when not configured;
// notification failures must never fail the patient's submission.
export async function postTeamsCard({ title, facts, linkText, linkUrl }) {
  const url = process.env.TEAMS_WEBHOOK_URL;
  if (!url) return false;

  const card = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: title, wrap: true },
      { type: 'FactSet', facts: facts.map(([t, v]) => ({ title: t, value: String(v || '—') })) }
    ],
    actions: linkUrl ? [{ type: 'Action.OpenUrl', title: linkText || 'Open', url: linkUrl }] : []
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'message',
        attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }]
      })
    });
    return res.ok;
  } catch {
    return false;
  }
}
