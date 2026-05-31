const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? '/api/scrape'
  : 'https://scrapex-a017.onrender.com/api/scrape';
const BASE_URL = API_URL.replace('/api/scrape', '/api');

const SOURCE_COLORS = { 'leads': '#7c3aed', 'web': '#8b5cf6', 'video': '#a78bfa' };
const SOURCE_NAMES = { 'leads': 'Leads', 'web': 'Web', 'video': 'Video' };
const STORE_KEY = 'scrapex_results';
const HISTORY_KEY = 'scrapex_history';
const TOKEN_KEY = 'scrapex_token';

let currentItems = [];
let allItems = [];
let isCardView = true;
let sortKey = '';
let sortAsc = true;
let pollTimer = null;
let currentJobId = null;
let activeFilters = { leads: true, web: true, video: true };

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }

function api(url, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(url, { ...options, headers });
}

const els = {
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  locationInput: document.getElementById('locationInput'),
  keywordsInput: document.getElementById('keywordsInput'),
  searchBtn: document.getElementById('searchBtn'),
  stopBtn: document.getElementById('stopBtn'),
  toast: document.getElementById('toast'),
  statsBar: document.getElementById('statsBar'),
  skeleton: document.getElementById('skeleton'),
  results: document.getElementById('results'),
  cardsView: document.getElementById('cardsView'),
  resultCount: document.getElementById('resultCount'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  modal: document.getElementById('modal'),
  modalBody: document.getElementById('modalBody'),
  modalClose: document.getElementById('modalClose'),
  modalCloseX: document.getElementById('modalCloseX'),
  aiBadge: document.getElementById('aiBadge'),
  historyDropdown: document.getElementById('historyDropdown'),
  presetFilters: document.getElementById('presetFilters'),
  authCta: document.getElementById('authCta'),
  authCtaBtn: document.getElementById('authCtaBtn'),
  navAuth: document.getElementById('navAuth'),
  navUser: document.getElementById('navUser'),
  navEmail: document.getElementById('navEmail'),
  signInBtn: document.getElementById('signInBtn'),
  signUpBtn: document.getElementById('signUpBtn'),
  signOutBtn: document.getElementById('signOutBtn'),
  authModal: document.getElementById('authModal'),
  authModalBg: document.getElementById('authModalBg'),
  authModalCloseX: document.getElementById('authModalCloseX'),
  authTabLogin: document.getElementById('authTabLogin'),
  authTabRegister: document.getElementById('authTabRegister'),
  loginForm: document.getElementById('loginForm'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  loginError: document.getElementById('loginError'),
  registerForm: document.getElementById('registerForm'),
  registerEmail: document.getElementById('registerEmail'),
  registerPassword: document.getElementById('registerPassword'),
  registerError: document.getElementById('registerError'),
};

// Auth state
let isAuthenticated = false;

function showAuth() {
  if (els.navAuth) { els.navAuth.classList.add('hidden'); els.navUser.classList.remove('hidden'); }
  if (els.authCta) { els.authCta.classList.add('hidden'); els.searchForm.classList.remove('hidden'); }
  if (els.navEmail) els.navEmail.textContent = getToken() ? (localStorage.getItem('scrapex_email') || '') : '';
  isAuthenticated = true;
}

function hideAuth() {
  if (els.navAuth) { els.navAuth.classList.remove('hidden'); els.navUser.classList.add('hidden'); }
  if (els.authCta) { els.authCta.classList.remove('hidden'); els.searchForm.classList.add('hidden'); }
  isAuthenticated = false;
}

async function checkAuth() {
  const token = getToken();
  if (!token) { hideAuth(); return; }
  try {
    const res = await api(BASE_URL + '/auth/me');
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('scrapex_email', data.email);
      showAuth();
    } else {
      setToken(null);
      localStorage.removeItem('scrapex_email');
      hideAuth();
    }
  } catch {
    hideAuth();
  }
}

function openAuthModal(tab) {
  els.authModal.classList.remove('hidden');
  if (tab === 'register') switchAuthTab('register');
  else switchAuthTab('login');
}

function closeAuthModal() { els.authModal.classList.add('hidden'); }

function switchAuthTab(tab) {
  if (tab === 'register') {
    els.authTabRegister.classList.add('active');
    els.authTabLogin.classList.remove('active');
    els.registerForm.classList.remove('hidden');
    els.loginForm.classList.add('hidden');
    els.loginError.textContent = '';
    els.registerError.textContent = '';
  } else {
    els.authTabLogin.classList.add('active');
    els.authTabRegister.classList.remove('active');
    els.loginForm.classList.remove('hidden');
    els.registerForm.classList.add('hidden');
    els.loginError.textContent = '';
    els.registerError.textContent = '';
  }
}

els.authTabLogin.addEventListener('click', () => switchAuthTab('login'));
els.authTabRegister.addEventListener('click', () => switchAuthTab('register'));
els.authModalBg.addEventListener('click', closeAuthModal);
els.authModalCloseX.addEventListener('click', closeAuthModal);

els.signInBtn.addEventListener('click', () => openAuthModal('login'));
els.signUpBtn.addEventListener('click', () => openAuthModal('register'));
els.authCtaBtn.addEventListener('click', () => openAuthModal('register'));

els.signOutBtn.addEventListener('click', () => {
  setToken(null);
  localStorage.removeItem('scrapex_email');
  localStorage.removeItem(STORE_KEY);
  localStorage.removeItem(HISTORY_KEY);
  hideAuth();
  allItems = []; currentItems = [];
  els.cardsView.innerHTML = '';
  hideResults();
  hideStats();
});

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.loginError.textContent = '';
  const email = els.loginEmail.value.trim();
  const password = els.loginPassword.value;
  if (!email || !password) return;
  try {
    const res = await api(BASE_URL + '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { els.loginError.textContent = 'Server error: ' + text.substring(0, 120); return; }
    if (!res.ok) { els.loginError.textContent = data.error || 'Login failed'; return; }
    setToken(data.token);
    localStorage.setItem('scrapex_email', data.email);
    closeAuthModal();
    showAuth();
    showToast('Signed in as ' + data.email, 'success');
  } catch (err) { els.loginError.textContent = 'Network error: ' + err.message; }
});

