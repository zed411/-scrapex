const express = require('express');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { scrapeLeads, scrapeGoogleSearch, scrapeYouTube } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const USERS_FILE = path.join(__dirname, 'users.json');
const jobs = {};

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return {}; }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

if (!process.env.SCRAPINGBEE_API_KEY) {
  console.log('WARNING: SCRAPINGBEE_API_KEY not set. Set it in environment variables.');
}

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, apiKeySet: !!process.env.SCRAPINGBEE_API_KEY }));

app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const users = loadUsers();
  if (users[email]) return res.status(409).json({ error: 'Email already registered' });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  users[email] = { hash, salt, createdAt: Date.now() };
  saveUsers(users);
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, email });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const users = loadUsers();
  const user = users[email];
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const hash = crypto.pbkdf2Sync(password, user.salt, 100000, 64, 'sha512').toString('hex');
  if (hash !== user.hash) return res.status(401).json({ error: 'Invalid email or password' });
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, email });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ email: req.user.email });
});

app.post('/api/scrape', authMiddleware, async (req, res) => {
  const { searchString, locationQuery, maxCrawledPlaces = 50, templates } = req.body;
  if (!searchString) return res.status(400).json({ error: 'searchString is required' });

  const jobId = crypto.randomBytes(8).toString('hex');
  const job = { id: jobId, items: [], status: 'running', _ts: Date.now(), aborted: false };
  jobs[jobId] = job;
  res.json({ jobId });

  (async () => {
    try {
      const add = (item) => { if (!job.aborted) job.items.push(item); };
      const aborted = () => job.aborted;
      if (!templates || templates.includes('leads'))
        await scrapeLeads({ searchString, locationQuery, maxResults: Number(maxCrawledPlaces) }, add, aborted);
      if (!templates || templates.includes('web'))
        await scrapeGoogleSearch({ searchString, maxResults: Number(maxCrawledPlaces) }, add, aborted);
      if (!templates || templates.includes('video'))
        await scrapeYouTube({ searchString, maxResults: Number(maxCrawledPlaces) }, add, aborted);
      if (!job.aborted) job.status = 'done';
    } catch (err) {
      console.error('Scrape error:', err);
      job.status = 'error';
      job.error = err.message;
    }
  })();
});

app.get('/api/scrape/:jobId', authMiddleware, (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ status: job.status, items: job.items, error: job.error });
});

app.delete('/api/scrape/:jobId', authMiddleware, (req, res) => {
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
