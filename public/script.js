const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? '/api/scrape'
  : 'https://scrapex-production-2b35.up.railway.app/api/scrape';

const YT_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none"><rect x="2" y="4" width="20" height="16" rx="4" fill="#FF0000"/><polygon points="10,8 16,12 10,16" fill="white"/></svg>';
const TT_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.58 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.33 0 .64.06.94.15V8.77a6.31 6.31 0 0 0-.94-.08 6.33 6.33 0 0 0-6.33 6.33 6.33 6.33 0 0 0 6.33 6.33 6.33 6.33 0 0 0 6.33-6.33V9.67a8.3 8.3 0 0 0 4.77 1.49v-3.4a4.83 4.83 0 0 1-1.01-.07z" fill="#000"/><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.58 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.33 0 .64.06.94.15V8.77a6.31 6.31 0 0 0-.94-.08 6.33 6.33 0 0 0-6.33 6.33 6.33 6.33 0 0 0 6.33 6.33 6.33 6.33 0 0 0 6.33-6.33V9.67a8.3 8.3 0 0 0 4.77 1.49v-3.4a4.83 4.83 0 0 1-1.01-.07z" fill="#FF004F"/><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.58 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.33 0 .64.06.94.15V8.77a6.31 6.31 0 0 0-.94-.08 6.33 6.33 0 0 0-6.33 6.33 6.33 6.33 0 0 0 6.33 6.33 6.33 6.33 0 0 0 6.33-6.33V9.67a8.3 8.3 0 0 0 4.77 1.49v-3.4a4.83 4.83 0 0 1-1.01-.07z" fill="#00F2EA"/></svg>';

const TEMPLATES = [
  { id: 'google-maps', name: 'Maps', icon: '📍', desc: 'Businesses & places', search: 'e.g. "Coffee shops"', loc: true },
  { id: 'leads', name: 'Leads', icon: '📧', desc: 'Find emails & contacts', search: 'e.g. "Plumber in Chicago"', loc: true },
  { id: 'tiktok', name: 'TikTok', icon: TT_ICON, desc: 'Videos & creators', search: 'e.g. "music"', loc: false },
  { id: 'youtube', name: 'YouTube', icon: YT_ICON, desc: 'Videos & channels', search: 'e.g. "tech reviews"', loc: false },
];

const STORE_KEY = 'scrapex_results';
let activeTemplate = 'google-maps';
let currentItems = [];
let isCardView = false;
let sortKey = '';
let sortAsc = true;

const els = {
  templateList: document.getElementById('templateList'),
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  locationInput: document.getElementById('locationInput'),
  maxResults: document.getElementById('maxResults'),
  searchBtn: document.getElementById('searchBtn'),
  toast: document.getElementById('toast'),
  statsBar: document.getElementById('statsBar'),
  skeleton: document.getElementById('skeleton'),
  results: document.getElementById('results'),
  tableHead: document.getElementById('tableHead'),
  tableBody: document.getElementById('tableBody'),
  tableView: document.getElementById('tableView'),
  cardsView: document.getElementById('cardsView'),
  viewToggle: document.getElementById('viewToggle'),
  resultCount: document.getElementById('resultCount'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  modal: document.getElementById('modal'),
  modalBody: document.getElementById('modalBody'),
  modalClose: document.getElementById('modalClose'),
  modalCloseX: document.getElementById('modalCloseX'),
};

// Templates
function renderTemplates() {
  els.templateList.innerHTML = TEMPLATES.map(t => `
    <div class="template-card ${t.id === activeTemplate ? 'active' : ''}" data-template="${t.id}">
      <span class="template-icon">${t.icon}</span>
      <div class="template-info">
        <span class="template-name">${t.name}</span>
        <span class="template-desc">${t.desc}</span>
      </div>
    </div>
  `).join('');
  document.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.template;
      if (id === activeTemplate) return;
      setActiveTemplate(id);
    });
  });
}

function setActiveTemplate(id) {
  activeTemplate = id;
  document.querySelectorAll('.template-card').forEach(c => c.classList.toggle('active', c.dataset.template === id));
  const t = TEMPLATES.find(x => x.id === id);
  els.searchInput.placeholder = t.search;
  els.locationInput.style.display = t.loc ? '' : 'none';
  hideResults();
  hideToast();
}