els.registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.registerError.textContent = '';
  const email = els.registerEmail.value.trim();
  const password = els.registerPassword.value;
  if (!email || !password) return;
  if (password.length < 6) { els.registerError.textContent = 'Password must be at least 6 characters'; return; }
  try {
    const res = await api(BASE_URL + '/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { els.registerError.textContent = 'Server error: ' + text.substring(0, 120); return; }
    if (!res.ok) { els.registerError.textContent = data.error || 'Registration failed'; return; }
    setToken(data.token);
    localStorage.setItem('scrapex_email', data.email);
    closeAuthModal();
    showAuth();
    showToast('Account created! Welcome ' + data.email, 'success');
  } catch (err) { els.registerError.textContent = 'Network error: ' + err.message; }
});

// Toast
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
  const locRegex = /\b(?:in|near|around|at)\s+([A-Za-z][a-zA-Z]*(?:\s+[A-Za-z][a-zA-Z]*)*)/;
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
      if (parsed.location) { els.locationInput.value = '(' + parsed.location + ')'; els.locationInput.classList.add('parsed-highlight'); }
      if (parsed.keywords) { els.keywordsInput.value = '(' + parsed.keywords + ')'; els.keywordsInput.classList.add('parsed-highlight'); }
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
  let location = els.locationInput.value.trim().replace(/^\(|\)$/g, '');
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
  const selected = Object.entries(activeFilters).filter(([, v]) => v).map(([k]) => k);
  allItems = []; currentItems = []; prevCount = 0;
  activeFilters = { leads: true, web: true, video: true };
  els.cardsView.innerHTML = '';
  els.searchBtn.disabled = true;
  els.searchBtn.textContent = 'Launching…';
  els.stopBtn.classList.remove('hidden');
  hideResults();
  showToast('Scraping…', 'loading');
  showSkeleton();

  try {
    const body = { searchString: query, maxCrawledPlaces: parseInt(max), templates: selected };
    if (location) body.locationQuery = location;
    const res = await api(API_URL, {
      method: 'POST', body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Failed', 'error'); stopDone(); return; }
    if (data.jobId) { currentJobId = data.jobId; pollResults(); }
    else if (data.items) {
      allItems = data.items; currentItems = data.items; prevCount = data.items.length;
      hideSkeleton();
      if (data.items.length === 0) { showToast('No results found', 'error'); stopDone(); return; }
      renderSourceFilters(); applyFilters();
      showToast('Found ' + data.items.length + ' results', 'success');
      stopDone();
    }
  } catch (err) { showToast('Error: ' + err.message, 'error'); stopDone(); }
});

