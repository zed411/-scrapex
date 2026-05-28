const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? '/api/scrape'
  : 'https://scrapex-production-2b35.up.railway.app/api/scrape';

let currentItems = [];
let isCardView = false;
let sortKey = '';
let sortAsc = true;
let pollTimer = null;
let currentJobId = null;

const els = {
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  locationInput: document.getElementById('locationInput'),
  keywordsInput: document.getElementById('keywordsInput'),
  maxResults: document.getElementById('maxResults'),
  searchBtn: document.getElementById('searchBtn'),
  stopBtn: document.getElementById('stopBtn'),
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
  aiBadge: document.getElementById('aiBadge'),
};

// Toast
function showToast(msg, type) {
  els.toast.className = 'toast ' + type;
  if (type === 'loading') els.toast.innerHTML = '<span class="spinner"></span> ' + msg;
  else els.toast.textContent = msg;
}
function hideToast() { els.toast.className = 'toast hidden'; }

// Skeleton
function showSkeleton() { els.skeleton.classList.remove('hidden'); }
function hideSkeleton() { els.skeleton.classList.add('hidden'); }

// Stats
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
        const newItems = items.slice(prevCount);
        currentItems = items;

        hideSkeleton();
        els.results.classList.remove('hidden');
        showStats(currentItems);
        showToast(`Found ${items.length} results${data.status === 'running' ? '…' : ''}`, 'loading');
        els.resultCount.textContent = '(' + items.length + ')';

        if (prevCount === 0) {
          // First batch — render header + all items
          setupTable(items);
        } else {
          // Subsequent batches — append only new items
          appendTableRows(newItems);
          appendCards(newItems);
        }
        prevCount = items.length;
      }

      if (data.status !== 'running') {
        clearInterval(pollTimer);
        stopDone();
        if (data.status === 'stopped') showToast('Stopped', 'error');
        else if (items.length === 0) showToast('No results found', 'error');
        else showToast(`Done — ${items.length} results`, 'success');
      }
    } catch (_) { clearInterval(pollTimer); stopDone(); }
  }, 800);
}

function stopScrape() {
  if (currentJobId) {
    fetch(`${API_URL}/${currentJobId}`, { method: 'DELETE' }).catch(() => {});
  }
  clearInterval(pollTimer);
  stopDone();
}

function stopDone() {
  els.searchBtn.disabled = false;
  els.searchBtn.textContent = 'Scrape';
  els.stopBtn.classList.add('hidden');
  currentJobId = null;
  hideSkeleton();
  showToast('Stopped', 'error');
}

els.stopBtn.addEventListener('click', stopScrape);

// Smart query parser
function parseQuery(input) {
  let text = input.trim();
  if (!text || text.length < 5) return { searchTerm: text, location: '', keywords: '' };

  const locRegex = /\b(?:in|near|around|at)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/;
  const locMatch = text.match(locRegex);

  let location = '';
  if (locMatch) {
    location = locMatch[1].trim();
    text = text.replace(locMatch[0], '').trim();
  }

  text = text.replace(/^(?:find|find me|search|looking for|show me|get|i want|i need|give me|can you find|can you get)\s+/i, '');

  let searchTerm = text;
  let keywords = '';

  const splitRegex = /\s+(?:with|that|that have|that are|near|where|which|and have|and are)\s+/i;
  const splitMatch = text.match(splitRegex);
  if (splitMatch) {
    searchTerm = text.slice(0, splitMatch.index).trim();
    keywords = text.slice(splitMatch.index + splitMatch[0].length).trim();
  }

  searchTerm = searchTerm.replace(/[.,!?]+$/g, '').trim();
  if (keywords) keywords = keywords.replace(/[.,!?]+$/g, '').trim();

  const isNatural = !!(locMatch || splitMatch || input.match(/^(?:find|search|looking|show|get|i want|i need|give|can you)/i));

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
      if (parsed.location) {
        els.locationInput.value = parsed.location;
        els.locationInput.classList.add('parsed-highlight');
      }
      if (parsed.keywords) {
        els.keywordsInput.value = parsed.keywords;
        els.keywordsInput.classList.add('parsed-highlight');
      }
    } else {
      els.aiBadge.classList.add('hidden');
    }
  }, 400);
});

els.searchInput.addEventListener('focus', () => { els.aiBadge.classList.add('hidden'); });
els.locationInput.addEventListener('focus', () => els.locationInput.classList.remove('parsed-highlight'));
els.keywordsInput.addEventListener('focus', () => els.keywordsInput.classList.remove('parsed-highlight'));

