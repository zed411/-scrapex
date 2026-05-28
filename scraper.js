const { chromium } = require('playwright');

async function scrapeGoogleMaps({ searchString, locationQuery, maxResults }, add, aborted, browser) {
  const p = await browser.newPage();
  try {
    const query = locationQuery ? `${searchString} near ${locationQuery}` : searchString;
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}/`;
    await p.goto(searchUrl, { timeout: 15000, waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3000);

    const feed = p.locator('[role="feed"]');
    for (let i = 0; i < 3; i++) { try { await feed.evaluate(el => el.scrollBy(0, el.scrollHeight)); await p.waitForTimeout(300); } catch (_) {} }

    const children = await feed.locator('> div').all();
    const places = [];
    for (const child of children) {
      if (places.length >= maxResults) break;
      const link = child.locator('a[href*="/maps/place/"]');
      if (!(await link.count())) continue;
      const href = await link.getAttribute('href');
      const name = await link.getAttribute('aria-label');
      let stars = 0;
      const rt = await child.locator('span[aria-label*="stars"]').first().getAttribute('aria-label').catch(() => '');
      if (rt) stars = parseFloat(rt.match(/[\d.]+/)?.[0]) || 0;
      places.push({ href, name, stars });
    }

    for (const place of places) {
      if (aborted()) break;
      try {
        await p.goto(place.href.startsWith('http') ? place.href : `https://www.google.com${place.href}`, { timeout: 10000, waitUntil: 'domcontentloaded' });
        await p.waitForTimeout(600);
        const phone = await txt(p, 'button[data-tooltip*="phone"], button[aria-label*="Phone"]');
        const website = await attr(p, 'a[data-tooltip*="website"], a[data-item-id*="authority"]', 'href');
        const address = await txt(p, 'button[data-tooltip*="address"], button[aria-label*="Address"]');
        add({ _source: 'maps', title: place.name || '', stars: place.stars, address, phone, website, url: place.href || '' });
      } catch (_) {}
    }
  } finally { await p.close(); }
}

async function scrapeLeads({ searchString, locationQuery, maxResults }, add, aborted, browser) {
  const p = await browser.newPage();
  const businessResults = [];
  try {
    const query = locationQuery ? `${searchString} near ${locationQuery}` : searchString;
    await p.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}/`, { timeout: 15000, waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2500);
    for (let s = 0; s < 3; s++) { try { await p.locator('[role="feed"]').evaluate(el => el.scrollBy(0, el.scrollHeight)); await p.waitForTimeout(300); } catch (_) {} }

    const children = await p.locator('[role="feed"] > div').all();
    for (const child of children) {
      if (businessResults.length >= maxResults || aborted()) break;
      const link = child.locator('a[href*="/maps/place/"]');
      if (!(await link.count())) continue;
      const name = await link.getAttribute('aria-label').catch(() => '');
      const href = await link.getAttribute('href').catch(() => '');
      if (name) businessResults.push({ title: name, url: href || '' });
    }
  } catch (_) {}

  if (!businessResults.length || aborted()) { await p.close(); return; }

  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const badRe = /\.(png|jpg|jpeg|gif|svg|css|js|ico)$|@example\.|@your\.|@\./i;
  const contactPaths = ['/contact', '/contact-us', '/contact.html', '/about', '/about-us'];

  try {
    for (const biz of businessResults) {
      if (aborted()) break;
      const lead = { _source: 'leads', name: biz.title || '', website: '', phone: '', email: '', linkedin: '', address: '' };
      if (!biz.url) { add(lead); continue; }
      try {
        await p.goto(biz.url, { timeout: 8000, waitUntil: 'domcontentloaded' }).catch(() => {});
        await p.waitForTimeout(1000);
        lead.website = await txt(p, 'a[data-tooltip*="website"], a[data-item-id*="authority"]', 'href');
        lead.address = await txt(p, 'button[data-tooltip*="address"], button[aria-label*="Address"]');
        lead.phone = await txt(p, 'button[data-tooltip*="phone"], button[aria-label*="Phone"]');

        if (lead.website) {
          await p.goto(lead.website, { timeout: 6000, waitUntil: 'domcontentloaded' }).catch(() => {});
          await p.waitForTimeout(600);
          const body = await p.locator('body').textContent({ timeout: 2000 }).catch(() => '');
          if (body) {
            const emails = [...body.matchAll(emailRe)].map(m => m[0]).filter(e => !badRe.test(e));
            lead.email = emails[0] || '';
            const li = body.match(/linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]+/i);
            if (li) lead.linkedin = `https://${li[0].toLowerCase()}`;
            if (!lead.email) {
              for (const path of contactPaths) {
                if (aborted()) break;
                try { await p.goto(new URL(path, lead.website).href, { timeout: 4000 }).catch(() => {}); await p.waitForTimeout(400); const ct = await p.locator('body').textContent({ timeout: 2000 }).catch(() => ''); if (ct) { const ce = [...ct.matchAll(emailRe)].map(m => m[0]).filter(e => !badRe.test(e)); if (ce.length > 0) { lead.email = ce[0]; break; } } } catch (_) {}
              }
            }
          }
        }
      } catch (_) {}
      add(lead);
    }
  } finally { await p.close(); }
}

async function txt(page, ...sels) {
  for (const sel of sels) {
    try { const t = await page.locator(sel).first().textContent({ timeout: 800 }).catch(() => ''); if (t) return t.replace(/[^\x20-\x7E\s]/g, '').trim(); } catch (_) {}
  }
  return '';
}

async function attr(page, ...sels) {
  for (const sel of sels) {
    try { const a = await page.locator(sel).first().getAttribute('href', { timeout: 800 }).catch(() => ''); if (a) return a; } catch (_) {}
  }
  return '';
}

module.exports = { scrapeGoogleMaps, scrapeLeads };