let prevCount = 0;

function pollResults() {
  if (!currentJobId) return;
  pollTimer = setInterval(async () => {
    try {
      const res = await api(API_URL + '/' + currentJobId);
      const data = await res.json();
      if (!res.ok) {
        clearInterval(pollTimer);
        if (res.status === 404) showToast('Server restarted — try again', 'error');
        else showToast('Connection lost', 'error');
        stopDone(); return;
      }
      const items = data.items || [];
      if (items.length > prevCount) {
        const newItems = items.slice(prevCount);
        allItems = items;
        hideSkeleton();
        els.results.classList.remove('hidden');
        if (prevCount === 0) renderSourceFilters();
        applyFilters(newItems);
        showToast('Found ' + items.length + ' results' + (data.status === 'running' ? '…' : ''), 'loading');
        prevCount = items.length;
      }
      if (data.status !== 'running') {
        clearInterval(pollTimer); stopDone();
        if (data.status === 'stopped') showToast('Stopped', 'error');
        else if (items.length === 0) showToast('No results found', 'error');
        else showToast('Done — ' + items.length + ' results', 'success');
      }
    } catch (_) { /* ignore transient errors */ }
  }, 800);
}

function stopScrape() {
  if (currentJobId) api(API_URL + '/' + currentJobId, { method: 'DELETE' }).catch(() => {});
  clearInterval(pollTimer); stopDone();
}
function stopDone() {
  els.searchBtn.disabled = false; els.searchBtn.textContent = 'Launch';
  els.stopBtn.classList.add('hidden'); currentJobId = null;
  hideSkeleton(); showToast('Stopped', 'error');
}
els.stopBtn.addEventListener('click', stopScrape);

// Source filters
const FILTER_NAMES = { 'leads': 'Leads', 'web': 'Web', 'video': 'Video' };
const FILTER_COLORS = { 'leads': '#7c3aed', 'web': '#8b5cf6', 'video': '#a78bfa' };

function renderSourceFilters() {
  const sources = ['leads', 'web', 'video'];
  els.presetFilters.innerHTML = sources.map(s =>
    '<div class="filter-chip ' + (activeFilters[s] ? 'on' : '') + '" data-source="' + s + '">' +
    '<span class="filter-dot" style="background:' + (FILTER_COLORS[s] || '#888') + '"></span>' +
    (FILTER_NAMES[s] || s) + '</div>'
  ).join('');
  els.presetFilters.classList.remove('hidden');

  els.presetFilters.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const s = chip.dataset.source;
      const activeSources = Object.keys(activeFilters).filter(k => activeFilters[k]);
      if (activeSources.length === 1 && activeSources[0] === s) {
        Object.keys(activeFilters).forEach(k => activeFilters[k] = true);
      } else {
        Object.keys(activeFilters).forEach(k => activeFilters[k] = k === s);
      }
      els.presetFilters.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('on', activeFilters[c.dataset.source]));
      if (allItems.length) renderFiltered();
    });
  });
}

function renderFiltered() {
  const active = Object.entries(activeFilters).filter(([, v]) => v).map(([k]) => k);
  const filtered = active.length ? allItems.filter(i => active.includes(i._source)) : allItems;
  currentItems = filtered;
  els.cardsView.innerHTML = '';
  appendCards(filtered);
  els.resultCount.textContent = '(' + filtered.length + ')';
  showStats(filtered);
}

function applyFilters(newItems) {
  if (!allItems.length) { els.results.classList.add('hidden'); return; }
  els.results.classList.remove('hidden');
  if (newItems && prevCount > 0) {
    appendCards(newItems.filter(i => {
      const active = Object.entries(activeFilters).filter(([, v]) => v).map(([k]) => k);
      return active.includes(i._source);
    }));
  } else {
    renderSourceFilters();
    renderFiltered();
  }
}

