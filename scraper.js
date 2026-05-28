const { chromium } = require('playwright');

async function scrape({ template, searchString, locationQuery, maxResults = 10 }) {
  switch (template) {
    case 'youtube': return scrapeYouTube({ searchString, maxResults });
    case 'tiktok': return scrapeTikTok({ searchString, maxResults });
    case 'leads': return scrapeLeads({ searchString, maxResults });
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


async function scrapeLeads({ searchString, maxResults }) {
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const phoneRe = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

  // First, get business listings from Google Maps
  const businesses = await scrapeGoogleMaps({ searchString, locationQuery: '', maxResults });
  const results = [];

  if (businesses.length === 0) return results;

  const browser = await launch();
  const page = await browser.newPage();

  try {
    for (const biz of businesses) {
      const lead = {
        name: biz.title || '',
        website: biz.website || '',
        phone: biz.phone || '',
        email: '',
        address: biz.address || '',
        stars: biz.stars || 0,
        reviews: biz.reviewsCount || 0,
      };

      // Visit website to find email
      if (biz.website) {
        try {
          await page.goto(biz.website, { timeout: 10000, waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(1500);
          const text = await page.locator('body').textContent({ timeout: 5000 }).catch(() => '');

          if (text) {
            const emails = [...text.matchAll(emailRe)]
              .map(m => m[0])
              .filter(e => !e.includes('.png') && !e.includes('.jpg') && !e.includes('.svg') && !e.includes('@example') && e.split('@')[1]?.includes('.'));

            if (emails.length > 0) {
              lead.email = emails[0];
            } else {
              // Try contact page
              const contactLinks = await page.locator('a[href*="contact" i], a[href*="about" i]').all();
              if (contactLinks.length > 0) {
                const href = await contactLinks[0].getAttribute('href').catch(() => '');
                if (href) {
                  const url = href.startsWith('http') ? href : new URL(href, biz.website).href;
                  await page.goto(url, { timeout: 10000, waitUntil: 'domcontentloaded' }).catch(() => {});
                  await page.waitForTimeout(1000);
                  const contactText = await page.locator('body').textContent({ timeout: 5000 }).catch(() => '');
                  if (contactText) {
                    const contactEmails = [...contactText.matchAll(emailRe)].map(m => m[0]).filter(e => !e.includes('.png') && e.includes('@'));
                    if (contactEmails.length > 0) lead.email = contactEmails[0];
                  }
                }
              }
            }
          }
        } catch (_) {}
      }

      results.push(lead);
    }
  } finally {
    await browser.close();
  }

  return results;
}

// Helpers
async function launch() {
  return await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
}

async function scrapeTikTok({ searchString, maxResults }) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const results = [];

  try {
    const url = `https://www.tiktok.com/search/video?q=${encodeURIComponent(searchString)}`;
    await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    // Scroll to trigger more loading
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.waitForTimeout(1000);
    }

    // Extract video data from the page text
    const text = await page.locator('body').innerText().catch(() => '');
    const lines = text.split('\n').filter(l => l.trim());

    // Find video blocks - they follow a pattern: likes, comments, "Share", author, description, sound
    let i = 0;
    while (i < lines.length && results.length < maxResults) {
      const line = lines[i].trim();

      // Check if this line looks like a view/like count (e.g. "5.6M", "14.1M", "1.2K")
      if (/^[\d.]+[MK]?$/.test(line) && i + 2 < lines.length && lines[i + 2] === 'Share') {
        const likes = line;
        const comments = lines[i + 1];
        let author = i + 3 < lines.length ? lines[i + 3] : '';
        let description = '';
        let sound = '';

        // After "Share" at i+2, find author, then description, then sound
        let ptr = i + 3;
        if (ptr < lines.length) author = lines[ptr++];
        // Skip any "more" or empty lines for description
        while (ptr < lines.length && (!lines[ptr].trim() || lines[ptr] === 'more' || lines[ptr] === 'Share')) ptr++;
        if (ptr < lines.length) description = lines[ptr++];
        // Skip empty lines before sound
        while (ptr < lines.length && !lines[ptr].trim()) ptr++;
        if (ptr < lines.length) sound = lines[ptr];

        results.push({
          author: author,
          description: description,
          likes: likes,
          comments: comments,
          sound: sound,
        });
        i = ptr + 1;
    }

    // If no results from the pattern, try profile search instead
    if (results.length === 0) {
      const profileUrl = `https://www.tiktok.com/@${encodeURIComponent(searchString.replace(/[^a-zA-Z0-9_]/g, ''))}`;
      if (profileUrl !== `https://www.tiktok.com/@`) {
        await page.goto(profileUrl, { timeout: 15000, waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);

        const jsonlds = await page.locator('script[type="application/ld+json"]').all();
        for (const el of jsonlds) {
          try {
            const data = JSON.parse(await el.textContent() || '{}');
            if (data.mainEntity) {
              results.push({
                author: data.mainEntity.alternateName || '',
                description: data.mainEntity.description || '',
                name: data.mainEntity.name || '',
                url: data.mainEntity.url || '',
              });
            }
          } catch (_) {}
        }
      }
    }
  }
  } finally {
    await browser.close();
  }
  return results;
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
