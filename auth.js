import crypto from 'node:crypto';

const COOKIE_NAME = 'lg_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

const sitePassword = (process.env.SITE_PASSWORD || '').trim();
const secret =
  (process.env.SESSION_SECRET || '').trim() ||
  // Sem SESSION_SECRET o app ainda sobe, mas as sessões caem a cada restart.
  crypto.randomBytes(32).toString('hex');

/** Login está ligado? Se SITE_PASSWORD estiver vazia, o site fica aberto. */
export const authEnabled = sitePassword.length > 0;

if (!authEnabled) {
  console.warn(
    '[auth] SITE_PASSWORD vazia — o site está SEM LOGIN. ' +
      'Defina uma senha no .env antes de publicar na internet.'
  );
} else if (!process.env.SESSION_SECRET) {
  console.warn(
    '[auth] SESSION_SECRET não definida — usando chave temporária. ' +
      'Vocês vão precisar logar de novo a cada restart do servidor.'
  );
}

function sign(value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function createToken() {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + MAX_AGE_MS })
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

/** Comparação em tempo constante, pra não vazar a senha por timing. */
export function checkPassword(candidate) {
  if (!authEnabled) return true;
  const a = crypto.createHash('sha256').update(String(candidate ?? '')).digest();
  const b = crypto.createHash('sha256').update(sitePassword).digest();
  return crypto.timingSafeEqual(a, b);
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export function isLoggedIn(req) {
  if (!authEnabled) return true;
  return verifyToken(readCookie(req, COOKIE_NAME));
}

export function setSessionCookie(req, res) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(COOKIE_NAME, createToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: MAX_AGE_MS,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** Middleware para as rotas /api que exigem sessão. */
export function requireAuth(req, res, next) {
  if (isLoggedIn(req)) return next();
  return res.status(401).json({ error: 'Não autenticado' });
}
