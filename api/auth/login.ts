import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';

const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getAuthorizedEmails() {
  const raw = process.env.AUTHORIZED_EMAILS || 'fokee83@gmail.com';
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function createAuthToken(session: { email: string; name: string; expiresAt: number }) {
  const secret = process.env.AUTH_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is required for Vercel authentication.');
  }

  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `tok_${payload}.${signature}`;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, name } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const authorizedEmails = getAuthorizedEmails();

    if (authorizedEmails.length > 0 && !authorizedEmails.includes(normalizedEmail)) {
      return res.status(403).json({
        error: `Access denied. Email '${normalizedEmail}' is not in the AUTHORIZED_EMAILS list.`,
      });
    }

    const session = {
      email: normalizedEmail,
      name: typeof name === 'string' && name.trim() ? name.trim() : normalizedEmail.split('@')[0],
      expiresAt: Date.now() + AUTH_SESSION_TTL_MS,
    };

    return res.status(200).json({
      token: createAuthToken(session),
      user: {
        email: session.email,
        name: session.name,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Login failed' });
  }
}
