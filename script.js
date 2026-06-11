// Configuração do Firebase (preencher com os dados do seu projeto)
// Após criar o projeto no Firebase, substitua os valores abaixo pelos fornecidos nas configurações da web.
const firebaseConfig = {
  apiKey: "AIzaSyDJINtEebdCxOWNKgqQLRNj5_drTDkBmLo",
  authDomain: "lail-gui.firebaseapp.com",
  projectId: "lail-gui",
  storageBucket: "lail-gui.firebasestorage.app",
  messagingSenderId: "391360575019",
  appId: "1:391360575019:web:a78ea8b7425620c531dc6e",
  measurementId: "G-VN4RCQPF8S"
};

// Inicializa Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Referência da coleção onde os presentes serão armazenados
const giftsCollection = db.collection('gifts');

// Elementos do DOM
const giftForm = document.getElementById('giftForm');
const giftsList = document.getElementById('gifts');
const filterSelect = document.getElementById('filterBy');

let currentFilter = 'all';
let cachedDocs = [];

// Adiciona presente quando o formulário é enviado
giftForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = giftForm.title.value.trim();
    const link = giftForm.link.value.trim();
    const description = giftForm.description.value.trim();
    const priceVal = giftForm.price ? giftForm.price.value.trim() : '';
    const price = priceVal ? parseFloat(priceVal) : null;
    const addedBy = giftForm.addedBy.value;
    if (!title || !link || !addedBy) {
        alert('Por favor, preencha nome, link e quem adicionou.');
        return;
    }
    try {
        await giftsCollection.add({
            title,
            link,
            description,
            price,
            addedBy,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // Limpa o formulário
        giftForm.reset();
    } catch (error) {
        console.error('Erro ao adicionar presente:', error);
        alert('Erro ao adicionar presente. Verifique sua conexão ou as configurações do Firebase.');
    }
});

// Função para renderizar a lista de presentes
function renderGift(doc) {
    const li = document.createElement('li');
    li.setAttribute('data-id', doc.id);
    
    const infoDiv = document.createElement('div');
    infoDiv.classList.add('info');
    const titleEl = document.createElement('a');
    titleEl.href = doc.data().link;
    titleEl.target = '_blank';
    titleEl.rel = 'noopener';
    titleEl.textContent = doc.data().title;
    infoDiv.appendChild(titleEl);
    if (doc.data().price != null) {
        const priceEl = document.createElement('div');
        priceEl.classList.add('price');
        const priceNumber = Number(doc.data().price);
        try {
            priceEl.textContent = priceNumber.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        } catch (e) {
            priceEl.textContent = 'R$ ' + priceNumber.toFixed(2);
        }
        priceEl.style.marginTop = '0.25rem';
        priceEl.style.fontWeight = '600';
        priceEl.style.color = '#b22b57';
        infoDiv.appendChild(priceEl);
    }
    if (doc.data().description) {
        const desc = document.createElement('p');
        desc.textContent = doc.data().description;
        desc.style.margin = '0.2rem 0 0';
        desc.style.fontSize = '0.9rem';
        desc.style.color = '#555';
        infoDiv.appendChild(desc);
    }
    const addedByEl = document.createElement('span');
    addedByEl.classList.add('added-by');
    addedByEl.textContent = `Adicionado por: ${doc.data().addedBy}`;
    infoDiv.appendChild(addedByEl);
    
    const actions = document.createElement('div');
    actions.classList.add('actions');

    const markGivenBtn = document.createElement('button');
    markGivenBtn.textContent = 'Marcar como dado';
    markGivenBtn.classList.add('mark-given');
    markGivenBtn.addEventListener('click', async () => {
        if (confirm('Marcar este presente como dado? Ele será removido da lista.')) {
            try {
                await giftsCollection.doc(doc.id).delete();
            } catch (error) {
                console.error('Erro ao marcar como dado:', error);
                alert('Erro ao marcar como dado.');
            }
        }
    });

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remover';
    removeBtn.classList.add('remove');
    removeBtn.addEventListener('click', async () => {
        if (confirm('Deseja remover este presente permanentemente?')) {
            try {
                await giftsCollection.doc(doc.id).delete();
            } catch (error) {
                console.error('Erro ao remover presente:', error);
                alert('Erro ao remover presente.');
            }
        }
    });

    actions.appendChild(markGivenBtn);
    actions.appendChild(removeBtn);

    li.appendChild(infoDiv);
    li.appendChild(actions);
    
    giftsList.appendChild(li);
}

function renderList() {
    giftsList.innerHTML = '';
    cachedDocs.forEach((doc) => {
        const addedBy = doc.data().addedBy;
        if (currentFilter === 'all' || addedBy === currentFilter) {
            renderGift(doc);
        }
    });
}

// Atualiza a lista em tempo real
giftsCollection.orderBy('createdAt').onSnapshot((snapshot) => {
    // Cache dos documentos e render com filtro
    cachedDocs = snapshot.docs;
    renderList();
});

if (filterSelect) {
    filterSelect.addEventListener('change', (e) => {
        currentFilter = e.target.value;
        renderList();
    });
}