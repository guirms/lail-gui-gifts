/* =====================================================================
   Lista de Presentes — Guilherme & Laís
   Frontend sem framework, conversando com a API em /api (PostgreSQL).
   ===================================================================== */

const $ = (id) => document.getElementById(id);

const STORAGE = {
  profile: 'lg:profile',
  theme: 'lg:theme',
};

const state = {
  people: [],
  categories: [],
  authEnabled: false,
  profile: null,
  status: 'wanted',
  search: '',
  person: 'all',
  category: 'all',
  order: 'recentes',
  gifts: [],
  loading: false,
};

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    /* resposta sem corpo */
  }

  if (!response.ok) {
    // Sessão expirou enquanto a aba estava aberta.
    if (response.status === 401 && state.authEnabled) showLock();
    throw new ApiError(data?.error || 'Algo deu errado.', response.status);
  }
  return data;
}

/* ------------------------------------------------------------------ *
 * Toasts e confirmação
 * ------------------------------------------------------------------ */

function toast(message, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast is-${kind}`;
  el.textContent = message;
  $('toasts').appendChild(el);

  setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 3200);
}

function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = true }) {
  const dialog = $('confirmDialog');
  $('confirmTitle').textContent = title;
  $('confirmMessage').textContent = message;

  const ok = $('confirmOk');
  ok.textContent = confirmLabel;
  ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;

  return new Promise((resolve) => {
    const done = (value) => {
      ok.removeEventListener('click', onOk);
      $('confirmCancel').removeEventListener('click', onCancel);
      dialog.removeEventListener('close', onClose);
      dialog.close();
      resolve(value);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onClose = () => done(false);

    ok.addEventListener('click', onOk);
    $('confirmCancel').addEventListener('click', onCancel);
    dialog.addEventListener('close', onClose);
    dialog.showModal();
  });
}

/* ------------------------------------------------------------------ *
 * Utilidades de formatação
 * ------------------------------------------------------------------ */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const formatMoney = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? brl.format(value) : null;

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function hostOf(link) {
  if (!link) return null;
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

const initials = (name) => name.trim().charAt(0).toUpperCase();

const PRIORITY = {
  1: { label: 'Seria legal', emoji: '😊' },
  2: { label: 'Quero muito', emoji: '😍' },
  3: { label: 'Sonho de consumo', emoji: '🤩' },
};

/* ------------------------------------------------------------------ *
 * Tema
 * ------------------------------------------------------------------ */

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('themeIcon').textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem(STORAGE.theme, theme);
}

function initTheme() {
  const saved = localStorage.getItem(STORAGE.theme);
  const preferred =
    saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(preferred);
}

/* ------------------------------------------------------------------ *
 * Telas
 * ------------------------------------------------------------------ */

function showLock() {
  $('lockScreen').hidden = false;
  $('profileScreen').hidden = true;
  $('app').hidden = true;
  $('password').focus();
}

function showProfilePicker() {
  $('lockScreen').hidden = true;
  $('profileScreen').hidden = false;
  $('app').hidden = true;

  const container = $('profileOptions');
  container.replaceChildren();

  for (const name of state.people) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile-option';

    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = initials(name);

    const label = document.createElement('span');
    label.textContent = `Sou ${name}`;

    button.append(avatar, label);
    button.addEventListener('click', () => {
      setProfile(name);
      showApp();
      refresh();
    });
    container.appendChild(button);
  }
}

function showApp() {
  $('lockScreen').hidden = true;
  $('profileScreen').hidden = true;
  $('app').hidden = false;
  $('logoutBtn').hidden = !state.authEnabled;
}

function setProfile(name) {
  state.profile = name;
  localStorage.setItem(STORAGE.profile, name);
  $('profileName').textContent = name;
  $('profileAvatar').textContent = initials(name);
  $('brandSubtitle').textContent = state.people.join(' & ');
}

/* ------------------------------------------------------------------ *
 * Renderização da lista
 * ------------------------------------------------------------------ */

function visibleGifts() {
  const term = state.search.trim().toLowerCase();

  return state.gifts.filter((gift) => {
    if (state.person !== 'all' && gift.addedBy !== state.person) return false;
    if (state.category !== 'all' && gift.category !== state.category) return false;
    if (!term) return true;

    const haystack = [gift.title, gift.description, gift.category, hostOf(gift.link)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(term);
  });
}

function badge(text, className = '') {
  const span = document.createElement('span');
  span.className = `badge ${className}`.trim();
  span.textContent = text;
  return span;
}

function buildCard(gift, index) {
  const card = document.createElement('article');
  card.className = 'gift-card';
  card.style.animationDelay = `${Math.min(index, 12) * 28}ms`;
  if (gift.reserved) card.classList.add('is-reserved');
  if (gift.given) card.classList.add('is-given');

  /* --- imagem --- */
  const thumb = document.createElement('div');
  thumb.className = 'gift-thumb';
  if (gift.imageUrl) {
    const img = document.createElement('img');
    img.src = gift.imageUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    // Muita loja bloqueia hotlink — cai no emoji em vez de mostrar quebrado.
    img.addEventListener('error', () => {
      thumb.classList.add('is-placeholder');
      thumb.replaceChildren(document.createTextNode('🎁'));
    });
    thumb.appendChild(img);
  } else {
    thumb.classList.add('is-placeholder');
    thumb.textContent = '🎁';
  }

  /* --- corpo --- */
  const body = document.createElement('div');
  body.className = 'gift-body';

  const badges = document.createElement('div');
  badges.className = 'gift-badges';
  badges.appendChild(
    gift.isMine ? badge('⭐ Seu pedido', 'badge-mine') : badge(`Para ${gift.addedBy}`)
  );
  if (gift.category) badges.appendChild(badge(gift.category));
  if (gift.priority === 3) badges.appendChild(badge(`${PRIORITY[3].emoji} ${PRIORITY[3].label}`, 'badge-p3'));
  if (gift.reserved) badges.appendChild(badge('🤫 Reservado', 'badge-secret'));
  body.appendChild(badges);

  const title = document.createElement('h3');
  title.className = 'gift-title';
  if (gift.link) {
    const anchor = document.createElement('a');
    anchor.href = gift.link;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = gift.title;
    title.appendChild(anchor);
  } else {
    title.textContent = gift.title;
  }
  body.appendChild(title);

  const price = formatMoney(gift.price);
  if (price) {
    const priceEl = document.createElement('div');
    priceEl.className = 'gift-price';
    priceEl.textContent = price;
    body.appendChild(priceEl);
  }

  if (gift.description) {
    const desc = document.createElement('p');
    desc.className = 'gift-desc';
    desc.textContent = gift.description;
    body.appendChild(desc);
  }

  const meta = document.createElement('div');
  meta.className = 'gift-meta';
  const store = hostOf(gift.link);
  meta.textContent = gift.given
    ? `Presenteado em ${formatDate(gift.givenAt)}`
    : [store, `adicionado em ${formatDate(gift.createdAt)}`].filter(Boolean).join(' · ');
  body.appendChild(meta);

  if (gift.reserved && gift.reservedBy && !gift.given) {
    const note = document.createElement('div');
    note.className = 'reserved-note';
    note.textContent = gift.reservedByMe
      ? '🤫 Você vai dar esse. Ele não faz ideia!'
      : `🤫 ${gift.reservedBy} já vai dar esse.`;
    body.appendChild(note);
  }

  body.appendChild(buildActions(gift));
  card.append(thumb, body);
  return card;
}

function buildActions(gift) {
  const actions = document.createElement('div');
  actions.className = 'gift-actions';

  // O handler é sempre async: sem este catch, uma queda de rede viraria uma
  // promise rejeitada em silêncio e o botão pareceria simplesmente não funcionar.
  const button = (label, className, handler) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn-sm ${className}`;
    btn.textContent = label;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await handler();
      } catch (err) {
        if (err.status !== 401) toast(err.message || 'Não consegui fazer isso.', 'error');
      } finally {
        btn.disabled = false;
      }
    });
    actions.appendChild(btn);
    return btn;
  };

  if (gift.given) {
    button('↩︎ Voltar pra lista', 'btn-ghost', async () => {
      await api(`/gifts/${gift.id}/ungiven`, { method: 'POST', body: { viewer: state.profile } });
      toast('Presente voltou pra lista de desejos.');
      refresh();
    });
    button('Remover', 'btn-ghost', () => removeGift(gift));
    return actions;
  }

  if (gift.isMine) {
    button('✏️ Editar', 'btn-ghost', () => openDialog(gift));
    button('Remover', 'btn-ghost', () => removeGift(gift));
    return actions;
  }

  // Presente do parceiro: aqui mora o modo surpresa.
  if (gift.reservedByMe) {
    button('Cancelar reserva', 'btn-ghost', async () => {
      await api(`/gifts/${gift.id}/reserve?viewer=${encodeURIComponent(state.profile)}`, {
        method: 'DELETE',
      });
      toast('Reserva cancelada.');
      refresh();
    });
  } else if (!gift.reserved) {
    button('🤫 Deixa comigo', 'btn-primary', async () => {
      await api(`/gifts/${gift.id}/reserve`, {
        method: 'POST',
        body: { viewer: state.profile },
      });
      toast('Reservado! Segredo guardado. 🤐', 'success');
      refresh();
    });
  }

  button('🎉 Já dei', 'btn-ghost', async () => {
    const ok = await confirmDialog({
      title: 'Presente entregue?',
      message: `"${gift.title}" vai para a aba "Já ganhamos".`,
      confirmLabel: 'Sim, já dei',
      danger: false,
    });
    if (!ok) return;
    await api(`/gifts/${gift.id}/given`, { method: 'POST', body: { viewer: state.profile } });
    toast('Que fofo! Registrado. 🎉', 'success');
    refresh();
  });

  return actions;
}

