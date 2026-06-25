import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  // CORS preflight support if they hit it directly from the browser (the backend uses server-to-server)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { to, subject, html, secret } = req.body;

  if (secret !== process.env.MAIL_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid secret key' });
  }

  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Missing required email fields (to, subject, html)' });
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      html
    });
    res.status(200).json({ success: true, info });
  } catch (error) {
    console.error('Email Proxy Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
