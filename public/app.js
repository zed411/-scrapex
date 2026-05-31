const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? '/api'
  : 'https://scrapex-a017.onrender.com/api';

const TOKEN_KEY = 'scrapex_token';
const EMAIL_KEY = 'scrapex_email';

let activeFilters = { leads: true, web: true, video: true };

// ===== DOM REFS =====
const els = {
  navAuth: document.getElementById('navAuth'),
  navUser: document.getElementById('navUser'),
  navEmail: document.getElementById('navEmail'),
  signInBtn: document.getElementById('signInBtn'),
  signUpBtn: document.getElementById('signUpBtn'),
  signOutBtn: document.getElementById('signOutBtn'),
  searchArea: document.getElementById('searchArea'),
  authCta: document.getElementById('authCta'),
  ctaGetStarted: document.getElementById('ctaGetStarted'),
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  locationInput: document.getElementById('locationInput'),
  keywordsInput: document.getElementById('keywordsInput'),
  searchBtn: document.getElementById('searchBtn'),
  stopBtn: document.getElementById('stopBtn'),
  toast: document.getElementById('toast'),
  presetFilters: document.getElementById('presetFilters'),
  aiBadge: document.getElementById('aiBadge'),
  historyDropdown: document.getElementById('historyDropdown'),
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

// ===== AUTH =====
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }

function updateAuthUI() {
  const token = getToken();
  if (token) {
    els.navAuth.classList.add('hidden');
    els.navUser.classList.remove('hidden');
    els.navEmail.textContent = localStorage.getItem(EMAIL_KEY) || '';
    els.searchArea.classList.remove('hidden');
    els.authCta.classList.add('hidden');
  } else {
    els.navAuth.classList.remove('hidden');
    els.navUser.classList.add('hidden');
    els.searchArea.classList.add('hidden');
    els.authCta.classList.remove('hidden');
  }
}

function openAuth(tab) {
  els.authModal.classList.remove('hidden');
  if (tab === 'register') {
    els.authTabRegister.click();
  } else {
    els.authTabLogin.click();
  }
}

els.signInBtn.addEventListener('click', (e) => { e.preventDefault(); openAuth('login'); });
els.signUpBtn.addEventListener('click', () => openAuth('register'));
els.ctaGetStarted.addEventListener('click', () => openAuth('register'));

els.authModalBg.addEventListener('click', () => els.authModal.classList.add('hidden'));
els.authModalCloseX.addEventListener('click', () => els.authModal.classList.add('hidden'));

els.authTabLogin.addEventListener('click', () => {
  els.authTabLogin.classList.add('active');
  els.authTabRegister.classList.remove('active');
  els.loginForm.classList.remove('hidden');
  els.registerForm.classList.add('hidden');
});

els.authTabRegister.addEventListener('click', () => {
  els.authTabRegister.classList.add('active');
  els.authTabLogin.classList.remove('active');
  els.registerForm.classList.remove('hidden');
  els.loginForm.classList.add('hidden');
});

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.loginError.textContent = '';
  try {
    const res = await fetch(API_URL + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: els.loginEmail.value, password: els.loginPassword.value }),
    });
    const data = await res.json();
    if (!res.ok) { els.loginError.textContent = data.error || 'Login failed'; return; }
    setToken(data.token);
    localStorage.setItem(EMAIL_KEY, data.email || els.loginEmail.value);
    els.authModal.classList.add('hidden');
    updateAuthUI();
  } catch (err) { els.loginError.textContent = 'Connection error'; }
});

els.registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.registerError.textContent = '';
  try {
    const res = await fetch(API_URL + '/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: els.registerEmail.value, password: els.registerPassword.value }),
    });
    const data = await res.json();
    if (!res.ok) { els.registerError.textContent = data.error || 'Registration failed'; return; }
    setToken(data.token);
    localStorage.setItem(EMAIL_KEY, data.email || els.registerEmail.value);
    els.authModal.classList.add('hidden');
    updateAuthUI();
  } catch (err) { els.registerError.textContent = 'Connection error'; }
});

els.signOutBtn.addEventListener('click', () => {
  setToken(null);
  updateAuthUI();
});

updateAuthUI();

// ===== TOAST =====
function showToast(msg, type) {
  els.toast.className = 'toast ' + type;
  if (type === 'loading') els.toast.innerHTML = '<span class="spinner"></span> ' + msg;
  else els.toast.textContent = msg;
}
function hideToast() { els.toast.className = 'toast hidden'; }

// ===== SEARCH FORM =====
function api(url, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(url, { ...options, headers });
}

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

// AI badge
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
    } else els.aiBadge.classList.add('hidden');
  }, 400);
});
els.searchInput.addEventListener('focus', () => { els.aiBadge.classList.add('hidden'); showHistory(); });
els.searchInput.addEventListener('blur', () => setTimeout(() => els.historyDropdown.classList.add('hidden'), 200));
els.locationInput.addEventListener('focus', () => els.locationInput.classList.remove('parsed-highlight'));
els.keywordsInput.addEventListener('focus', () => els.keywordsInput.classList.remove('parsed-highlight'));

// History
const HISTORY_KEY = 'scrapex_history';
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

// Filter chips
const FILTER_NAMES = { 'leads': 'Leads', 'web': 'Web', 'video': 'Video' };
const FILTER_COLORS = { 'leads': '#7c3aed', 'web': '#8b5cf6', 'video': '#a78bfa' };

function renderFilterChips() {
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
      Object.keys(activeFilters).forEach(k => activeFilters[k] = k === s);
      els.presetFilters.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('on', activeFilters[c.dataset.source]));
    });
  });
}
renderFilterChips();

// SUBMIT → redirect to results page
els.searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  let query = els.searchInput.value.trim();
  let location = els.locationInput.value.trim().replace(/^\(|\)$/g, '');
  if (!query) return;

  const parsed = parseQuery(query);
  if (!location && parsed.location) { location = parsed.location; query = parsed.searchTerm; }
  if (!location) {
    const parts = query.split(/\s+/);
    const lastWord = parts[parts.length - 1];
    if (lastWord && /^[A-Z][a-z]/.test(lastWord) && parts.length > 1) { location = lastWord; query = parts.slice(0, -1).join(' '); }
  }
  if (!query) return;

  saveHistory(query, location);

  const selected = Object.entries(activeFilters).filter(([, v]) => v).map(([k]) => k);
  const params = new URLSearchParams({
    q: query,
    loc: location || '',
    types: selected.join(','),
  });
  window.location.href = '/results.html?' + params.toString();
});

// If user is authenticated and we have saved results, show them
function tryRestoreResults() {
  try {
    const saved = JSON.parse(localStorage.getItem('scrapex_results'));
    if (saved && saved.items && saved.items.length) {
      // Don't redirect, just show a hint
      showToast('You have saved results — click New Search to start fresh', 'success');
    }
  } catch (_) {}
}
tryRestoreResults();

// Utils
function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
