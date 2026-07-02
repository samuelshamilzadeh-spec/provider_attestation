import nodemailer from 'nodemailer';

// Email + Teams notifications for the Yeled V'Yalda flow.
// Env vars (Vercel project settings):
//   SMTP_USER / SMTP_PASS  — same Gmail credentials as the GitHub Action
//   OFFICE_EMAIL           — office inbox notified when a patient books a visit
//   YVY_EMAIL              — Yeled V'Yalda inbox notified when docs are ready
//   TEAMS_WEBHOOK_URL      — Teams incoming-webhook / Workflows URL (optional)

const LOGO_URL = 'https://ac4otvimls3ptbdw.public.blob.vercel-storage.com/Icon%20Only.png';
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const OFFICE_PHONE = '718-500-4888';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Standard business-email boilerplate: no-reply notice, confidentiality /
// sent-in-error disclaimer, copyright. Two of our three emails carry real
// patient info, so this goes on all of them by default.
function legalFooterHtml() {
  const year = new Date().getFullYear();
  return `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #f1f5f9;font-size:10.5px;color:#aab4c0;line-height:1.6;">
    <p style="margin:0 0 8px;">This is an automated message sent from a no-reply mailbox &mdash; please do not reply directly to this email.</p>
    <p style="margin:0 0 8px;">This email and any attachments may contain confidential information, including protected health information, intended only for the recipient(s) named above. If you received this message in error, please notify the sender immediately and delete it. Any unauthorized review, use, disclosure, or distribution is strictly prohibited.</p>
    <p style="margin:0;">&copy; ${year} Premier Assist &nbsp;&middot;&nbsp; ${esc(OFFICE_PHONE)}</p>
  </div>`;
}

// Renders the branded Premier Assist email card. `rows` is an array of
// [label, value] pairs shown in the detail table. Set `legal: false` to omit
// the standard confidentiality/no-reply footer (on by default). Returns an
// HTML string.
export function renderEmail({ heading, intro, rows = [], buttonText, buttonUrl, footerNote, legal = true }) {
  const rowHtml = rows.map(([label, value], i) => {
    const top = i ? 'border-top:1px solid #e2e8f0;' : '';
    return `<tr>
      <td style="padding:14px 0 14px 20px;font-size:13px;color:#94a3b8;${top}" width="150">${esc(label)}</td>
      <td style="padding:14px 20px 14px 0;font-size:14px;color:#0f1923;font-weight:500;text-align:right;${top}">${esc(value || 'Not provided')}</td>
    </tr>`;
  }).join('');

  const table = rows.length ? `<table style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:32px;border-collapse:separate;" border="0" width="100%" cellspacing="0" cellpadding="0"><tbody>${rowHtml}</tbody></table>` : '';

  const button = buttonUrl ? `<table style="margin:0 0 8px;" border="0" cellspacing="0" cellpadding="0"><tbody><tr>
      <td style="border-radius:8px;" bgcolor="#eb4a99"><a style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;border-radius:8px;font-family:${SANS};" href="${buttonUrl}">${esc(buttonText || 'Open')}</a></td>
    </tr></tbody></table>` : '';

  const footer = footerNote ? `<div style="margin-top:32px;padding-top:24px;border-top:1px solid #f1f5f9;font-size:11px;color:#94a3b8;line-height:1.6;">${esc(footerNote)}</div>` : '';
  const legalFooter = legal ? legalFooterHtml() : '';

  // intro may be a single string or an array of paragraphs.
  const paras = (Array.isArray(intro) ? intro : [intro]).filter(Boolean);
  const introHtml = paras
    .map((p, i) => `<p style="margin:0 0 ${i === paras.length - 1 ? 28 : 16}px;font-size:15px;color:#64748b;line-height:1.6;">${esc(p)}</p>`)
    .join('');

  return `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:40px 36px;font-family:${SANS};">
  <div style="margin-bottom:32px;"><img src="${LOGO_URL}" alt="Premier Assist" width="40" height="40" style="display:block;border:0;"></div>
  <h1 style="margin:0 0 8px;font-size:22px;color:#0f1923;font-weight:500;line-height:1.3;letter-spacing:-0.01em;">${esc(heading)}</h1>
  ${introHtml}
  ${table}${button}${footer}${legalFooter}
</div>`;
}

export function mailer() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('Server is missing SMTP_USER or SMTP_PASS');
  }
  // Defaults to Google Workspace / Gmail; override SMTP_HOST/SMTP_PORT for other
  // providers (e.g. smtp.office365.com:587 for a Microsoft 365 mailbox).
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,               // true for 465 (SSL), false for 587 (STARTTLS)
    requireTLS: !secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

export async function sendMail({ to, subject, text, html, attachments }) {
  const t = mailer();
  // Friendly display name (override with MAIL_FROM if you want a different one).
  const from = process.env.MAIL_FROM || `Premier Assist <${process.env.SMTP_USER}>`;
  await t.sendMail({ from, to, subject, text, html, attachments });
}

// Posts a plain markdown message to a Teams chat/channel via a Power Automate
// "Post to a chat/channel when a webhook request is received" workflow URL.
// That flow's default trigger schema is a single `text` property, so the body
// carries the field under a few common names to match whatever the flow maps
// (text is the one Power Automate's default template uses).
// No-op (returns false) when not configured; notification failures must never
// fail the patient's submission.
export async function postTeamsMessage(text) {
  const url = process.env.TEAMS_WEBHOOK_URL;
  if (!url) {
    console.warn('Teams: TEAMS_WEBHOOK_URL is not set — skipping Teams notification');
    return false;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Different Power Automate templates read a different property, so send the
      // message under all the common names.
      body: JSON.stringify({ text, message: text, body: text, content: text })
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`Teams webhook failed: HTTP ${res.status} ${res.statusText} ${detail.slice(0, 400)}`);
    } else {
      console.log(`Teams webhook accepted: HTTP ${res.status}`);
    }
    return res.ok;
  } catch (err) {
    console.error('Teams webhook error:', err.message);
    return false;
  }
}