async function removeGift(gift) {
  const ok = await confirmDialog({
    title: 'Remover presente?',
    message: `"${gift.title}" será apagado para sempre.`,
    confirmLabel: 'Remover',
  });
  if (!ok) return;
  await api(`/gifts/${gift.id}`, { method: 'DELETE' });
  toast('Presente removido.');
  refresh();
}

function renderSkeletons() {
  const grid = $('giftGrid');
  grid.replaceChildren();
  for (let i = 0; i < 6; i++) {
    const box = document.createElement('div');
    box.className = 'skeleton';
    grid.appendChild(box);
  }
  $('emptyState').hidden = true;
}

function renderList() {
  const grid = $('giftGrid');
  const empty = $('emptyState');
  const gifts = visibleGifts();

  grid.replaceChildren();

  if (!gifts.length) {
    empty.hidden = false;
    const filtering =
      state.search || state.person !== 'all' || state.category !== 'all';

    const [emoji, heading, text] = filtering
      ? ['🔍', 'Nada por aqui', 'Nenhum presente bate com esses filtros. Tente limpar a busca.']
      : state.status === 'given'
        ? ['🎀', 'Ainda nenhum presente entregue', 'Quando um presente da lista for dado, ele aparece aqui como lembrança.']
        : ['🎁', 'A lista está vazia', 'Adicione o primeiro presente que vocês querem ganhar!'];

    empty.replaceChildren();
    const emojiEl = document.createElement('div');
    emojiEl.className = 'emoji';
    emojiEl.textContent = emoji;
    const h3 = document.createElement('h3');
    h3.textContent = heading;
    const p = document.createElement('p');
    p.textContent = text;
    empty.append(emojiEl, h3, p);
    return;
  }

  empty.hidden = true;
  const fragment = document.createDocumentFragment();
  gifts.forEach((gift, index) => fragment.appendChild(buildCard(gift, index)));
  grid.appendChild(fragment);
}

