const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? '/api'
  : 'https://scrapex-a017.onrender.com/api';

let currentItems = [];
let allItems = [];
let pollTimer = null;
let currentJobId = null;
let searchParams = {};
let viewMode = 'cards';

// ===== PARSE URL PARAMS =====
function getParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    q: p.get('q') || '',
    loc: p.get('loc') || '',
    types: (p.get('types') || 'leads,web,video').split(','),
  };
}

// ===== DOM REFS =====
const els = {
  navAuth: document.getElementById('navAuth'), navUser: document.getElementById('navUser'),
  navEmail: document.getElementById('navEmail'), signInBtn: document.getElementById('signInBtn'),
  signUpBtn: document.getElementById('signUpBtn'), signOutBtn: document.getElementById('signOutBtn'),
  summaryQuery: document.getElementById('summaryQuery'), summaryMeta: document.getElementById('summaryMeta'),
  statusBadge: document.getElementById('statusBadge'), resultTotal: document.getElementById('resultTotal'),
  filterChips: document.getElementById('filterChips'), btnExportCsv: document.getElementById('btnExportCsv'),
  btnSave: document.getElementById('btnSave'), btnRetry: document.getElementById('btnRetry'),
  skeletonArea: document.getElementById('skeletonArea'), statsRow: document.getElementById('statsRow'),
  statTotal: document.getElementById('statTotal'), statSources: document.getElementById('statSources'),
  statEmails: document.getElementById('statEmails'), statPhones: document.getElementById('statPhones'),
  viewToggle: document.getElementById('viewToggle'), viewCardsBtn: document.getElementById('viewCardsBtn'),
  viewTableBtn: document.getElementById('viewTableBtn'), cardsArea: document.getElementById('cardsArea'),
  tableArea: document.getElementById('tableArea'), tableHead: document.getElementById('tableHead'),
  tableBody: document.getElementById('tableBody'), emptyState: document.getElementById('emptyState'),
  toast: document.getElementById('toast'), detailModal: document.getElementById('detailModal'),
  detailModalBg: document.getElementById('detailModalBg'), detailModalCloseX: document.getElementById('detailModalCloseX'),
  detailModalBody: document.getElementById('detailModalBody'),
};

// ===== INIT =====
function init() {
  searchParams = getParams();
  if (!searchParams.q) {
    showEmpty();
    return;
  }

  // Update summary
  els.summaryQuery.textContent = searchParams.q;
  const meta = [];
  if (searchParams.loc) meta.push('📍 ' + searchParams.loc);
  meta.push(searchParams.types.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(', '));
  els.summaryMeta.textContent = meta.join(' · ');

  renderFilterChips();
  startSearch();
}

// ===== API =====
function getToken() { return localStorage.getItem('***'); }
function apiFetch(url, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(url, { ...opts, headers });
}

