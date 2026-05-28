const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? '/api/scrape'
  : 'https://scrapex-production-2b35.up.railway.app/api/scrape';

const TEMPLATES = [
  { id: 'google-maps', name: 'Maps', icon: '📍', desc: 'Businesses & places', search: 'e.g. "Coffee shops"', loc: true },
  { id: 'youtube', name: 'YouTube', icon: '▶️', desc: 'Videos & channels', search: 'e.g. "tech reviews"', loc: false },
  { id: 'hackernews', name: 'Hacker News', icon: '📊', desc: 'Posts & scores', search: 'e.g. "AI"', loc: false },
  { id: 'wikipedia', name: 'Wikipedia', icon: '📚', desc: 'Articles & summaries', search: 'e.g. "Python"', loc: false },
  { id: 'tiktok', name: 'TikTok', icon: '🎵', desc: 'Videos & creators', search: 'e.g. "music"', loc: false },
  { id: 'leads', name: 'Leads', icon: '📧', desc: 'Find emails & contacts', search: 'e.g. "Plumber in Chicago"', loc: true },
];

let activeTemplate = 'google-maps';

const templateList = document.getElementById('templateList');
const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const locationInput = document.getElementById('locationInput');
const maxResults = document.getElementById('maxResults');
const searchBtn = document.getElementById('searchBtn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const tableHead = document.getElementById('tableHead');
const tableBody = document.getElementById('tableBody');
const resultCount = document.getElementById('resultCount');
const exportCsvBtn = document.getElementById('exportCsvBtn');

function renderTemplates() {
  templateList.innerHTML = TEMPLATES.map(t => `
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
  searchInput.placeholder = t.search;
  locationInput.style.display = t.loc ? '' : 'none';
  resultsEl.classList.add('hidden');
  hideStatus();
}

function showStatus(msg, type) {
  statusEl.className = 'status ' + type;
  if (type === 'loading') {
    statusEl.innerHTML = '<span class="spinner"></span> ' + msg;
  } else {
    statusEl.textContent = msg;
  }
}

function hideStatus() {
  statusEl.className = 'status hidden';
}

searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  const location = locationInput.value.trim();
  const max = maxResults.value || 10;
  if (!query) return;

  searchBtn.disabled = true;
  searchBtn.textContent = 'Scraping...';
  resultsEl.classList.add('hidden');
  showStatus('Scraping...', 'loading');

  try {
    const body = {
      template: activeTemplate,
      searchString: query,
      maxCrawledPlaces: parseInt(max),
    };
    if (location) body.locationQuery = location;

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      showStatus(data.error || 'Scrape failed', 'error');
      return;
    }

    if (!data.items || data.items.length === 0) {
      showStatus('No results found', 'error');
      return;
    }

    renderResults(data.items);
    showStatus(`Found ${data.items.length} results`, 'success');
    resultsEl.classList.remove('hidden');
  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Scrape';
  }
});

function renderResults(items) {
  const keys = new Set();
  items.forEach(item => Object.keys(item).forEach(k => keys.add(k)));
  const columns = Array.from(keys);

  tableHead.innerHTML = '<tr>' + columns.map(c =>
    '<th>' + camelToTitle(c) + '</th>'
  ).join('') + '</tr>';

  tableBody.innerHTML = items.map(item =>
    '<tr>' + columns.map(c => {
      const val = item[c];
      if (val === null || val === undefined) return '<td></td>';
      if (typeof val === 'object') return '<td>' + JSON.stringify(val).slice(0, 200) + '</td>';
      const str = String(val);
      const isUrl = str.startsWith('http://') || str.startsWith('https://');
      if (isUrl) return '<td><a href="' + str + '" target="_blank" rel="noopener">' + str + '</a></td>';
      return '<td>' + str + '</td>';
    }).join('') + '</tr>'
  ).join('');

  resultCount.textContent = '(' + items.length + ')';

  exportCsvBtn.onclick = () => {
    const csvRows = [columns.join(',')];
    items.forEach(item => {
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
}

function camelToTitle(str) {
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).replace(/_/g, ' ').trim();
}

renderTemplates();
setActiveTemplate(activeTemplate);