// Toast
function showToast(msg, type) {
  els.toast.className = 'toast ' + type;
  if (type === 'loading') {
    els.toast.innerHTML = '<span class="spinner"></span> ' + msg;
  } else {
    els.toast.textContent = msg;
  }
}
function hideToast() { els.toast.className = 'toast hidden'; }

// Skeleton
function showSkeleton() { els.skeleton.classList.remove('hidden'); }
function hideSkeleton() { els.skeleton.classList.add('hidden'); }

// Stats
function showStats(items) {
  const total = items.length;
  const withEmail = items.filter(i => i.email).length;
  const withPhone = items.filter(i => i.phone).length;
  const avgStars = items.filter(i => i.stars).length
    ? (items.reduce((a, i) => a + (i.stars || 0), 0) / items.filter(i => i.stars).length).toFixed(1)
    : '—';
  els.statsBar.innerHTML = `
    <div class="stat"><span class="stat-value">${total}</span><span class="stat-label">Results</span></div>
    <div class="stat"><span class="stat-value">${withEmail}</span><span class="stat-label">Emails</span></div>
    <div class="stat"><span class="stat-value">${withPhone}</span><span class="stat-label">Phones</span></div>
    <div class="stat"><span class="stat-value">${avgStars}</span><span class="stat-label">Avg Rating</span></div>
  `;
  els.statsBar.classList.remove('hidden');
}
function hideStats() { els.statsBar.classList.add('hidden'); }

function hideResults() {
  els.results.classList.add('hidden');
  hideStats();
}

// Search
els.searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = els.searchInput.value.trim();
  const location = els.locationInput.value.trim();
  const max = els.maxResults.value || 10;
  if (!query) return;

  els.searchBtn.disabled = true;
  els.searchBtn.textContent = 'Scraping...';
  hideResults();
  hideToast();
  showSkeleton();
  showToast('Scraping...', 'loading');

  try {
    const body = { template: activeTemplate, searchString: query, maxCrawledPlaces: parseInt(max) };
    if (location) body.locationQuery = location;

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    hideSkeleton();

    if (!res.ok) { showToast(data.error || 'Scrape failed', 'error'); return; }
    if (!data.items || data.items.length === 0) { showToast('No results found', 'error'); return; }

    currentItems = data.items;
    renderResults(currentItems);
    showToast(`Found ${data.items.length} results`, 'success');
    els.results.classList.remove('hidden');
    showStats(data.items);
    localStorage.setItem(STORE_KEY, JSON.stringify({ items: data.items, template: activeTemplate, query }));
  } catch (err) {
    hideSkeleton();
    showToast('Error: ' + err.message, 'error');
  } finally {
    els.searchBtn.disabled = false;
    els.searchBtn.textContent = 'Scrape';
  }
});

