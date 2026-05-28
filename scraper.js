const { chromium } = require('playwright');

async function scrape({ template, searchString, locationQuery, maxResults = 10 }) {
  switch (template) {
    case 'youtube': return scrapeYouTube({ searchString, maxResults });
    case 'hackernews': return scrapeHN({ searchString, maxResults });
    case 'wikipedia': return scrapeWikipedia({ searchString, maxResults });
    default: return scrapeGoogleMaps({ searchString, locationQuery, maxResults });
  }
}

async function scrapeGoogleMaps({ searchString, locationQuery, maxResults }) {
  const browser = await launch();
  const page = await browser.newPage({ locale: 'en-US' });
  const results = [];

  try {
    const query = locationQuery ? `${searchString} near ${locationQuery}` : searchString;
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}/`, { timeout: 30000 });
    await page.waitForTimeout(5000);
    await dismissCookie(page);
    await scrollFeed(page);

    const cards = await getCards(page, 'a[href*="/maps/place/"]');
    const max = Math.min(cards.length, maxResults || cards.length);

    for (let i = 0; i < max; i++) {
      try {
        const { el, text } = cards[i];
        const link = el.locator('a[href*="/maps/place/"]').first();
        const href = await link.getAttribute('href').catch(() => '');
        const name = await link.getAttribute('aria-label').catch(() => '');

        let stars = 0;
        const rt = await el.locator('span[aria-label*="stars"]').first().getAttribute('aria-label').catch(() => '');
        if (rt) stars = parseFloat(rt.match(/[\d.]+/)?.[0]) || 0;

        await link.click().catch(() => {});
        await page.waitForTimeout(1000);

        let phone = '', website = '', address = '';
        phone = await extractText(page, 'button[data-tooltip*="phone"], button[aria-label*="Phone"]');
        website = await extractAttr(page, 'a[data-tooltip*="website"], a[aria-label*="Website"], a[data-item-id*="authority"]', 'href');
        address = await extractText(page, 'button[data-tooltip*="address"], button[aria-label*="Address"]');

        let reviewsCount = 0;
        const detailText = await page.locator('[role="main"]').textContent({ timeout: 1500 }).catch(() => '');
        if (detailText) {
          const rm = detailText.match(/([\d,]+)\s*(Google\s+)?reviews?/i);
          if (rm) reviewsCount = parseInt(rm[1].replace(/,/g, ''));
        }

        results.push({
          title: name || '', stars, reviewsCount, address, phone, website,
          url: href ? (href.startsWith('http') ? href : `https://www.google.com${href}`) : '',
        });

        await page.goBack({ timeout: 10000 }).catch(() => page.goto(url, { timeout: 10000 }));
        await page.waitForTimeout(800);
      } catch (_) {}
    }
  } finally {
    await browser.close();
  }
  return dedupe(results);
}