/* ------------------------------------------------------------------ *
 * Estatísticas
 * ------------------------------------------------------------------ */

function renderStats(stats) {
  const container = $('stats');
  container.replaceChildren();

  const card = ({ label, value, sub, secret = false }) => {
    const el = document.createElement('div');
    el.className = `stat-card${secret ? ' is-secret' : ''}`;

    const labelEl = document.createElement('div');
    labelEl.className = 'stat-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('div');
    valueEl.className = 'stat-value';
    valueEl.textContent = value;

    el.append(labelEl, valueEl);

    if (sub) {
      const subEl = document.createElement('div');
      subEl.className = 'stat-sub';
      subEl.textContent = sub;
      el.appendChild(subEl);
    }
    container.appendChild(el);
  };

  for (const person of stats.perPerson) {
    card({
      label: person.name,
      value: `${person.wanted} ${person.wanted === 1 ? 'desejo' : 'desejos'}`,
      sub: person.wantedValue > 0 ? `≈ ${brl.format(person.wantedValue)}` : 'sem preços ainda',
    });
  }

  const received = stats.perPerson.reduce((sum, p) => sum + p.received, 0);
  card({ label: 'Já presenteados', value: String(received), sub: 'guardados no histórico' });

  card({
    label: '🤫 Seus segredos',
    value: String(stats.reservedByMe),
    sub: stats.reservedByMe > 0 ? 'presentes que você vai dar' : 'nada reservado ainda',
    secret: true,
  });
}

