const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { scrape } = require('./scraper');

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
  const { searchString, locationQuery, maxCrawledPlaces = 10 } = req.body;
  if (!searchString) return res.status(400).json({ error: 'searchString is required' });

  const jobId = crypto.randomBytes(8).toString('hex');
  const job = { id: jobId, items: [], status: 'running', _ts: Date.now(), aborted: false };
  jobs[jobId] = job;

  const max = Number(maxCrawledPlaces);
  const templates = ['google-maps', 'leads', 'tiktok', 'youtube', 'ecommerce'];

  // Run all scrapers in parallel, each pushes results to job.items
  const promises = templates.map(template =>
    scrape({ template, searchString, locationQuery, maxResults: max, job })
      .catch(() => {})
  );

  Promise.all(promises).then(() => {
    if (!job.aborted) job.status = 'done';
  });

  res.json({ jobId });
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

// Cleanup old jobs after 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const id of Object.keys(jobs)) {
    if (jobs[id].status !== 'running' && (now - (jobs[id]._ts || now)) > 600000) {
      delete jobs[id];
    }
  }
}, 60000);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