async function scrapeYouTube({ searchString, maxResults }) {
  const browser = await launch();
  const page = await browser.newPage();
  const results = [];

  try {
    await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(searchString)}`, { timeout: 30000 });
    await page.waitForTimeout(5000);
    await page.waitForSelector('ytd-video-renderer', { timeout: 10000 }).catch(() => {});

    const videos = await page.locator('ytd-video-renderer').all();
    const max = Math.min(videos.length, maxResults || videos.length);

    for (let i = 0; i < max; i++) {
      try {
        const el = videos[i];
        const title = await el.locator('#video-title').first().textContent().catch(() => '');
        const link = await el.locator('#video-title').first().getAttribute('href').catch(() => '');
        const channel = await el.locator('#channel-name, #text-container').first().textContent().catch(() => '');
        const meta = await el.locator('#metadata-line span').all();
        const views = meta.length > 0 ? await meta[0].textContent().catch(() => '') : '';
        const uploaded = meta.length > 1 ? await meta[1].textContent().catch(() => '') : '';

        results.push({
          title: title?.trim() || '',
          channel: channel?.trim() || '',
          views: views?.trim() || '',
          uploaded: uploaded?.trim() || '',
          url: link ? `https://www.youtube.com${link}` : '',
        });
      } catch (_) {}
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function scrapeHN({ searchString, maxResults }) {
  const browser = await launch();
  const page = await browser.newPage();
  const results = [];

  try {
    const url = searchString
      ? `https://hn.algolia.com/?q=${encodeURIComponent(searchString)}`
      : 'https://news.ycombinator.com/';
    await page.goto(url, { timeout: 30000 });
    await page.waitForTimeout(3000);

    if (searchString) {
      // Algolia search
      const items = await page.locator('.Story, .ais-Hits-item').all();
      const max = Math.min(items.length, maxResults || items.length);
      for (let i = 0; i < max; i++) {
        try {
          const el = items[i];
          const title = await el.locator('a').first().textContent().catch(() => '');
          const link = await el.locator('a').first().getAttribute('href').catch(() => '');
          const points = await el.locator('.Story_points, [class*="points"]').first().textContent().catch(() => '');
          const comments = await el.locator('a:has-text("comments"), a:has-text("comment")').first().textContent().catch(() => '');
          results.push({ title: title?.trim() || '', points: points?.trim() || '', comments: comments?.trim() || '', url: link || '' });
        } catch (_) {}
      }
    } else {
      // Front page
      const posts = await page.locator('.athing').all();
      const max = Math.min(posts.length, maxResults || posts.length);
      for (let i = 0; i < max; i++) {
        try {
          const el = posts[i];
          const title = await el.locator('.titleline a').first().textContent().catch(() => '');
          const link = await el.locator('.titleline a').first().getAttribute('href').catch(() => '');
          const scoreEl = await page.locator(`#score_${await el.getAttribute('id')}`).first();
          const points = await scoreEl.textContent().catch(() => '');
          results.push({ title: title?.trim() || '', points: points?.trim() || '', url: link || '' });
        } catch (_) {}
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function scrapeWikipedia({ searchString, maxResults }) {
  const browser = await launch();
  const page = await browser.newPage();
  const results = [];

  try {
    await page.goto(`https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(searchString)}&title=Special%3ASearch&fulltext=1`, { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Check if redirected directly to an article
    if (page.url().includes('/wiki/')) {
      const title = await page.locator('#firstHeading').textContent().catch(() => '');
      const summary = await page.locator('#mw-content-text p').first().textContent().catch(() => '');
      results.push({
        title: title?.trim() || searchString,
        summary: summary?.trim()?.substring(0, 500) || '',
        url: page.url(),
      });
      return results;
    }

    const items = await page.locator('.mw-search-result-heading').all();
    const max = Math.min(items.length, maxResults || items.length);

    for (let i = 0; i < max; i++) {
      try {
        const el = items[i];
        const title = await el.locator('a').first().getAttribute('title').catch(() => '');
        const link = await el.locator('a').first().getAttribute('href').catch(() => '');
        const snippet = await el.locator('..').locator('.searchresult, .mw-search-result').first().textContent().catch(() => '');
        results.push({
          title: title?.trim() || '',
          snippet: snippet?.trim()?.substring(0, 300) || '',
          url: link ? `https://en.wikipedia.org${link}` : '',
        });
      } catch (_) {}
    }
  } finally {
    await browser.close();
  }
  return results;
}

// Helpers
async function launch() {
  return await chromium.launch({ headless: true, args: ['--no-sandbox'] });
}

async function dismissCookie(page) {
  try {
    const btn = page.locator('button:has-text("Accept all"), button:has-text("Reject all")');
    if (await btn.first().isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.first().click();
      await page.waitForTimeout(800);
    }
  } catch (_) {}
}

async function scrollFeed(page) {
  try {
    const feed = page.locator('[role="feed"]');
    if (await feed.count() > 0) {
      for (let i = 0; i < 8; i++) {
        await feed.evaluate(el => el.scrollBy(0, el.scrollHeight));
        await page.waitForTimeout(500);
      }
    }
  } catch (_) {}
}

async function getCards(page, linkSelector) {
  const feed = page.locator('[role="feed"]');
  const children = await feed.locator('> div').all();
  const cards = [];
  for (const child of children) {
    const text = await child.textContent().catch(() => '');
    if (!text || text.length < 10) continue;
    if ((await child.locator(linkSelector).count()) > 0) {
      cards.push({ el: child, text });
    }
  }
  return cards;
}

async function extractText(page, selector) {
  try {
    const t = await page.locator(selector).first().textContent({ timeout: 1500 }).catch(() => '');
    return t ? t.replace(/[^\x20-\x7E\s]/g, '').trim() : '';
  } catch (_) { return ''; }
}

async function extractAttr(page, selector, attr) {
  try {
    return await page.locator(selector).first().getAttribute(attr, { timeout: 1500 }).catch(() => '') || '';
  } catch (_) { return ''; }
}

function dedupe(arr) {
  const seen = new Set();
  return arr.filter(r => {
    const key = r.url || r.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { scrape };
