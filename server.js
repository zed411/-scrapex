const express = require('express');
const path = require('path');
const { chromium } = require('playwright');
const { scrapeGoogleMaps, scrapeLeads } = require('./scraper');

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

app.get('/api/diag', async (req, res) => {
  try {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.goto('https://www.google.com/maps/search/coffee/', { timeout: 10000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const title = await page.title();
    const feed = await page.locator('[role="feed"]').count();
    const text = await page.locator('body').textContent().catch(() => '');
    await browser.close();
    res.json({ title, feed, length: text?.length, snippet: text?.substring(0, 300) });
  } catch (err) {
    res.json({ error: err.message });
  }
});

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
