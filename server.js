const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { scrapeGoogleMaps } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;
const jobs = {};

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/scrape', async (req, res) => {
  const { searchString, locationQuery, maxCrawledPlaces = 50 } = req.body;
  if (!searchString) return res.status(400).json({ error: 'searchString is required' });

  const jobId = crypto.randomBytes(8).toString('hex');
  const job = { id: jobId, items: [], status: 'running', _ts: Date.now(), aborted: false };
  jobs[jobId] = job;
  res.json({ jobId });

  // Run scrapers in background — each pushes to job.items
  (async () => {
    try {
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const seen = new Set();
      const add = (item) => { if (!job.aborted) { const key = item.url || item.title || item.name || ''; if (key && seen.has(key)) return; if (key) seen.add(key); job.items.push(item); } };
      const aborted = () => job.aborted;

      try {
        await scrapeGoogleMaps({ searchString, locationQuery, maxResults: Number(maxCrawledPlaces) }, add, aborted, browser);
      } finally {
        await browser.close().catch(() => {});
      }
      if (!job.aborted) job.status = 'done';
    } catch (err) {
      console.error('Scrape error:', err);
      job.status = 'error';
      job.error = err.message;
    }
  })();
});

app.get('/api/scrape/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ status: job.status, items: job.items, error: job.error });
});

app.delete('/api/scrape/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (job) { job.aborted = true; job.status = 'stopped'; }
  res.json({ ok: true });
});

setInterval(() => {
  const now = Date.now();
  for (const id of Object.keys(jobs)) {
    if (jobs[id].status !== 'running' && (now - (jobs[id]._ts || now)) > 600000) delete jobs[id];
  }
}, 60000);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
