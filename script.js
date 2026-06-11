// ─── Firebase Config ──────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDJINtEebdCxOWNKgqQLRNj5_drTDkBmLo",
  authDomain: "lail-gui.firebaseapp.com",
  projectId: "lail-gui",
  storageBucket: "lail-gui.firebasestorage.app",
  messagingSenderId: "391360575019",
  appId: "1:391360575019:web:a78ea8b7425620c531dc6e",
  measurementId: "G-VN4RCQPF8S"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const giftsCollection = db.collection('gifts');

// ─── State ────────────────────────────────────────────────────
let currentFilter = 'all';
let allGifts = [];

// ─── DOM Refs ─────────────────────────────────────────────────
const giftForm       = document.getElementById('giftForm');
const giftsGrid      = document.getElementById('gifts-grid');
const emptyState     = document.getElementById('empty-state');
const loadingState   = document.getElementById('loading-state');
const giftCountEl    = document.getElementById('giftCount');
const editModal      = document.getElementById('editModal');
const editForm       = document.getElementById('editForm');
const closeModalBtn  = document.getElementById('closeModal');
const cancelEditBtn  = document.getElementById('cancelEdit');
const toggleFormBtn  = document.getElementById('toggle-form-btn');
const formBody       = document.getElementById('form-body');
const filterBtns     = document.querySelectorAll('.filter-btn');

// ─── Toast ────────────────────────────────────────────────────
const toast = document.createElement('div');
toast.id = 'toast';
document.body.appendChild(toast);

function showToast(msg, duration = 2500) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ─── Toggle form collapse ─────────────────────────────────────
toggleFormBtn.addEventListener('click', () => {
  const expanded = toggleFormBtn.getAttribute('aria-expanded') === 'true';
  toggleFormBtn.setAttribute('aria-expanded', String(!expanded));
  formBody.classList.toggle('collapsed', expanded);
});
toggleFormBtn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFormBtn.click(); }
});

// ─── Filters ──────────────────────────────────────────────────
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderAll();
  });
});

// ─── Format price ─────────────────────────────────────────────
function formatPrice(price) {
  if (!price && price !== 0) return null;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price);
}

// ─── Add Gift ─────────────────────────────────────────────────
giftForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const addBtn = document.getElementById('addBtn');
  const btnText = document.getElementById('btn-text');

  const title       = giftForm.title.value.trim();
  const link        = giftForm.link.value.trim();
  const description = giftForm.description.value.trim();
  const addedBy     = giftForm.addedBy.value;
  const priceRaw    = parseFloat(giftForm.price.value);
  const price       = isNaN(priceRaw) ? null : priceRaw;

  if (!title || !link || !addedBy) {
    showToast('⚠️ Preencha nome, link e para quem é.');
    return;
  }

  addBtn.disabled = true;
  btnText.textContent = 'Adicionando...';

  try {
    await giftsCollection.add({
      title, link, description, addedBy, price,
      given: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    giftForm.reset();
    showToast('🎁 Presente adicionado!');
    // Collapse form on mobile after adding
    if (window.innerWidth <= 600) {
      toggleFormBtn.setAttribute('aria-expanded', 'false');
      formBody.classList.add('collapsed');
    }
  } catch (err) {
    console.error(err);
    showToast('❌ Erro ao adicionar. Verifique a conexão.');
  } finally {
    addBtn.disabled = false;
    btnText.textContent = 'Adicionar presente';
  }
});

// ─── Render all gifts ─────────────────────────────────────────
function renderAll() {
  giftsGrid.innerHTML = '';

  const filtered = currentFilter === 'all'
    ? allGifts
    : allGifts.filter(d => d.data().addedBy === currentFilter);

  // Update count
  const total = allGifts.length;
  const shown = filtered.length;
  giftCountEl.textContent = currentFilter === 'all'
    ? `${total} ${total === 1 ? 'presente' : 'presentes'}`
    : `${shown} de ${total}`;

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
    filtered.forEach(doc => renderGiftCard(doc));
  }
}

