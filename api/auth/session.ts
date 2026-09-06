import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'crypto';

function getAuthorizedEmails() {
  const raw = process.env.AUTHORIZED_EMAILS || 'fokee83@gmail.com';
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function verifyAuthToken(token: string) {
  const secret = process.env.AUTH_SECRET || process.env.SESSION_SECRET;
  if (!secret || !token.startsWith('tok_')) return null;

  const [payload, signature] = token.slice(4).split('.');
  if (!payload || !signature) return null;

  const expectedSignature = createHmac('sha256', secret).update(payload).digest('base64url');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      email?: string;
      name?: string;
      expiresAt?: number;
    };
    if (!session.email || !session.name || !session.expiresAt) return null;
    if (Date.now() > session.expiresAt) return null;

    const authorizedEmails = getAuthorizedEmails();
    if (authorizedEmails.length > 0 && !authorizedEmails.includes(session.email.toLowerCase())) {
      return null;
    }

    return { email: session.email, name: session.name };
  } catch {
    return null;
  }
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const token = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
  const user = token ? verifyAuthToken(token) : null;

  return res.status(200).json({
    user,
    isAuthenticated: Boolean(user),
    authRequired: getAuthorizedEmails().length > 0,
    authorizedEmails: getAuthorizedEmails(),
  });
}
