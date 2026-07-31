import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { migrate, query, pool } from './db.js';
import {
  authEnabled,
  checkPassword,
  clearSessionCookie,
  isLoggedIn,
  requireAuth,
  setSessionCookie,
} from './auth.js';
import { fetchLinkPreview } from './link-preview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PEOPLE = (process.env.PEOPLE || 'Guilherme,Laís')
  .split(',')
  .map((n) => n.trim())
  .filter(Boolean);

const CATEGORIES = [
  'Qualquer ocasião',
  'Aniversário',
  'Natal',
  'Dia dos Namorados',
  'Casa',
  'Roupa',
  'Tecnologia',
  'Livro',
  'Viagem',
  'Outro',
];

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (msg) => new HttpError(400, msg);

/**
 * O Express 4 não encaminha rejeições de handlers async para o middleware de
 * erro — sem isso, qualquer falha viraria unhandled rejection e a requisição
 * ficaria pendurada até dar timeout.
 */
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function text(value, { field, max, required = false }) {
  const str = typeof value === 'string' ? value.trim() : '';
  if (!str) {
    if (required) throw bad(`O campo "${field}" é obrigatório.`);
    return null;
  }
  if (str.length > max) throw bad(`O campo "${field}" pode ter no máximo ${max} caracteres.`);
  return str;
}

function httpUrl(value, { required = false } = {}) {
  const str = typeof value === 'string' ? value.trim() : '';
  if (!str) {
    if (required) throw bad('O link é obrigatório.');
    return null;
  }
  let parsed;
  try {
    parsed = new URL(str);
  } catch {
    throw bad('O link precisa ser uma URL válida (começando com https://).');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw bad('O link precisa começar com http:// ou https://.');
  }
  if (str.length > 2000) throw bad('Esse link é longo demais.');
  return parsed.href;
}

function money(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number.parseFloat(String(value).replace(',', '.'));
  if (!Number.isFinite(num) || num < 0) throw bad('Preço inválido.');
  if (num > 9_999_999) throw bad('Esse preço é alto demais.');
  return Math.round(num * 100) / 100;
}

function priority(value) {
  const num = Number.parseInt(value ?? 2, 10);
  if (![1, 2, 3].includes(num)) throw bad('Prioridade inválida.');
  return num;
}

function person(value, { required = true } = {}) {
  const str = typeof value === 'string' ? value.trim() : '';
  if (!str) {
    if (required) throw bad('Diga quem é a pessoa.');
    return null;
  }
  if (!PEOPLE.includes(str)) throw bad(`"${str}" não está na lista de pessoas.`);
  return str;
}

/** Sem isso, /api/gifts/abc mandaria NaN pro Postgres e viraria erro 500. */
function giftId(req) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) throw bad('Id de presente inválido.');
  return id;
}

/** Perfil de quem está olhando. Desconhecido = trata como visitante. */
function viewerOf(req) {
  const raw = req.query.viewer ?? req.body?.viewer;
  const str = typeof raw === 'string' ? raw.trim() : '';
  return PEOPLE.includes(str) ? str : null;
}

/**
 * Coração do "modo surpresa": quem pediu o presente nunca recebe a
 * informação de que ele já foi reservado. A filtragem é feita aqui no
 * servidor de propósito — esconder só no CSS deixaria o spoiler visível
 * no DevTools.
 */
function serializeGift(row, viewer) {
  const isOwner = viewer !== null && row.added_by === viewer;
  const canSeeReservation = viewer !== null && !isOwner;
  const reserved = Boolean(row.reserved_by);

  return {
    id: row.id,
    title: row.title,
    link: row.link,
    description: row.description,
    price: row.price,
    addedBy: row.added_by,
    category: row.category,
    priority: row.priority,
    imageUrl: row.image_url,
    given: row.given,
    givenAt: row.given_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isMine: isOwner,
    // Depois de dado não há mais surpresa a proteger.
    reserved: row.given ? reserved : canSeeReservation && reserved,
    reservedBy: row.given ? row.reserved_by : canSeeReservation ? row.reserved_by : null,
    reservedByMe: canSeeReservation && row.reserved_by === viewer,
  };
}

const ORDERINGS = {
  recentes: 'created_at DESC',
  antigos: 'created_at ASC',
  prioridade: 'priority DESC, created_at DESC',
  'preco-maior': 'price DESC NULLS LAST, created_at DESC',
  'preco-menor': 'price ASC NULLS LAST, created_at DESC',
  titulo: 'title ASC',
};

