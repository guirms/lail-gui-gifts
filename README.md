# 🎁 Lista de Presentes — Guilherme & Laís

Site onde nós dois anotamos os presentes que queremos ganhar — e onde dá pra
reservar em segredo o presente do outro.

Antes rodava no Firebase Firestore direto do navegador. Agora usa
**PostgreSQL** com um backend em **Node.js + Express**.

---

## Como rodar na sua máquina

### 1. Instale as dependências

```bash
npm install
```

### 2. Configure o `.env`

Copie o modelo e preencha:

```bash
cp .env.example .env
```

O que cada variável faz:

| Variável         | Para que serve                                                     |
| ---------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`   | Connection string do PostgreSQL. **Obrigatória.**                   |
| `DATABASE_SSL`   | `auto` (padrão), `true` ou `false`. O `auto` acerta em 99% dos casos. |
| `SITE_PASSWORD`  | Senha única que vocês dois usam pra entrar. Vazio = site sem login.  |
| `SESSION_SECRET` | Chave que assina o cookie de login.                                 |
| `PEOPLE`         | Nomes do casal, separados por vírgula.                              |
| `PORT`           | Porta do servidor (padrão `3000`).                                  |

Gere um `SESSION_SECRET` aleatório com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Suba o servidor

```bash
npm start
```

Abra <http://localhost:3000>. **Não precisa criar tabela na mão** — o app cria
e atualiza o schema sozinho toda vez que sobe.

Durante o desenvolvimento, `npm run dev` reinicia a cada alteração.

---

## O que o site faz

- **Modo surpresa 🤫** — quando um reserva o presente do outro, quem pediu
  **nunca** vê que já foi reservado. O filtro é feito no servidor, então nem
  abrindo o DevTools dá pra estragar a surpresa.
- **Perfil** — cada um escolhe quem é; fica salvo no navegador.
- **Preenchimento automático por link** — cola a URL do produto e o site busca
  nome, imagem, descrição e preço nas meta tags da página.
- **Histórico** — presente entregue vai pra aba "Já ganhamos" em vez de sumir.
- **Prioridade** — de "seria legal" a "sonho de consumo".
- **Ocasião** — aniversário, Natal, Dia dos Namorados etc.
- **Busca, filtros e ordenação** — por pessoa, categoria, preço, prioridade.
- **Editar presente** — dava pra criar e apagar, agora dá pra corrigir também.
- **Estatísticas** — quantos desejos e o valor aproximado de cada um.
- **Tema claro/escuro** com detecção automática do sistema.
- **Login por senha compartilhada**, com limite de tentativas.
- **Sincronização automática** a cada 15s e ao voltar pra aba.

---

## Estrutura

```
├── server.js         API Express + serve o site
├── db.js             Pool do PostgreSQL e migração do schema
├── auth.js           Login por senha e cookie de sessão assinado
├── link-preview.js   Leitura de meta tags do link (com proteção anti-SSRF)
├── public/           Frontend (HTML/CSS/JS, sem framework)
└── .env              Segredos — não vai pro Git
```

### Tabela `gifts`

| Coluna                     | Descrição                                     |
| -------------------------- | --------------------------------------------- |
| `id`                       | Chave primária                                |
| `title`                    | Nome do presente                              |
| `link`, `image_url`        | URL do produto e da foto                      |
| `description`, `price`     | Detalhes e valor aproximado                   |
| `added_by`                 | Quem pediu                                    |
| `category`, `priority`     | Ocasião e nível de vontade (1–3)              |
| `reserved_by`, `reserved_at` | Quem reservou em segredo                    |
| `given`, `given_at`        | Já foi presenteado?                           |
| `created_at`, `updated_at` | Datas (o `updated_at` é atualizado por trigger) |

---

## API

Todas as rotas abaixo de `/api` exigem sessão quando `SITE_PASSWORD` está
definida.

| Método   | Rota                       | O que faz                             |
| -------- | -------------------------- | ------------------------------------- |
| `GET`    | `/api/config`              | Nomes, categorias e estado do login   |
| `POST`   | `/api/login` `/api/logout` | Sessão                                |
| `GET`    | `/api/gifts`               | Lista (`?viewer=&status=&order=`)     |
| `POST`   | `/api/gifts`               | Cria                                  |
| `PATCH`  | `/api/gifts/:id`           | Edita                                 |
| `DELETE` | `/api/gifts/:id`           | Apaga                                 |
| `POST`   | `/api/gifts/:id/reserve`   | Reserva em segredo                    |
| `DELETE` | `/api/gifts/:id/reserve`   | Cancela a reserva                     |
| `POST`   | `/api/gifts/:id/given`     | Marca como entregue                   |
| `POST`   | `/api/gifts/:id/ungiven`   | Volta pra lista de desejos            |
| `GET`    | `/api/stats`               | Números do resumo                     |
| `POST`   | `/api/preview`             | Lê as meta tags de um link            |
| `GET`    | `/healthz`                 | Checagem de saúde (não exige login)   |

---

## Publicando na internet

O site agora tem backend, então **GitHub Pages não serve** — ele só hospeda
arquivos estáticos e não roda Node nem conecta no PostgreSQL.

Opções que funcionam (todas com plano gratuito):
[Render](https://render.com), [Railway](https://railway.app),
[Fly.io](https://fly.io) ou [Koyeb](https://koyeb.com).

No Render, por exemplo: conecte o repositório, escolha **Web Service**, build
`npm install`, start `npm start`, e cadastre as mesmas variáveis do `.env` na
aba *Environment*.

> ⚠️ Nunca comite o arquivo `.env`. Ele já está no `.gitignore`.