function appendCards(items) {
  const cardsHtml = items.map(item => {
    const idx = allItems.indexOf(item);
    const title = item.title || item.name || item.author || item.channel || '(no title)';
    const stars = item.stars ? '&#9733;'.repeat(Math.round(item.stars)) + '&#9734;'.repeat(5 - Math.round(item.stars)) : '';
    const source = item._source ? '<span class="source-badge source-' + item._source + '">' + (SOURCE_NAMES[item._source] || item._source) + '</span>' : '';
    const email = item.email ? '<a href="mailto:' + item.email + '" class="card-email" onclick="event.stopPropagation()">&#9993; ' + item.email + '</a>' : '';
    const phone = item.phone ? '<a href="tel:' + item.phone.replace(/[^\d+]/g, '') + '" class="card-phone" onclick="event.stopPropagation()">&#128222; ' + item.phone + '</a>' : '';
    const website = item.website || item.url || '';
    return '<div class="card new-card" data-idx="' + idx + '">' +
      '<button class="copy-btn" data-json=\'' + escapeAttr(JSON.stringify(item)) + '\' title="Copy">&#128203;</button>' +
      '<div class="card-title">' + title + '</div>' + source +
      (stars ? '<div class="card-stars">' + stars + '</div>' : '') +
      '<div class="card-meta">' +
      (item.price ? '<span>&#128176; ' + item.price + '</span>' : '') +
      (item.category ? '<span>&#127991; ' + item.category + '</span>' : '') +
      (item.address ? '<span>&#128205; ' + item.address + '</span>' : '') +
      (item.channel ? '<span>&#128250; ' + item.channel + '</span>' : '') +
      (item.views ? '<span>&#128065; ' + item.views + '</span>' : '') +
      (item.likes ? '<span>&#10084; ' + item.likes + '</span>' : '') +
      email + phone +
      '</div>' +
      (website ? '<a href="' + website + '" target="_blank" rel="noopener" class="card-link" onclick="event.stopPropagation()">&#128279; Open</a>' : '') +
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

// Modal
function openModal(item, columns) {
  els.modalBody.innerHTML = '<div class="modal-header"><h3>' + (item.title || item.name || 'Details') + '</h3>' +
    (item._source ? '<span class="source-badge source-' + item._source + '">' + (SOURCE_NAMES[item._source] || item._source) + '</span>' : '') + '</div>' +
    columns.filter(c => c !== '_source' && c !== 'searchString').map(c => {
      const val = item[c]; if (val === null || val === undefined) return '';
      const str = String(val); const isUrl = str.match(/^https?:\/\//);
      const isPhone = c === 'phone' && str.replace(/[^\d+]/g, '').length > 5;
      return '<div class="m-field"><div class="m-label">' + camelToTitle(c) + '</div><div class="m-value">' + (isUrl ? '<a href="' + str + '" target="_blank" rel="noopener">' + str + '</a>' : isPhone ? '<a href="tel:' + str.replace(/[^\d+]/g, '') + '">' + str + '</a>' : str) + '</div></div>';
    }).join('') +
    '<button class="btn-secondary" style="margin-top:16px;width:100%" onclick="copyResult(\'' + escapeAttr(JSON.stringify(item)) + '\')">&#128203; Copy to Clipboard</button>';
  els.modal.classList.remove('hidden');
}
function closeModal() { els.modal.classList.add('hidden'); }
els.modalClose.addEventListener('click', closeModal);
els.modalCloseX.addEventListener('click', closeModal);
els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// Export
els.exportCsvBtn.onclick = () => { exportFormat('csv'); };

function exportFormat(fmt) {
  if (!currentItems.length) return;
  const columns = Object.keys(currentItems[0]).filter(c => c !== '_source');
  const csvRows = [columns.join(',')];
  currentItems.forEach(item => csvRows.push(columns.map(c => { const v = item[c]; return v === null || v === undefined ? '' : '"' + String(v).replace(/"/g, '""') + '"'; }).join(',')));
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  download(blob, 'scrapex_results.csv');
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

function restoreSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && saved.items && saved.items.length) {
      allItems = saved.items; currentItems = saved.items;
      renderSourceFilters(); applyFilters();
    }
  } catch (_) {}
}

// Init
checkAuth();
restoreSaved();
renderSourceFilters();