/* ------------------------------------------------------------------ *
 * Autenticação
 * ------------------------------------------------------------------ */

const loginAttempts = new Map(); // ip -> { count, until }

app.get('/api/config', (req, res) => {
  res.json({
    people: PEOPLE,
    categories: CATEGORIES,
    authEnabled,
    authenticated: isLoggedIn(req),
  });
});

app.post('/api/login', (req, res) => {
  if (!authEnabled) {
    return res.json({ ok: true, authenticated: true });
  }

  const ip = req.ip || 'desconhecido';
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (record?.until && record.until > now) {
    const seconds = Math.ceil((record.until - now) / 1000);
    return res
      .status(429)
      .json({ error: `Muitas tentativas. Tente de novo em ${seconds}s.` });
  }

  if (!checkPassword(req.body?.password)) {
    const count = (record?.count ?? 0) + 1;
    loginAttempts.set(ip, {
      count,
      until: count >= 5 ? now + 60_000 : 0, // 5 erros = 1 min de espera
    });
    return res.status(401).json({ error: 'Senha incorreta.' });
  }

  loginAttempts.delete(ip);
  setSessionCookie(req, res);
  res.json({ ok: true, authenticated: true });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * Presentes
 * ------------------------------------------------------------------ */

const api = express.Router();
api.use(requireAuth);

api.get('/gifts', h(async (req, res) => {
  const viewer = viewerOf(req);
  const status = req.query.status === 'given' ? 'given' : 'wanted';
  const order = ORDERINGS[req.query.order] || ORDERINGS.recentes;

  const { rows } = await query(
    `SELECT * FROM gifts WHERE given = $1 ORDER BY ${order}`,
    [status === 'given']
  );

  res.json({ gifts: rows.map((row) => serializeGift(row, viewer)) });
}));

api.post('/gifts', h(async (req, res) => {
  const body = req.body ?? {};
  const category = text(body.category, { field: 'categoria', max: 60 }) || CATEGORIES[0];

  const { rows } = await query(
    `INSERT INTO gifts (title, link, description, price, added_by, category, priority, image_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      text(body.title, { field: 'nome do presente', max: 200, required: true }),
      httpUrl(body.link),
      text(body.description, { field: 'descrição', max: 1000 }),
      money(body.price),
      person(body.addedBy),
      category,
      priority(body.priority),
      httpUrl(body.imageUrl),
    ]
  );

  res.status(201).json({ gift: serializeGift(rows[0], viewerOf(req)) });
}));

api.patch('/gifts/:id', h(async (req, res) => {
  const id = giftId(req);
  const body = req.body ?? {};
  const updates = [];
  const values = [];

  const push = (column, value) => {
    values.push(value);
    updates.push(`${column} = $${values.length}`);
  };

  if ('title' in body) {
    push('title', text(body.title, { field: 'nome do presente', max: 200, required: true }));
  }
  if ('link' in body) push('link', httpUrl(body.link));
  if ('description' in body) {
    push('description', text(body.description, { field: 'descrição', max: 1000 }));
  }
  if ('price' in body) push('price', money(body.price));
  if ('addedBy' in body) push('added_by', person(body.addedBy));
  if ('category' in body) {
    push('category', text(body.category, { field: 'categoria', max: 60 }) || CATEGORIES[0]);
  }
  if ('priority' in body) push('priority', priority(body.priority));
  if ('imageUrl' in body) push('image_url', httpUrl(body.imageUrl));

  if (!updates.length) throw bad('Nada para atualizar.');

  values.push(id);
  const { rows } = await query(
    `UPDATE gifts SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  );

  if (!rows.length) throw new HttpError(404, 'Presente não encontrado.');
  res.json({ gift: serializeGift(rows[0], viewerOf(req)) });
}));

api.delete('/gifts/:id', h(async (req, res) => {
  const { rowCount } = await query('DELETE FROM gifts WHERE id = $1', [giftId(req)]);
  if (!rowCount) throw new HttpError(404, 'Presente não encontrado.');
  res.json({ ok: true });
}));

/** "Deixa comigo 🤫" — reserva o presente sem que o dono fique sabendo. */
api.post('/gifts/:id/reserve', h(async (req, res) => {
  const viewer = person(req.body?.viewer);
  const id = giftId(req);

  const { rows: current } = await query('SELECT * FROM gifts WHERE id = $1', [id]);
  if (!current.length) throw new HttpError(404, 'Presente não encontrado.');
  if (current[0].added_by === viewer) {
    throw bad('Você não pode reservar um presente que você mesmo pediu.');
  }
  if (current[0].reserved_by && current[0].reserved_by !== viewer) {
    throw new HttpError(409, 'Esse presente já foi reservado por outra pessoa.');
  }

  const { rows } = await query(
    'UPDATE gifts SET reserved_by = $1, reserved_at = NOW() WHERE id = $2 RETURNING *',
    [viewer, id]
  );
  res.json({ gift: serializeGift(rows[0], viewer) });
}));

api.delete('/gifts/:id/reserve', h(async (req, res) => {
  const viewer = person(req.body?.viewer ?? req.query.viewer);
  const { rows } = await query(
    `UPDATE gifts SET reserved_by = NULL, reserved_at = NULL
     WHERE id = $1 AND reserved_by = $2 RETURNING *`,
    [giftId(req), viewer]
  );
  if (!rows.length) throw new HttpError(404, 'Você não tem esse presente reservado.');
  res.json({ gift: serializeGift(rows[0], viewer) });
}));

/** Marca como entregue — vai pro histórico em vez de sumir. */
api.post('/gifts/:id/given', h(async (req, res) => {
  const viewer = viewerOf(req);
  const { rows } = await query(
    'UPDATE gifts SET given = TRUE, given_at = NOW() WHERE id = $1 RETURNING *',
    [giftId(req)]
  );
  if (!rows.length) throw new HttpError(404, 'Presente não encontrado.');
  res.json({ gift: serializeGift(rows[0], viewer) });
}));

api.post('/gifts/:id/ungiven', h(async (req, res) => {
  const viewer = viewerOf(req);
  const { rows } = await query(
    'UPDATE gifts SET given = FALSE, given_at = NULL WHERE id = $1 RETURNING *',
    [giftId(req)]
  );
  if (!rows.length) throw new HttpError(404, 'Presente não encontrado.');
  res.json({ gift: serializeGift(rows[0], viewer) });
}));

api.get('/stats', h(async (req, res) => {
  const viewer = viewerOf(req);

  const { rows } = await query(`
    SELECT
      added_by,
      COUNT(*) FILTER (WHERE NOT given)                AS wanted,
      COUNT(*) FILTER (WHERE given)                    AS received,
      COALESCE(SUM(price) FILTER (WHERE NOT given), 0) AS wanted_value
    FROM gifts
    GROUP BY added_by
  `);

  // Só conta reservas que o viewer teria direito de ver.
  const { rows: reserved } = await query(
    `SELECT COUNT(*)::int AS total FROM gifts
     WHERE NOT given AND reserved_by = $1`,
    [viewer]
  );

  res.json({
    perPerson: PEOPLE.map((name) => {
      const row = rows.find((r) => r.added_by === name);
      return {
        name,
        wanted: row?.wanted ?? 0,
        received: row?.received ?? 0,
        wantedValue: row?.wanted_value ?? 0,
      };
    }),
    reservedByMe: viewer ? reserved[0].total : 0,
  });
}));

api.post('/preview', h(async (req, res) => {
  const url = httpUrl(req.body?.url, { required: true });
  try {
    res.json(await fetchLinkPreview(url));
  } catch (err) {
    throw bad(err.message || 'Não consegui ler esse link.');
  }
}));

app.use('/api', api);

/* ------------------------------------------------------------------ *
 * Site estático + tratamento de erros
 * ------------------------------------------------------------------ */

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.get('/healthz', h(async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
}));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Rota não encontrada.' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, _next) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error('[erro]', err);
  res.status(status).json({
    error: status >= 500 ? 'Erro interno no servidor.' : err.message,
  });
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

const port = Number.parseInt(process.env.PORT || '3000', 10);

try {
  await migrate();
  app.listen(port, () => {
    console.log(`\n  💝 Lista de presentes rodando em http://localhost:${port}\n`);
  });
} catch (err) {
  console.error('\n[boot] não consegui conectar no PostgreSQL:\n', err.message, '\n');
  console.error('Confira a DATABASE_URL no arquivo .env.\n');
  await pool.end().catch(() => {});
  process.exit(1);
}