// ===== SEARCH =====
async function startSearch() {
  showLoading();
  els.statusBadge.textContent = 'Scraping…';
  els.statusBadge.className = 'status-badge running';

  try {
    const body = {
      searchString: searchParams.q,
      maxCrawledPlaces: 50,
      templates: searchParams.types,
    };
    if (searchParams.loc) body.locationQuery = searchParams.loc;

    const res = await apiFetch(API_URL + '/scrape', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Search failed', 'error'); stopDone(); return; }

    if (data.jobId) {
      currentJobId = data.jobId;
      pollResults();
    } else if (data.items) {
      allItems = data.items;
      currentItems = data.items;
      hideLoading();
      if (data.items.length === 0) { showToast('No results found', 'error'); stopDone(); return; }
      renderAll();
      showToast('Found ' + data.items.length + ' results', 'success');
      stopDone();
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    stopDone();
  }
}

function pollResults() {
  if (!currentJobId) return;
  let prevCount = 0;
  pollTimer = setInterval(async () => {
    try {
      const res = await apiFetch(API_URL + '/scrape/' + currentJobId);
      const data = await res.json();
      if (!res.ok) { clearInterval(pollTimer); showToast('Connection lost', 'error'); stopDone(); return; }
      const items = data.items || [];
      if (items.length > prevCount) {
        allItems = items;
        hideLoading();
        renderAll();
        els.statusBadge.textContent = 'Scraping… ' + items.length + ' found';
        prevCount = items.length;
      }
      if (data.status !== 'running') {
        clearInterval(pollTimer);
        if (data.status === 'stopped') showToast('Stopped', 'error');
        else if (items.length === 0) showToast('No results found', 'error');
        else showToast('Done — ' + items.length + ' results', 'success');
        stopDone();
      }
    } catch (_) {}
  }, 800);
}

function stopDone() {
  currentJobId = null;
  els.statusBadge.textContent = allItems.length + ' results';
  els.statusBadge.className = 'status-badge done';
}

// ===== RENDER =====
function renderAll() {
  currentItems = allItems;
  els.resultTotal.textContent = allItems.length + ' results';
  renderStats();
  renderCards();
  renderTable();
  els.statsRow.classList.remove('hidden');
  els.viewToggle.classList.remove('hidden');
}

function renderStats() {
  const total = allItems.length;
  const sources = new Set(allItems.map(i => i._source).filter(Boolean));
  const withEmail = allItems.filter(i => i.email).length;
  const withPhone = allItems.filter(i => i.phone).length;
  els.statTotal.textContent = total;
  els.statSources.textContent = sources.size;
  els.statEmails.textContent = withEmail;
  els.statPhones.textContent = withPhone;
}

const SOURCE_NAMES = { 'leads': 'Leads', 'web': 'Web', 'video': 'Video' };
const SOURCE_COLORS = { 'leads': '#7c3aed', 'web': '#8b5cf6', 'video': '#a78bfa' };

function renderCards() {
  const html = allItems.map((item, idx) => {
    const title = item.title || item.name || item.author || item.channel || '(no title)';
    const stars = item.stars ? '★'.repeat(Math.round(item.stars)) + '☆'.repeat(5 - Math.round(item.stars)) : '';
    const source = item._source ? '<span class="source-badge" style="background:' + (SOURCE_COLORS[item._source] || '#888') + '">' + (SOURCE_NAMES[item._source] || item._source) + '</span>' : '';
    const email = item.email ? '<a href="mailto:' + item.email + '" class="res-email" onclick="event.stopPropagation()">✉ ' + item.email + '</a>' : '';
    const phone = item.phone ? '<a href="tel:' + item.phone.replace(/[^\d+]/g, '') + '" class="res-phone" onclick="event.stopPropagation()">📞 ' + item.phone + '</a>' : '';
    const website = item.website || item.url || '';
    return '<div class="res-card" data-idx="' + idx + '">' +
      '<button class="copy-btn" data-json=\'' + JSON.stringify(item).replace(/'/g, "\\'") + '\' title="Copy">📋</button>' +
      '<div class="res-card-title">' + title + '</div>' + source +
      (stars ? '<div class="res-stars">' + stars + '</div>' : '') +
      '<div class="res-meta">' +
        (item.price ? '<span>💰 ' + item.price + '</span>' : '') +
        (item.category ? '<span>🏷 ' + item.category + '</span>' : '') +
        (item.address ? '<span>📍 ' + item.address + '</span>' : '') +
        (item.channel ? '<span>📺 ' + item.channel + '</span>' : '') +
        (item.views ? '<span>👁 ' + item.views + '</span>' : '') +
        email + phone +
      '</div>' +
      (website ? '<a href="' + website + '" target="_blank" rel="noopener" class="res-link" onclick="event.stopPropagation()">🔗 Open</a>' : '') +
      '</div>';
  }).join('');
  els.cardsArea.innerHTML = html;

  els.cardsArea.querySelectorAll('.res-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.copy-btn') || e.target.closest('a')) return;
      const idx = parseInt(card.dataset.idx);
      if (allItems[idx]) openDetail(allItems[idx]);
    });
  });
  els.cardsArea.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); copyResult(btn.dataset.json); });
  });
}

function renderTable() {
  if (!allItems.length) return;
  const cols = [...new Set(allItems.flatMap(i => Object.keys(i)))].filter(c => c !== '_searchString');
  els.tableHead.innerHTML = '<tr>' + cols.map(c => '<th>' + camelToTitle(c) + '</th>').join('') + '</tr>';
  els.tableBody.innerHTML = allItems.map(item =>
    '<tr>' + cols.map(c => {
      const v = item[c];
      if (v === null || v === undefined) return '<td></td>';
      const str = String(v);
      if (str.match(/^https?:\/\//)) return '<td><a href="' + str + '" target="_blank" rel="noopener">' + str.slice(0, 40) + '…</a></td>';
      return '<td>' + str.slice(0, 60) + (str.length > 60 ? '…' : '') + '</td>';
    }).join('') + '</tr>'
  ).join('');
}

// ===== FILTER CHIPS =====
const FILTER_LABELS = { leads: 'Leads', web: 'Web', video: 'Video' };
function renderFilterChips() {
  const sources = ['leads', 'web', 'video'];
  els.filterChips.innerHTML = sources.map(s =>
    '<div class="filter-chip on" data-source="' + s + '">' +
    '<span class="filter-dot" style="background:' + SOURCE_COLORS[s] + '"></span>' +
    FILTER_LABELS[s] + '</div>'
  ).join('');
  els.filterChips.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('on');
      const active = [...els.filterChips.querySelectorAll('.filter-chip.on')].map(c => c.dataset.source);
      currentItems = active.length ? allItems.filter(i => active.includes(i._source)) : allItems;
      renderCards();
      renderTable();
      renderStats();
    });
  });
}