// ─── Render single gift card ──────────────────────────────────
function renderGiftCard(doc) {
  const data = doc.data();
  const card = document.createElement('div');
  card.classList.add('gift-card');
  card.setAttribute('data-id', doc.id);

  const isGui  = data.addedBy === 'Guilherme';
  const ownerClass = isGui ? 'owner-gui' : 'owner-lais';
  const ownerInitial = isGui ? 'G' : 'L';

  const priceHTML = data.price != null
    ? `<div class="gift-price">${formatPrice(data.price)}</div>`
    : '';

  const descHTML = data.description
    ? `<div class="gift-desc">${escapeHtml(data.description)}</div>`
    : '';

  card.innerHTML = `
    <div class="gift-card-top">
      <div class="gift-title">
        <a href="${escapeHtml(data.link)}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(data.title)}
        </a>
      </div>
      <div class="gift-owner ${ownerClass}" title="${escapeHtml(data.addedBy)} quer receber">${ownerInitial}</div>
    </div>
    ${priceHTML}
    ${descHTML}
    <div class="gift-meta">Para: ${escapeHtml(data.addedBy)}</div>
    <div class="gift-actions">
      <button class="btn-action btn-edit"   data-action="edit">✏️ Editar</button>
      <button class="btn-action btn-done"   data-action="done">✓ Dado</button>
      <button class="btn-action btn-remove" data-action="remove">✕ Remover</button>
    </div>
  `;

  // Action buttons
  card.querySelector('[data-action="edit"]').addEventListener('click', () => openEditModal(doc));
  card.querySelector('[data-action="done"]').addEventListener('click', () => markAsGiven(doc.id, data.title));
  card.querySelector('[data-action="remove"]').addEventListener('click', () => removeGift(doc.id, data.title));

  giftsGrid.appendChild(card);
}

// ─── Mark as given ────────────────────────────────────────────
async function markAsGiven(id, title) {
  if (!confirm(`Marcar "${title}" como dado? Ele vai sumir da lista.`)) return;
  try {
    await giftsCollection.doc(id).update({ given: true });
    showToast('🎉 Presente marcado como dado!');
  } catch (err) {
    console.error(err);
    showToast('❌ Erro ao atualizar.');
  }
}

// ─── Remove gift ──────────────────────────────────────────────
async function removeGift(id, title) {
  if (!confirm(`Remover "${title}" da lista?`)) return;
  try {
    await giftsCollection.doc(id).delete();
    showToast('🗑️ Presente removido.');
  } catch (err) {
    console.error(err);
    showToast('❌ Erro ao remover.');
  }
}

// ─── Edit modal ───────────────────────────────────────────────
function openEditModal(doc) {
  const data = doc.data();
  document.getElementById('editId').value          = doc.id;
  document.getElementById('editTitle').value       = data.title || '';
  document.getElementById('editLink').value        = data.link  || '';
  document.getElementById('editDescription').value = data.description || '';
  document.getElementById('editAddedBy').value     = data.addedBy || 'Guilherme';
  document.getElementById('editPrice').value       = data.price != null ? data.price : '';

  editModal.classList.add('open');
  document.getElementById('editTitle').focus();
}

function closeModal() {
  editModal.classList.remove('open');
  editForm.reset();
}

closeModalBtn.addEventListener('click', closeModal);
cancelEditBtn.addEventListener('click', closeModal);
editModal.addEventListener('click', (e) => { if (e.target === editModal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id          = document.getElementById('editId').value;
  const title       = document.getElementById('editTitle').value.trim();
  const link        = document.getElementById('editLink').value.trim();
  const description = document.getElementById('editDescription').value.trim();
  const addedBy     = document.getElementById('editAddedBy').value;
  const priceRaw    = parseFloat(document.getElementById('editPrice').value);
  const price       = isNaN(priceRaw) ? null : priceRaw;

  if (!title || !link) {
    showToast('⚠️ Nome e link são obrigatórios.');
    return;
  }

  try {
    await giftsCollection.doc(id).update({ title, link, description, addedBy, price });
    closeModal();
    showToast('✅ Presente atualizado!');
  } catch (err) {
    console.error(err);
    showToast('❌ Erro ao salvar edição.');
  }
});

// ─── Realtime listener ────────────────────────────────────────
giftsCollection
  .where('given', '==', false)
  .orderBy('createdAt')
  .onSnapshot(
    (snapshot) => {
      loadingState.classList.add('hidden');
      allGifts = snapshot.docs;
      renderAll();
    },
    (err) => {
      loadingState.classList.add('hidden');
      console.error(err);
      showToast('❌ Erro ao carregar presentes.');
    }
  );

// ─── Escape HTML helper ───────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}