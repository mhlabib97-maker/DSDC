// /api/contact.js — Vercel Serverless Function (Node.js)
// Handles contact form: honeypot, validation, Resend email (first), Supabase insert (service_role, non-fatal)
// Env vars required in Vercel: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, EMAIL_TO
// EMAIL_TO defaults to dsdc.bw@gmail.com if not set
// This runs server-side only — keys are never exposed to the browser.

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Parse body (Vercel may already parse JSON)
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { name, email, message, website } = body || {};

  // Honeypot: if website has value, silently succeed (bot)
  if (website && String(website).trim() !== '') {
    return res.status(200).json({ ok: true });
  }

  // Validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!name || String(name).trim() === '') {
    return res.status(400).json({ ok: false, error: 'Please enter your name.' });
  }
  if (!email || !emailRegex.test(String(email).trim())) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }
  if (!message || String(message).trim() === '') {
    return res.status(400).json({ ok: false, error: 'Please enter a message.' });
  }

  const cleanName = String(name).trim();
  const cleanEmail = String(email).trim();
  const cleanMessage = String(message).trim();

  // Env vars (server-side only)
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const EMAIL_TO = process.env.EMAIL_TO || 'dsdc.bw@gmail.com';

  if (!RESEND_API_KEY) {
    console.error('Missing RESEND_API_KEY');
    return res.status(500).json({ ok: false, error: 'Email service not configured.' });
  }

  // 1. Send email via Resend FIRST
  try {
    const resRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'DSDC Website <onboarding@resend.dev>',
        to: [EMAIL_TO],
        subject: `New DSDC Contact: ${cleanName}`,
        reply_to: cleanEmail,
        text: `New contact submission\n\nName: ${cleanName}\nEmail: ${cleanEmail}\n\nMessage:\n${cleanMessage}`,
        html: `<p><strong>New contact submission</strong></p><p><strong>Name:</strong> ${escapeHtml(cleanName)}<br><strong>Email:</strong> ${escapeHtml(cleanEmail)}</p><p><strong>Message:</strong></p><p>${escapeHtml(cleanMessage).replace(/\n/g, '<br>')}</p>`
      })
    });
    if (!resRes.ok) {
      const txt = await resRes.text();
      console.error('Resend failed', resRes.status, txt);
      return res.status(500).json({ ok: false, error: 'Could not send message. Please try again.' });
    }
  } catch (e) {
    console.error('Resend error', e);
    return res.status(500).json({ ok: false, error: 'Could not send message. Please try again.' });
  }

  // 2. Insert into Supabase contact_submissions via service_role (bypasses RLS) — NON-FATAL
  // If this fails, log and still return ok:true since email already went through
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing Supabase env - skipping DB insert, email already sent');
  } else {
    try {
      const supaRes = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/contact_submissions`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          name: cleanName,
          email: cleanEmail,
          message: cleanMessage
        })
      });
      if (!supaRes.ok) {
        const txt = await supaRes.text();
        console.error('Supabase insert failed (non-fatal, email already sent)', supaRes.status, txt);
      }
    } catch (e) {
      console.error('Supabase error (non-fatal, email already sent)', e);
    }
  }

  return res.status(200).json({ ok: true });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
