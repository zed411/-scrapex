const { chromium } = require('playwright');

async function scrapeGoogleMaps({ searchString, locationQuery, maxResults }, add, aborted, browser) {
  const p = await browser.newPage();
  try {
    const query = locationQuery ? `${searchString} near ${locationQuery}` : searchString;
    await p.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}/`, { timeout: 15000, waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4000);

    const feed = p.locator('[role="feed"]');
    for (let i = 0; i < 12; i++) {
      try { await feed.evaluate(el => el.scrollBy(0, el.scrollHeight)); await p.waitForTimeout(400); } catch (_) {}
    }

    const children = await feed.locator('> div').all();
    let count = 0;
    for (const child of children) {
      if (count >= maxResults) break;
      const link = child.locator('a[href*="/maps/place/"]');
      if (!(await link.count())) continue;
      try {
        const href = await link.getAttribute('href');
        const name = await link.getAttribute('aria-label');
        let stars = 0;
        const rt = await child.locator('span[aria-label*="stars"]').first().getAttribute('aria-label').catch(() => '');
        if (rt) stars = parseFloat(rt.match(/[\d.]+/)?.[0]) || 0;

        await link.click();
        await p.waitForTimeout(600);
        const phone = await txt(p, 'button[data-tooltip*="phone"]', 'button[aria-label*="Phone"]');
        const website = await attr(p, 'a[data-tooltip*="website"]', 'a[data-item-id*="authority"]');
        const address = await txt(p, 'button[data-tooltip*="address"]', 'button[aria-label*="Address"]');

        add({ _source: 'maps', title: name || '', stars, address, phone, website, url: href || '' });
        count++;

        // Also add as a lead if we have a website (to find email)
        if (website && !aborted()) {
          try {
            const p2 = await browser.newPage();
            await p2.goto(website, { timeout: 6000, waitUntil: 'domcontentloaded' }).catch(() => {});
            await p2.waitForTimeout(500);
            const body = await p2.locator('body').textContent({ timeout: 2000 }).catch(() => '');
            if (body) {
              const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
              const badRe = /\.(png|jpg|jpeg|gif|svg|css|js|ico)$|@example\.|@\./i;
              const email = ([...body.matchAll(emailRe)].map(m => m[0]).filter(e => !badRe.test(e)))[0] || '';
              const li = body.match(/linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]+/i);
              const linkedin = li ? `https://${li[0].toLowerCase()}` : '';
              if (email || linkedin) {
                add({ _source: 'leads', name: name || '', website, phone, address, email, linkedin });
              }
            }
            await p2.close();
          } catch (_) {}
        }
        await p.goBack({ timeout: 10000 }).catch(() => {});
        await p.waitForTimeout(400);
      } catch (_) {}
    }
  } finally { await p.close(); }
}

async function scrapeLeads({ searchString, locationQuery, maxResults }, add, aborted, browser) {
  const p = await browser.newPage();
  try {
    const query = locationQuery ? `${searchString} near ${locationQuery}` : searchString;
    await p.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}/`, { timeout: 15000, waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2500);

    const feed = p.locator('[role="feed"]');
    for (let s = 0; s < 8; s++) { try { await feed.evaluate(el => el.scrollBy(0, el.scrollHeight)); await p.waitForTimeout(300); } catch (_) {} }

    const children = await feed.locator('> div').all();
    let count = 0;

    // Visit each result via click (same as Maps scraper)
    for (const child of children) {
      if (count >= maxResults || aborted()) break;
      const link = child.locator('a[href*="/maps/place/"]');
      if (!(await link.count())) continue;
      try {
        await link.click();
        await p.waitForTimeout(800);

        const website = await txt(p, 'a[data-tooltip*="website"]', 'a[data-item-id*="authority"]');
        const phone = await txt(p, 'button[data-tooltip*="phone"]', 'button[aria-label*="Phone"]');
        const address = await txt(p, 'button[data-tooltip*="address"]', 'button[aria-label*="Address"]');

        // Only include if we found contact data
        if (website || phone) {
          const lead = { _source: 'leads', name: await link.getAttribute('aria-label').catch(() => ''), website, phone, address, email: '', linkedin: '' };

          // Visit website to find email
          if (website) {
            try {
              await p.goto(website, { timeout: 6000, waitUntil: 'domcontentloaded' }).catch(() => {});
              await p.waitForTimeout(600);
              const body = await p.locator('body').textContent({ timeout: 2000 }).catch(() => '');
              if (body) {
                const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
                const badRe = /\.(png|jpg|jpeg|gif|svg|css|js|ico)$|@example\.|@\./i;
                lead.email = ([...body.matchAll(emailRe)].map(m => m[0]).filter(e => !badRe.test(e)))[0] || '';
                const li = body.match(/linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]+/i);
                if (li) lead.linkedin = `https://${li[0].toLowerCase()}`;
              }
            } catch (_) {}
          }
          add(lead);
        }
        count++;
      } catch (_) {}
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
