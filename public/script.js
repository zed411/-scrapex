const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? '/api/scrape'
  : 'https://scrapex-production-2b35.up.railway.app/api/scrape';

const SOURCE_COLORS = { 'google-maps': '#4285f4', 'leads': '#34a853', 'ecommerce': '#fbbc04' };
const SOURCE_NAMES = { 'google-maps': 'Maps', 'leads': 'Leads', 'ecommerce': 'Shop' };
const STORE_KEY = 'scrapex_results';
const HISTORY_KEY = 'scrapex_history';

let currentItems = [];
let allItems = []; // unfiltered
let isCardView = true;
let sortKey = '';
let pollTimer = null;
let currentJobId = null;
let activeFilters = {};

const els = {
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  locationInput: document.getElementById('locationInput'),
  keywordsInput: document.getElementById('keywordsInput'),
  searchBtn: document.getElementById('searchBtn'),
  stopBtn: document.getElementById('stopBtn'),
  toast: document.getElementById('toast'),
  statsBar: document.getElementById('statsBar'),
  filterBar: document.getElementById('filterBar'),
  skeleton: document.getElementById('skeleton'),
  results: document.getElementById('results'),
  cardsView: document.getElementById('cardsView'),
  resultCount: document.getElementById('resultCount'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  exportJsonBtn: document.getElementById('exportJsonBtn'),
  modal: document.getElementById('modal'),
  modalBody: document.getElementById('modalBody'),
  modalClose: document.getElementById('modalClose'),
  modalCloseX: document.getElementById('modalCloseX'),
  aiBadge: document.getElementById('aiBadge'),
  historyDropdown: document.getElementById('historyDropdown'),
};

function showToast(msg, type) {
  els.toast.className = 'toast ' + type;
  if (type === 'loading') els.toast.innerHTML = '<span class="spinner"></span> ' + msg;
  else els.toast.textContent = msg;
}
function hideToast() { els.toast.className = 'toast hidden'; }
function showSkeleton() { els.skeleton.classList.remove('hidden'); }
function hideSkeleton() { els.skeleton.classList.add('hidden'); }

function showStats(items) {
  const total = items.length;
  const sources = new Set(items.map(i => i._source).filter(Boolean));
  const withEmail = items.filter(i => i.email).length;
  const withPhone = items.filter(i => i.phone).length;
  els.statsBar.innerHTML = `
    <div class="stat"><span class="stat-value">${total}</span><span class="stat-label">Results</span></div>
    <div class="stat"><span class="stat-value">${sources.size}</span><span class="stat-label">Sources</span></div>
    <div class="stat"><span class="stat-value">${withEmail}</span><span class="stat-label">Emails</span></div>
    <div class="stat"><span class="stat-value">${withPhone}</span><span class="stat-label">Phones</span></div>
  `;
  els.statsBar.classList.remove('hidden');
}
function hideStats() { els.statsBar.classList.add('hidden'); }
function hideResults() { els.results.classList.add('hidden'); hideStats(); }

// Parse query
function parseQuery(input) {
  let text = input.trim();
  if (!text || text.length < 5) return { searchTerm: text, location: '', keywords: '' };
  const locRegex = /\b(?:in|near|around|at)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/;
  const locMatch = text.match(locRegex);
  let location = '';
  if (locMatch) { location = locMatch[1].trim(); text = text.replace(locMatch[0], '').trim(); }
  text = text.replace(/^(?:find|find me|search|looking for|show me|get|i want|i need|give me|can you find|can you get)\s+/i, '');
  let searchTerm = text;
  let keywords = '';
  const splitRegex = /\s+(?:with|that|that have|that are|near|where|which|and have|and are)\s+/i;
  const splitMatch = text.match(splitRegex);
  if (splitMatch) { searchTerm = text.slice(0, splitMatch.index).trim(); keywords = text.slice(splitMatch.index + splitMatch[0].length).trim(); }
  searchTerm = searchTerm.replace(/[.,!?]+$/g, '').trim();
  if (keywords) keywords = keywords.replace(/[.,!?]+$/g, '').trim();
  const isNatural = !!(locMatch || splitMatch || input.match(/^(?:find|search|looking|show|get|i want|i need|give|can you)/i)) || input.split(/\s+/).length > 2;
  return { searchTerm, location, keywords, isNatural };
}

let parseTimer = null;
els.searchInput.addEventListener('input', () => {
  clearTimeout(parseTimer);
  parseTimer = setTimeout(() => {
    const input = els.searchInput.value;
    const parsed = parseQuery(input);
    if (parsed.isNatural && parsed.searchTerm) {
      els.aiBadge.classList.remove('hidden');
      if (parsed.location) { els.locationInput.value = parsed.location; els.locationInput.classList.add('parsed-highlight'); }
      if (parsed.keywords) { els.keywordsInput.value = parsed.keywords; els.keywordsInput.classList.add('parsed-highlight'); }
    } else { els.aiBadge.classList.add('hidden'); }
  }, 400);
});
els.searchInput.addEventListener('focus', () => { els.aiBadge.classList.add('hidden'); showHistory(); });
els.searchInput.addEventListener('blur', () => setTimeout(() => els.historyDropdown.classList.add('hidden'), 200));
els.locationInput.addEventListener('focus', () => els.locationInput.classList.remove('parsed-highlight'));
els.keywordsInput.addEventListener('focus', () => els.keywordsInput.classList.remove('parsed-highlight'));

// History
function showHistory() {
  const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  if (!history.length) return;
  els.historyDropdown.innerHTML = history.slice(0, 8).map(h =>
    '<div class="history-item" data-q="' + h.q + '" data-loc="' + (h.loc || '') + '">' + escapeHtml(h.q) + '<small>' + h.loc + '</small></div>'
  ).join('');
  els.historyDropdown.classList.remove('hidden');
  els.historyDropdown.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => {
      els.searchInput.value = el.dataset.q;
      els.locationInput.value = el.dataset.loc;
      els.historyDropdown.classList.add('hidden');
    });
  });
}