// Update search to use parsed values
els.searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  let query = els.searchInput.value.trim();
  let location = els.locationInput.value.trim();
  const max = els.maxResults.value || 5;
  if (!query) return;

  // Parse if fields are empty
  const parsed = parseQuery(query);
  if (!location && parsed.location) {
    location = parsed.location;
    query = parsed.searchTerm;
  }
  if (!location) {
    const parts = query.split(/\s+/);
    // If last word looks like a location (capitalized or common city pattern)
    const lastWord = parts[parts.length - 1];
    if (lastWord && /^[A-Z][a-z]/.test(lastWord) && parts.length > 1) {
      location = lastWord;
      query = parts.slice(0, -1).join(' ');
    }
  }

  if (!query) return;

  if (currentJobId) stopScrape();

  currentItems = [];
  prevCount = 0;
  els.tableBody.innerHTML = '';
  els.cardsView.innerHTML = '';
  els.searchBtn.disabled = true;
  els.searchBtn.textContent = 'Scraping…';
  els.stopBtn.classList.remove('hidden');
  hideResults();
  hideToast();
  showSkeleton();

  try {
    const body = { searchString: query, maxCrawledPlaces: parseInt(max) };
    if (location) body.locationQuery = location;

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Failed', 'error'); stopDone(); return; }

    // Handle both new job-based API and old synchronous API
    if (data.jobId) {
      currentJobId = data.jobId;
      pollResults();
    } else if (data.items) {
      // Old API — results are already here
      currentItems = data.items;
      prevCount = data.items.length;
      hideSkeleton();
      if (data.items.length === 0) { showToast('No results found', 'error'); stopDone(); return; }
      setupTable(data.items);
      els.results.classList.remove('hidden');
      showStats(data.items);
      showToast(`Found ${data.items.length} results`, 'success');
      stopDone();
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    stopDone();
  }
});
function setupTable(items) {
  const keys = new Set();
  items.forEach(item => Object.keys(item).forEach(k => keys.add(k)));
  const columns = Array.from(keys);

  els.tableHead.innerHTML = '<tr>' + columns.map(c =>
    '<th data-key="' + c + '" class="' + (sortKey === c ? 'sorted' : '') + '">' + camelToTitle(c) + (sortKey === c ? (sortAsc ? ' ▲' : ' ▼') : '') + '</th>'
  ).join('') + '</tr>';

  els.tableHead.querySelectorAll('th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (sortKey === key) sortAsc = !sortAsc;
      else { sortKey = key; sortAsc = true; }
      // Re-sort and re-render all
      currentItems = sortItems([...currentItems], key, sortAsc);
      prevCount = 0;
      els.tableBody.innerHTML = '';
      els.cardsView.innerHTML = '';
      appendTableRows(currentItems);
      appendCards(currentItems);
    });
  });

  els.tableBody.innerHTML = '';
  els.cardsView.innerHTML = '';
  appendTableRows(items);
  appendCards(items);
}

function appendTableRows(items) {
  const columns = Object.keys(currentItems[0] || {});
  const rows = items.map((item, i) => {
    const globalIdx = currentItems.indexOf(item);
    return '<tr class="clickable new-row" data-idx="' + globalIdx + '">' + columns.map(c => {
      const val = item[c];
      if (val === null || val === undefined) return '<td></td>';
      if (typeof val === 'object') return '<td>' + JSON.stringify(val).slice(0, 200) + '</td>';
      const str = String(val);
      if (str.match(/^https?:\/\//)) return '<td><a href="' + str + '" target="_blank" rel="noopener">' + str.substring(0, 60) + '…</a></td>';
      return '<td>' + str.slice(0, 120) + '</td>';
    }).join('') + '</tr>';
  }).join('');

  els.tableBody.insertAdjacentHTML('beforeend', rows);

  els.tableBody.querySelectorAll('tr.new-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.idx);
      if (currentItems[idx]) openModal(currentItems[idx], Object.keys(currentItems[idx]));
    });
    row.classList.remove('new-row');
  });
}

function appendCards(items) {
  const cardsHtml = items.map(item => {
    const idx = currentItems.indexOf(item);
    const title = item.title || item.name || item.author || item.channel || '(no title)';
    const stars = item.stars ? '★'.repeat(Math.round(item.stars)) + '☆'.repeat(5 - Math.round(item.stars)) : '';
    const source = item._source ? '<span class="card-source">' + item._source + '</span>' : '';
    const email = item.email ? '<span class="card-email">✉ ' + item.email + '</span>' : '';
    const phone = item.phone ? '<span class="card-phone">📞 ' + item.phone + '</span>' : '';
    const website = item.website || item.url || '';
    return '<div class="card new-card" data-idx="' + idx + '">' +
      '<div class="card-title">' + title + '</div>' +
      source +
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

  els.cardsView.querySelectorAll('.card.new-card').forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.idx);
      if (currentItems[idx]) openModal(currentItems[idx], Object.keys(currentItems[idx]));
    });
    card.classList.remove('new-card');
  });
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
  els.tableView.classList.toggle('hidden', isCardView);
  els.cardsView.classList.toggle('hidden', !isCardView);
  els.viewToggle.textContent = isCardView ? '⊞' : '▦';
});

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
  if (str === '_source') return 'Source';
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).replace(/_/g, ' ').trim();
}
