const puppeteer = require('puppeteer');

async function scrapeGoogleMaps({ searchString, locationQuery, maxResults }, add, aborted) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const p = await browser.newPage();
  try {
    const query = locationQuery ? `${searchString} near ${locationQuery}` : searchString;
    await p.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}/`, { timeout: 15000, waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4000);

    const feed = await p.$('[role="feed"]');
    if (feed) {
      for (let i = 0; i < 3; i++) {
        await feed.evaluate(el => el.scrollBy(0, el.scrollHeight)).catch(() => {});
        await p.waitForTimeout(500);
      }

      const children = await feed.$$(':scope > div');
      let count = 0;
      for (const child of children) {
        if (count >= maxResults) break;
        const link = await child.$('a[href*="/maps/place/"]');
        if (!link) continue;
        try {
          const href = await link.evaluate(el => el.getAttribute('href'));
          const name = await link.evaluate(el => el.getAttribute('aria-label'));
          const starsSpan = await child.$('span[aria-label*="stars"]');
          const stars = starsSpan ? parseFloat((await starsSpan.evaluate(el => el.getAttribute('aria-label')) || '').match(/[\d.]+/)?.[0] || 0) : 0;

          await link.click();
          await p.waitForTimeout(800);
          const phone = await txt(p, 'button[data-tooltip*="phone"]', 'button[aria-label*="Phone"]');
          const website = await attr(p, 'a[data-tooltip*="website"]', 'a[data-item-id*="authority"]');
          const address = await txt(p, 'button[data-tooltip*="address"]', 'button[aria-label*="Address"]');

          add({ _source: 'maps', title: name || '', stars, address, phone, website, url: href || '' });
          count++;
          await p.goBack({ timeout: 10000 }).catch(() => {});
          await p.waitForTimeout(500);
        } catch (_) {}
      }
    }
  } finally { await browser.close(); }
}

async function scrapeLeads({ searchString, locationQuery, maxResults }, add, aborted) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const p = await browser.newPage();
  const businessResults = [];
  try {
    const query = locationQuery ? `${searchString} near ${locationQuery}` : searchString;
    await p.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}/`, { timeout: 15000, waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3000);

    const feed = await p.$('[role="feed"]');
    if (feed) {
      for (let s = 0; s < 3; s++) { await feed.evaluate(el => el.scrollBy(0, el.scrollHeight)).catch(() => {}); await p.waitForTimeout(400); }
      const children = await feed.$$(':scope > div');
      for (const child of children) {
        if (businessResults.length >= maxResults) break;
        const link = await child.$('a[href*="/maps/place/"]');
        if (!link) continue;
        const name = await link.evaluate(el => el.getAttribute('aria-label')).catch(() => '');
        const href = await link.evaluate(el => el.getAttribute('href')).catch(() => '');
        if (name && href) businessResults.push({ title: name, url: href.startsWith('http') ? href : `https://www.google.com${href}` });
      }
    }
  } catch (_) {}

  if (!businessResults.length) { await browser.close(); return; }

  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const badRe = /\.(png|jpg|jpeg|gif|svg|css|js|ico)$|@example\.|@\./i;

  try {
    for (const biz of businessResults) {
      if (aborted()) break;
      const lead = { _source: 'leads', name: biz.title || '', website: '', phone: '', email: '', linkedin: '', address: '' };
      try {
        await p.goto(biz.url, { timeout: 8000, waitUntil: 'domcontentloaded' }).catch(() => {});
        await p.waitForTimeout(1000);
        lead.website = await attr(p, 'a[data-tooltip*="website"]', 'a[data-item-id*="authority"]');
        lead.address = await txt(p, 'button[data-tooltip*="address"]', 'button[aria-label*="Address"]');
        lead.phone = await txt(p, 'button[data-tooltip*="phone"]', 'button[aria-label*="Phone"]');

        if (lead.website) {
          await p.goto(lead.website, { timeout: 6000, waitUntil: 'domcontentloaded' }).catch(() => {});
          await p.waitForTimeout(600);
          const body = await p.evaluate(() => document.body.textContent || '');
          if (body) {
            lead.email = ([...body.matchAll(emailRe)].map(m => m[0]).filter(e => !badRe.test(e)))[0] || '';
            const li = body.match(/linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]+/i);
            if (li) lead.linkedin = `https://${li[0].toLowerCase()}`;
          }
        }
      } catch (_) {}
      add(lead);
    }
  } finally { await browser.close(); }
}

async function txt(page, ...sels) {
  for (const sel of sels) {
    try { const el = await page.$(sel); if (el) { const t = await el.evaluate(el => el.textContent || ''); if (t) return t.replace(/[^\x20-\x7E\s]/g, '').trim(); } } catch (_) {}
  }
  return '';
}

async function attr(page, ...sels) {
  for (const sel of sels) {
    try { const el = await page.$(sel); if (el) { const a = await el.evaluate(el => el.getAttribute('href') || ''); if (a) return a; } } catch (_) {}
  }
  return '';
}

module.exports = { scrapeGoogleMaps, scrapeLeads };
