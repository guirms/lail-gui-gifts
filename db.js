import pg from 'pg';

const { Pool, types } = pg;

// O driver devolve NUMERIC e BIGINT como string por padrão (pra não perder
// precisão). Aqui os valores cabem em Number com folga, então converte.
types.setTypeParser(1700, (v) => (v === null ? null : Number.parseFloat(v))); // numeric
types.setTypeParser(20, (v) => (v === null ? null : Number.parseInt(v, 10))); // int8

const connectionString = process.env.DATABASE_URL;

if (!connectionString || connectionString.includes('NOME_DO_BANCO')) {
  console.error(`
┌──────────────────────────────────────────────────────────────┐
│  DATABASE_URL não configurada.                               │
│                                                              │
│  Abra o arquivo .env e cole a connection string do seu       │
│  PostgreSQL na variável DATABASE_URL.                        │
│                                                              │
│  Formato:                                                    │
│    postgresql://usuario:senha@host:5432/banco                │
└──────────────────────────────────────────────────────────────┘
`);
  process.exit(1);
}

/**
 * Bancos gerenciados (Neon, Supabase, Render, Railway, RDS...) exigem TLS;
 * um Postgres em localhost normalmente não tem certificado. O modo "auto"
 * decide pela URL — dá pra forçar com DATABASE_SSL=true|false.
 */
function resolveSsl(url) {
  const forced = (process.env.DATABASE_SSL || 'auto').toLowerCase();
  if (forced === 'true' || forced === 'require') return { rejectUnauthorized: false };
  if (forced === 'false' || forced === 'disable') return false;

  if (/[?&]sslmode=(require|verify-ca|verify-full)/i.test(url)) {
    return { rejectUnauthorized: false };
  }

  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }

  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local');

  return isLocal ? false : { rejectUnauthorized: false };
}

export const pool = new Pool({
  connectionString,
  ssl: resolveSsl(connectionString),
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('[db] erro em conexão ociosa do pool:', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Cria/atualiza o schema na subida do servidor. Tudo é idempotente, então
 * rodar várias vezes não quebra nada — é o que substitui o "console do
 * Firebase" que existia antes.
 *
 * O parâmetro `run` existe para os testes poderem executar exatamente este
 * SQL contra outro Postgres; em produção usa o pool normal.
 */
export async function migrate(run = query) {
  await run(`
    CREATE TABLE IF NOT EXISTS gifts (
      id            SERIAL PRIMARY KEY,
      title         TEXT        NOT NULL,
      link          TEXT,
      description   TEXT,
      price         NUMERIC(12, 2),
      added_by      TEXT        NOT NULL,
      category      TEXT        NOT NULL DEFAULT 'Qualquer ocasião',
      priority      SMALLINT    NOT NULL DEFAULT 2,
      image_url     TEXT,
      reserved_by   TEXT,
      reserved_at   TIMESTAMPTZ,
      given         BOOLEAN     NOT NULL DEFAULT FALSE,
      given_at      TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ALTERs separados para que bases criadas por versões anteriores do app
  // ganhem as colunas novas sem precisar recriar a tabela.
  const columns = [
    "category   TEXT        NOT NULL DEFAULT 'Qualquer ocasião'",
    'priority   SMALLINT    NOT NULL DEFAULT 2',
    'image_url  TEXT',
    'reserved_by TEXT',
    'reserved_at TIMESTAMPTZ',
    'given      BOOLEAN     NOT NULL DEFAULT FALSE',
    'given_at   TIMESTAMPTZ',
    'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
  ];
  for (const col of columns) {
    await run(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS ${col};`);
  }

  await run(`
    ALTER TABLE gifts
      DROP CONSTRAINT IF EXISTS gifts_priority_range;
  `);
  await run(`
    ALTER TABLE gifts
      ADD CONSTRAINT gifts_priority_range CHECK (priority BETWEEN 1 AND 3);
  `);

  await run('CREATE INDEX IF NOT EXISTS gifts_added_by_idx ON gifts (added_by);');
  await run('CREATE INDEX IF NOT EXISTS gifts_given_idx ON gifts (given);');
  await run('CREATE INDEX IF NOT EXISTS gifts_created_at_idx ON gifts (created_at DESC);');

  // updated_at automático em qualquer UPDATE.
  await run(`
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await run('DROP TRIGGER IF EXISTS gifts_set_updated_at ON gifts;');
  await run(`
    CREATE TRIGGER gifts_set_updated_at
      BEFORE UPDATE ON gifts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  console.log('[db] schema pronto');
}
