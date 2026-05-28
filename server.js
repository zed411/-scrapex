const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
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

  try {
    const items = [];
    const add = (item) => items.push(item);
    const aborted = () => false;

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      await scrapeGoogleMaps({ searchString, locationQuery, maxResults: Number(maxCrawledPlaces) }, add, aborted, browser);
      await scrapeLeads({ searchString, locationQuery, maxResults: Number(maxCrawledPlaces) }, add, aborted, browser);
    } finally {
      await browser.close().catch(() => {});
    }
    res.json({ status: 'SUCCEEDED', items });
  } catch (err) {
    console.error('Scrape error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