function saveHistory(q, loc) {
  if (!q) return;
  const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  const existing = history.findIndex(h => h.q === q && h.loc === loc);
  if (existing > -1) history.splice(existing, 1);
  history.unshift({ q, loc, t: Date.now() });
  if (history.length > 20) history.length = 20;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

// Submit
els.searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  let query = els.searchInput.value.trim();
  let location = els.locationInput.value.trim();
  const max = 50;
  if (!query) return;

  const parsed = parseQuery(query);
  if (!location && parsed.location) { location = parsed.location; query = parsed.searchTerm; }
  if (!location) {
    const parts = query.split(/\s+/);
    const lastWord = parts[parts.length - 1];
    if (lastWord && /^[A-Z][a-z]/.test(lastWord) && parts.length > 1) { location = lastWord; query = parts.slice(0, -1).join(' '); }
  }
  if (!query) return;
  if (currentJobId) stopScrape();

  saveHistory(query, location);
  allItems = []; currentItems = []; prevCount = 0;
  activeFilters = {};
  els.cardsView.innerHTML = '';
  els.filterBar.classList.add('hidden');
  els.searchBtn.disabled = true;
  els.searchBtn.textContent = 'Scraping…';
  els.stopBtn.classList.remove('hidden');
  hideResults();
  showToast('Scraping…', 'loading');
  showSkeleton();

  try {
    const body = { searchString: query, maxCrawledPlaces: parseInt(max) };
    if (location) body.locationQuery = location;
    const res = await fetch(API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Failed', 'error'); stopDone(); return; }
    if (data.jobId) { currentJobId = data.jobId; pollResults(); }
    else if (data.items) {
      allItems = data.items; currentItems = data.items; prevCount = data.items.length;
      hideSkeleton();
      if (data.items.length === 0) { showToast('No results found', 'error'); stopDone(); return; }
      buildFilters(data.items); applyFilters();
      showToast(`Found ${data.items.length} results`, 'success');
      stopDone();
    }
  } catch (err) { showToast('Error: ' + err.message, 'error'); stopDone(); }
});

let prevCount = 0;