// Render results (table + cards)
function renderResults(items) {
  const keys = new Set();
  items.forEach(item => Object.keys(item).forEach(k => keys.add(k)));
  const columns = Array.from(keys);

  // Table header (sortable)
  els.tableHead.innerHTML = '<tr>' + columns.map(c =>
    '<th data-key="' + c + '" class="' + (sortKey === c ? 'sorted' : '') + '">' + camelToTitle(c) + (sortKey === c ? (sortAsc ? ' ▲' : ' ▼') : '') + '</th>'
  ).join('') + '</tr>';

  els.tableHead.querySelectorAll('th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (sortKey === key) sortAsc = !sortAsc;
      else { sortKey = key; sortAsc = true; }
      renderResults(sortItems([...currentItems], key, sortAsc));
    });
  });

  // Table body
  els.tableBody.innerHTML = sortItems(items, sortKey, sortAsc).map(item =>
    '<tr class="clickable" data-idx="' + items.indexOf(item) + '">' + columns.map(c => {
      const val = item[c];
      if (val === null || val === undefined) return '<td></td>';
      if (typeof val === 'object') return '<td>' + JSON.stringify(val).slice(0, 200) + '</td>';
      const str = String(val);
      if (str.match(/^https?:\/\//)) return '<td><a href="' + str + '" target="_blank" rel="noopener">' + str + '</a></td>';
      return '<td>' + str + '</td>';
    }).join('') + '</tr>'
  ).join('');

  // Click row to open modal
  els.tableBody.querySelectorAll('tr.clickable').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.idx);
      const item = items[idx];
      if (item) openModal(item, columns);
    });
  });

  // Cards view
  els.cardsView.innerHTML = sortItems(items, sortKey, sortAsc).map((item, i) => {
    const title = item.title || item.name || item.author || '';
    const stars = item.stars ? '★'.repeat(Math.round(item.stars)) + '☆'.repeat(5 - Math.round(item.stars)) : '';
    const email = item.email ? '<span class="card-email">✉ ' + item.email + '</span>' : '';
    const phone = item.phone ? '<span class="card-phone">📞 ' + item.phone + '</span>' : '';
    const website = item.website || item.url || '';
    return '<div class="card" data-idx="' + items.indexOf(item) + '">' +
      '<div class="card-title">' + title + '</div>' +
      (stars ? '<div class="card-stars">' + stars + '</div>' : '') +
      '<div class="card-meta">' +
      (item.category ? '<span>🏷 ' + item.category + '</span>' : '') +
      (item.address ? '<span>📍 ' + item.address + '</span>' : '') +
      (item.channel ? '<span>📺 ' + item.channel + '</span>' : '') +
      (item.views ? '<span>👁 ' + item.views + '</span>' : '') +
      email +
      phone +
      '</div>' +
      (website ? '<a href="' + website + '" target="_blank" rel="noopener" class="card-link" onclick="event.stopPropagation()">🔗 Open</a>' : '') +
      '</div>';
  }).join('');

  els.cardsView.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.idx);
      const item = items[idx];
      if (item) openModal(item, columns);
    });
  });

  els.resultCount.textContent = '(' + items.length + ')';
  updateViewToggle();
}

function sortItems(items, key, asc) {
  if (!key) return items;
  return [...items].sort((a, b) => {
    const va = (a[key] ?? '').toString().toLowerCase();
    const vb = (b[key] ?? '').toString().toLowerCase();
    const na = parseFloat(va), nb = parseFloat(vb);
    if (!isNaN(na) && !isNaN(nb)) return asc ? na - nb : nb - na;
    return asc ? va.localeCompare(vb) : vb.localeCompare(va);
  });
}

// View toggle
els.viewToggle.addEventListener('click', () => {
  isCardView = !isCardView;
  updateViewToggle();
});

function updateViewToggle() {
  els.tableView.classList.toggle('hidden', isCardView);
  els.cardsView.classList.toggle('hidden', !isCardView);
  els.viewToggle.textContent = isCardView ? '⊞' : '▦';
  els.viewToggle.title = isCardView ? 'Table view' : 'Card view';
}

// Modal
function openModal(item, columns) {
  els.modalBody.innerHTML = '<h3>' + (item.title || item.name || 'Details') + '</h3>' +
    columns.filter(c => c !== 'searchString').map(c => {
      const val = item[c];
      if (val === null || val === undefined) return '';
      const str = String(val);
      const isUrl = str.match(/^https?:\/\//);
      return '<div class="m-field"><div class="m-label">' + camelToTitle(c) + '</div><div class="m-value">' +
        (isUrl ? '<a href="' + str + '" target="_blank" rel="noopener">' + str + '</a>' : str) +
        '</div></div>';
    }).join('');
  els.modal.classList.remove('hidden');
}

function closeModal() { els.modal.classList.add('hidden'); }
els.modalClose.addEventListener('click', closeModal);
els.modalCloseX.addEventListener('click', closeModal);
els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// Export CSV
els.exportCsvBtn.onclick = () => {
  if (!currentItems.length) return;
  const columns = Object.keys(currentItems[0]);
  const csvRows = [columns.join(',')];
  currentItems.forEach(item => {
    csvRows.push(columns.map(c => {
      const val = item[c];
      if (val === null || val === undefined) return '';
      return '"' + String(val).replace(/"/g, '""') + '"';
    }).join(','));
  });
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'scrapex_results.csv';
  a.click();
  URL.revokeObjectURL(url);
};

function camelToTitle(str) {
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).replace(/_/g, ' ').trim();
}

// Restore saved results
function restoreSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && saved.items && saved.items.length) {
      currentItems = saved.items;
      renderResults(currentItems);
      els.results.classList.remove('hidden');
      showStats(currentItems);
    }
  } catch (_) {}
}

renderTemplates();
setActiveTemplate(activeTemplate);
restoreSaved();