/* ------------------------------------------------------------------ *
 * Carregamento
 * ------------------------------------------------------------------ */

async function refresh({ silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  if (!silent) renderSkeletons();

  try {
    const params = new URLSearchParams({
      viewer: state.profile ?? '',
      status: state.status,
      order: state.order,
    });

    const [giftsData, stats] = await Promise.all([
      api(`/gifts?${params}`),
      api(`/stats?viewer=${encodeURIComponent(state.profile ?? '')}`),
    ]);

    state.gifts = giftsData.gifts;
    renderList();
    renderStats(stats);
  } catch (err) {
    if (err.status !== 401) {
      toast(err.message || 'Não consegui carregar a lista.', 'error');
      $('giftGrid').replaceChildren();
    }
  } finally {
    state.loading = false;
  }
}

/* ------------------------------------------------------------------ *
 * Modal de adicionar/editar
 * ------------------------------------------------------------------ */

let editingId = null;

function fillSelect(select, values, { keepFirst = false } = {}) {
  const first = keepFirst ? select.firstElementChild : null;
  select.replaceChildren();
  if (first) select.appendChild(first);
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
}

function setPreviewImage(url) {
  const card = $('previewCard');
  const img = $('previewImage');
  if (url) {
    img.src = url;
    card.hidden = false;
    card.dataset.url = url;
  } else {
    img.removeAttribute('src');
    card.hidden = true;
    delete card.dataset.url;
  }
}

function openDialog(gift = null) {
  editingId = gift?.id ?? null;

  $('dialogTitle').textContent = gift ? 'Editar presente' : 'Novo presente';
  $('saveBtn').textContent = gift ? 'Salvar alterações' : 'Adicionar presente';
  $('formError').textContent = '';
  $('previewHint').textContent =
    'Cole o link e clique em “Preencher” para buscar nome, imagem e preço.';

  $('fieldTitle').value = gift?.title ?? '';
  $('fieldLink').value = gift?.link ?? '';
  $('fieldDescription').value = gift?.description ?? '';
  $('fieldPrice').value = gift?.price ?? '';
  $('fieldPriority').value = String(gift?.priority ?? 2);
  $('fieldCategory').value = gift?.category ?? state.categories[0];
  $('fieldAddedBy').value = gift?.addedBy ?? state.profile ?? state.people[0];
  setPreviewImage(gift?.imageUrl ?? null);

  $('giftDialog').showModal();
  $('fieldTitle').focus();
}

async function loadPreview() {
  const url = $('fieldLink').value.trim();
  if (!url) {
    $('previewHint').textContent = 'Cole um link primeiro. 🙂';
    return;
  }

  const button = $('previewBtn');
  button.disabled = true;
  button.textContent = '⏳ Buscando…';
  $('previewHint').textContent = 'Lendo a página do produto…';

  try {
    const data = await api('/preview', { method: 'POST', body: { url } });

    if (data.title && !$('fieldTitle').value.trim()) $('fieldTitle').value = data.title.slice(0, 200);
    if (data.price && !$('fieldPrice').value.trim()) $('fieldPrice').value = data.price;
    if (data.description && !$('fieldDescription').value.trim()) {
      $('fieldDescription').value = data.description;
    }
    if (data.image) setPreviewImage(data.image);

    $('previewHint').textContent = data.title
      ? `✅ Dados de ${data.siteName} preenchidos. Ajuste o que quiser.`
      : 'Não achei muita coisa nessa página — preencha na mão.';
  } catch (err) {
    $('previewHint').textContent = `Não deu pra ler esse link (${err.message}). Preencha na mão.`;
  } finally {
    button.disabled = false;
    button.textContent = '✨ Preencher';
  }
}

async function submitGift(event) {
  event.preventDefault();
  const errorEl = $('formError');
  errorEl.textContent = '';

  const payload = {
    title: $('fieldTitle').value,
    link: $('fieldLink').value,
    description: $('fieldDescription').value,
    price: $('fieldPrice').value,
    priority: $('fieldPriority').value,
    category: $('fieldCategory').value,
    addedBy: $('fieldAddedBy').value,
    imageUrl: $('previewCard').dataset.url ?? '',
  };

  const saveBtn = $('saveBtn');
  saveBtn.disabled = true;

  try {
    if (editingId) {
      await api(`/gifts/${editingId}`, { method: 'PATCH', body: payload });
      toast('Presente atualizado. ✨', 'success');
    } else {
      await api('/gifts', { method: 'POST', body: payload });
      toast('Presente adicionado à lista! 🎁', 'success');
    }
    $('giftDialog').close();
    refresh();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    saveBtn.disabled = false;
  }
}

/* ------------------------------------------------------------------ *
 * Eventos
 * ------------------------------------------------------------------ */

function debounce(fn, delay = 220) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function bindEvents() {
  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorEl = $('loginError');
    errorEl.textContent = '';
    try {
      await api('/login', { method: 'POST', body: { password: $('password').value } });
      $('password').value = '';
      await start();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  $('logoutBtn').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' });
    showLock();
  });

  $('profileChip').addEventListener('click', showProfilePicker);

  $('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      state.status = tab.dataset.status;
      for (const other of document.querySelectorAll('.tab')) {
        const active = other === tab;
        other.classList.toggle('is-active', active);
        other.setAttribute('aria-selected', String(active));
      }
      refresh();
    });
  }

  $('search').addEventListener('input', debounce((event) => {
    state.search = event.target.value;
    renderList();
  }));

  $('filterPerson').addEventListener('change', (event) => {
    state.person = event.target.value;
    renderList();
  });

  $('filterCategory').addEventListener('change', (event) => {
    state.category = event.target.value;
    renderList();
  });

  $('sortBy').addEventListener('change', (event) => {
    state.order = event.target.value;
    refresh();
  });

  $('openAddBtn').addEventListener('click', () => openDialog());
  $('closeDialogBtn').addEventListener('click', () => $('giftDialog').close());
  $('cancelBtn').addEventListener('click', () => $('giftDialog').close());
  $('giftForm').addEventListener('submit', submitGift);
  $('previewBtn').addEventListener('click', loadPreview);
  $('removeImageBtn').addEventListener('click', () => setPreviewImage(null));

  // Sincroniza entre os dois celulares sem precisar recarregar a página.
  setInterval(() => {
    if (!document.hidden && !$('app').hidden) refresh({ silent: true });
  }, 15000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !$('app').hidden) refresh({ silent: true });
  });
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function start() {
  const config = await api('/config');
  state.people = config.people;
  state.categories = config.categories;
  state.authEnabled = config.authEnabled;

  if (config.authEnabled && !config.authenticated) {
    showLock();
    return;
  }

  fillSelect($('fieldAddedBy'), state.people);
  fillSelect($('fieldCategory'), state.categories);
  fillSelect($('filterPerson'), state.people, { keepFirst: true });
  fillSelect($('filterCategory'), state.categories, { keepFirst: true });

  const saved = localStorage.getItem(STORAGE.profile);
  if (saved && state.people.includes(saved)) {
    setProfile(saved);
    showApp();
    refresh();
  } else {
    showProfilePicker();
  }
}

initTheme();
bindEvents();
start().catch((err) => {
  console.error(err);
  toast('Não consegui falar com o servidor. Ele está rodando?', 'error');
});