// ===== VIEW TOGGLE =====
els.viewCardsBtn.addEventListener('click', () => {
  viewMode = 'cards';
  els.viewCardsBtn.classList.add('active');
  els.viewTableBtn.classList.remove('active');
  els.cardsArea.classList.remove('hidden');
  els.tableArea.classList.add('hidden');
});
els.viewTableBtn.addEventListener('click', () => {
  viewMode = 'table';
  els.viewTableBtn.classList.add('active');
  els.viewCardsBtn.classList.remove('active');
  els.tableArea.classList.remove('hidden');
  els.cardsArea.classList.add('hidden');
});

// ===== EXPORT =====
els.btnExportCsv.addEventListener('click', () => {
  const items = currentItems.length ? currentItems : allItems;
  if (!items.length) return;
  const cols = [...new Set(items.flatMap(i => Object.keys(i)))].filter(c => c !== '_searchString');
  const rows = [cols.join(',')];
  items.forEach(item => rows.push(cols.map(c => {
    const v = item[c];
    return v === null || v === undefined ? '' : '"' + String(v).replace(/"/g, '""') + '"';
  }).join(',')));
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'scrapex_results.csv';
  a.click(); URL.revokeObjectURL(url);
  showToast('CSV exported!', 'success');
});

// ===== SAVE =====
els.btnSave.addEventListener('click', () => {
  const items = currentItems.length ? currentItems : allItems;
  if (!items.length) return;
  localStorage.setItem('scrapex_results', JSON.stringify({
    items,
    query: searchParams.q,
    location: searchParams.loc,
    types: searchParams.types,
    timestamp: Date.now(),
  }));
  showToast('Results saved!', 'success');
});

// ===== RETRY =====
els.btnRetry.addEventListener('click', () => {
  window.location.reload();
});

// ===== DETAIL MODAL =====
function openDetail(item) {
  const cols = Object.keys(item).filter(c => c !== '_searchString');
  els.detailModalBody.innerHTML =
    '<div class="modal-header"><h3>' + (item.title || item.name || 'Details') + '</h3>' +
    (item._source ? '<span class="source-badge" style="background:' + (SOURCE_COLORS[item._source] || '#888') + '">' + (SOURCE_NAMES[item._source] || item._source) + '</span>' : '') + '</div>' +
    cols.filter(c => c !== '_source').map(c => {
      const v = item[c];
      if (v === null || v === undefined) return '';
      const str = String(v);
      const isUrl = str.match(/^https?:\/\//);
      return '<div class="m-field"><div class="m-label">' + camelToTitle(c) + '</div><div class="m-value">' +
        (isUrl ? '<a href="' + str + '" target="_blank" rel="noopener">' + str + '</a>' : str) +
        '</div></div>';
    }).join('') +
    '<button class="btn-secondary" style="margin-top:16px;width:100%" onclick="copyResult(\'' + JSON.stringify(item).replace(/'/g, "\\" ) + '\')">📋 Copy to Clipboard</button>';
  els.detailModal.classList.remove('hidden');
}
els.detailModalBg.addEventListener('click', () => els.detailModal.classList.add('hidden'));
els.detailModalCloseX.addEventListener('click', () => els.detailModal.classList.add('hidden'));

// ===== TOAST & HELPERS =====
function showToast(msg, type) {
  els.toast.className = 'toast ' + type;
  els.toast.textContent = msg;
  setTimeout(() => { els.toast.className = 'toast hidden'; }, 3000);
}

function showLoading() {
  els.skeletonArea.classList.remove('hidden');
  els.statsRow.classList.add('hidden');
  els.viewToggle.classList.add('hidden');
  els.cardsArea.innerHTML = '';
  els.tableArea.classList.add('hidden');
  els.emptyState.classList.add('hidden');
}

function hideLoading() {
  els.skeletonArea.classList.add('hidden');
}

function showEmpty() {
  els.emptyState.classList.remove('hidden');
  els.statsRow.classList.add('hidden');
  els.viewToggle.classList.add('hidden');
  els.skeletonArea.classList.add('hidden');
}

function copyResult(jsonStr) {
  try {
    const obj = JSON.parse(jsonStr);
    const text = Object.entries(obj).filter(([k]) => k !== '_source').map(([k, v]) => k + ': ' + (v || '')).join('\n');
    navigator.clipboard.writeText(text).then(() => showToast('Copied!', 'success')).catch(() => {});
  } catch (_) {}
}

function camelToTitle(str) {
  if (str === '_source') return 'Source';
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).replace(/_/g, ' ').trim();
}

// ===== INIT =====
init();