function pollResults() {
  if (!currentJobId) return;
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${API_URL}/${currentJobId}`);
      const data = await res.json();
      if (!res.ok) { clearInterval(pollTimer); stopDone(); showToast('Error polling', 'error'); return; }
      const items = data.items || [];
      if (items.length > prevCount) {
        allItems = items;
        hideSkeleton();
        els.results.classList.remove('hidden');
        if (prevCount === 0) buildFilters(items);
        applyFilters();
        showToast(`Found ${items.length} results${data.status === 'running' ? '…' : ''}`, 'loading');
        prevCount = items.length;
      }
      if (data.status !== 'running') {
        clearInterval(pollTimer); stopDone();
        if (data.status === 'stopped') showToast('Stopped', 'error');
        else if (items.length === 0) showToast('No results found', 'error');
        else showToast(`Done — ${items.length} results`, 'success');
      }
    } catch (_) { clearInterval(pollTimer); stopDone(); }
  }, 800);
}

function stopScrape() {
  if (currentJobId) fetch(`${API_URL}/${currentJobId}`, { method: 'DELETE' }).catch(() => {});
  clearInterval(pollTimer); stopDone();
}
function stopDone() {
  els.searchBtn.disabled = false; els.searchBtn.textContent = 'Scrape';
  els.stopBtn.classList.add('hidden'); currentJobId = null;
  hideSkeleton(); showToast('Stopped', 'error');
}
els.stopBtn.addEventListener('click', stopScrape);

// Filters
function buildFilters(_items) {
  // Filter bar removed
}
function applyFilters() {
  currentItems = allItems;
  if (!currentItems.length) { els.results.classList.add('hidden'); return; }
  els.results.classList.remove('hidden');
  setupTable(currentItems);
  showStats(currentItems);
}

// Setup table
function setupTable(items) {
  els.cardsView.innerHTML = '';
  appendCards(sortItems(items, sortKey, sortAsc));
  els.resultCount.textContent = '(' + items.length + ')';
}


function appendCards(items) {
  const cardsHtml = items.map(item => {
    const idx = allItems.indexOf(item);
    const title = item.title || item.name || item.author || item.channel || '(no title)';
    const stars = item.stars ? '★'.repeat(Math.round(item.stars)) + '☆'.repeat(5 - Math.round(item.stars)) : '';
    const source = item._source ? '<span class="source-badge source-' + item._source + '">' + (SOURCE_NAMES[item._source] || item._source) + '</span>' : '';
    const email = item.email ? '<span class="card-email">✉ ' + item.email + '</span>' : '';
    const phone = item.phone ? '<span class="card-phone">📞 ' + item.phone + '</span>' : '';
    const website = item.website || item.url || '';
    return '<div class="card new-card" data-idx="' + idx + '">' +
      '<button class="copy-btn" data-json=\'' + escapeAttr(JSON.stringify(item)) + '\' title="Copy">📋</button>' +
      '<div class="card-title">' + title + '</div>' + source +
      (stars ? '<div class="card-stars">' + stars + '</div>' : '') +
      '<div class="card-meta">' +
      (item.price ? '<span>💰 ' + item.price + '</span>' : '') +
      (item.category ? '<span>🏷 ' + item.category + '</span>' : '') +
      (item.address ? '<span>📍 ' + item.address + '</span>' : '') +
      (item.channel ? '<span>📺 ' + item.channel + '</span>' : '') +
      (item.views ? '<span>👁 ' + item.views + '</span>' : '') +
      (item.likes ? '<span>❤ ' + item.likes + '</span>' : '') +
      email + phone +
      '</div>' +
      (website ? '<a href="' + website + '" target="_blank" rel="noopener" class="card-link" onclick="event.stopPropagation()">🔗 Open</a>' : '') +
      '</div>';
  }).join('');
  els.cardsView.insertAdjacentHTML('beforeend', cardsHtml);

  els.cardsView.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', (e) => { if (e.target.closest('.copy-btn') || e.target.closest('a')) return; const idx = parseInt(card.dataset.idx); if (allItems[idx]) openModal(allItems[idx], Object.keys(allItems[idx])); });
  });
  els.cardsView.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); copyResult(btn.dataset.json); });
  });
}

function copyResult(jsonStr) {
  try {
    const obj = JSON.parse(jsonStr);
    const text = Object.entries(obj).filter(([k]) => k !== '_source').map(([k, v]) => k + ': ' + (v || '')).join('\n');
    navigator.clipboard.writeText(text).then(() => showToast('Copied!', 'success')).catch(() => {});
  } catch (_) {}
  setTimeout(() => { if (els.toast.classList.contains('success')) els.toast.classList.add('hidden'); }, 1500);
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


// Modal
function openModal(item, columns) {
  els.modalBody.innerHTML = '<div class="modal-header"><h3>' + (item.title || item.name || 'Details') + '</h3>' +
    (item._source ? '<span class="source-badge source-' + item._source + '">' + (SOURCE_NAMES[item._source] || item._source) + '</span>' : '') + '</div>' +
    columns.filter(c => c !== '_source' && c !== 'searchString').map(c => {
      const val = item[c]; if (val === null || val === undefined) return '';
      const str = String(val); const isUrl = str.match(/^https?:\/\//);
      return '<div class="m-field"><div class="m-label">' + camelToTitle(c) + '</div><div class="m-value">' + (isUrl ? '<a href="' + str + '" target="_blank" rel="noopener">' + str + '</a>' : str) + '</div></div>';
    }).join('') +
    '<button class="btn-secondary" style="margin-top:16px;width:100%" onclick="copyResult(\'' + escapeAttr(JSON.stringify(item)) + '\')">📋 Copy to Clipboard</button>';
  els.modal.classList.remove('hidden');
}
function closeModal() { els.modal.classList.add('hidden'); }
els.modalClose.addEventListener('click', closeModal);
els.modalCloseX.addEventListener('click', closeModal);
els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// Export
els.exportCsvBtn.onclick = () => { exportFormat('csv'); };
els.exportJsonBtn.onclick = () => { exportFormat('json'); };

function exportFormat(fmt) {
  if (!currentItems.length) return;
  const columns = Object.keys(currentItems[0]).filter(c => c !== '_source');
  if (fmt === 'csv') {
    const csvRows = [columns.join(',')];
    currentItems.forEach(item => csvRows.push(columns.map(c => { const v = item[c]; return v === null || v === undefined ? '' : '"' + String(v).replace(/"/g, '""') + '"'; }).join(',')));
    download(new Blob([csvRows.join('\n')], { type: 'text/csv' }), 'scrapex_results.csv');
  } else {
    const clean = currentItems.map(item => { const o = {}; columns.forEach(c => o[c] = item[c]); return o; });
    download(new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' }), 'scrapex_results.json');
  }
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  a.click(); URL.revokeObjectURL(url);
}

function camelToTitle(str) {
  if (str === '_source') return 'Source';
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).replace(/_/g, ' ').trim();
}

function escapeAttr(s) { return s.replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// Restore saved results
function restoreSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && saved.items && saved.items.length) {
      allItems = saved.items; currentItems = saved.items;
      buildFilters(saved.items); applyFilters();
    }
  } catch (_) {}
}
restoreSaved();
