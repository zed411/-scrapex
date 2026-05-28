const { chromium } = require('playwright');

async function scrape({ template, searchString, locationQuery, maxResults = 10, job }) {
  const add = (item) => { if (job && !job.aborted) { item._source = template; job.items.push(item); } };
  const aborted = () => job && job.aborted;

  switch (template) {
    case 'leads': return scrapeLeads({ searchString, locationQuery, maxResults }, add, aborted);
    case 'ecommerce': return scrapeEcommerce({ searchString, maxResults }, add, aborted);
    default: return scrapeGoogleMaps({ searchString, locationQuery, maxResults }, add, aborted);
  }
}

async function scrapeGoogleMaps({ searchString, locationQuery, maxResults }, add, aborted) {
  const b = await launch();
  const p = await b.newPage({ locale: 'en-US' });
  try {
    const query = locationQuery ? `${searchString} near ${locationQuery}` : searchString;
    await p.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}/`, { timeout: 15000, waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3000);

    for (let i = 0; i < 5; i++) {
      try { await p.locator('[role="feed"]').evaluate(el => el.scrollBy(0, el.scrollHeight)); await p.waitForTimeout(400); } catch (_) {}
    }

    const feed = p.locator('[role="feed"]');
    const children = await feed.locator('> div').all();
    let count = 0;
    for (const child of children) {
      if (aborted() || count >= maxResults) break;
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

        const phone = await txt(p, 'button[data-tooltip*="phone"], button[aria-label*="Phone"]');
        const website = await attr(p, 'a[data-tooltip*="website"], a[data-item-id*="authority"]', 'href');
        const address = await txt(p, 'button[data-tooltip*="address"], button[aria-label*="Address"]');

        add({ title: name || '', stars, address, phone, website, url: href ? (href.startsWith('http') ? href : `https://www.google.com${href}`) : '' });
        count++;
        await p.goBack({ timeout: 8000 }).catch(() => p.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}/`, { timeout: 8000 }));
        await p.waitForTimeout(400);
      } catch (_) {}
    }
  } finally { await b.close(); }
}

async function scrapeLeads({ searchString, locationQuery, maxResults }, add, aborted) {
  const b = await launch();
  const p = await b.newPage();
  const businessResults = [];
  try {
    const query = locationQuery ? `${searchString} near ${locationQuery}` : searchString;
    await p.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}/`, { timeout: 15000, waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2500);
    for (let s = 0; s < 4; s++) { try { await p.locator('[role="feed"]').evaluate(el => el.scrollBy(0, el.scrollHeight)); await p.waitForTimeout(300); } catch (_) {} }

    const feed = p.locator('[role="feed"]');
    const children = await feed.locator('> div').all();
    for (const child of children) {
      if (businessResults.length >= maxResults || aborted()) break;
      const link = child.locator('a[href*="/maps/place/"]');
      if (!(await link.count())) continue;
      const name = await link.getAttribute('aria-label').catch(() => '');
      const href = await link.getAttribute('href').catch(() => '');
      if (name) businessResults.push({ title: name, url: href ? (href.startsWith('http') ? href : `https://www.google.com${href}`) : '' });
    }
  } catch (_) {}

  if (!businessResults.length || aborted()) { await b.close(); return; }

  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const phoneRe = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const badRe = /\.(png|jpg|jpeg|gif|svg|css|js|ico)$|@example\.|@your\.|@\./i;
  const contactPaths = ['/contact', '/contact-us', '/contact.html', '/about', '/about-us', '/about.html', '/team', '/support'];

  try {
    for (const biz of businessResults) {
      if (aborted()) break;
      const lead = { name: biz.title || '', website: biz.website || '', phone: '', email: '', linkedin: '', address: '' };
      if (!biz.url) { add(lead); continue; }
      // Try to extract website from the Maps URL
      try {
        await p.goto(biz.url, { timeout: 8000, waitUntil: 'domcontentloaded' }).catch(() => {});
        await p.waitForTimeout(1200);
        lead.website = await attr(p, 'a[data-tooltip*="website"], a[data-item-id*="authority"]', 'href');
        lead.address = await txt(p, 'button[data-tooltip*="address"], button[aria-label*="Address"]');
        lead.phone = await txt(p, 'button[data-tooltip*="phone"], button[aria-label*="Phone"]');

        if (lead.website) {
          try {
            await p.goto(lead.website, { timeout: 6000, waitUntil: 'domcontentloaded' }).catch(() => {});
            await p.waitForTimeout(800);
            const body = await p.locator('body').textContent({ timeout: 2000 }).catch(() => '');
            if (body) {
              const emails = [...body.matchAll(emailRe)].map(m => m[0]).filter(e => !badRe.test(e));
              lead.email = emails[0] || '';
              const li = body.match(/linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]+/i);
              if (li) lead.linkedin = `https://${li[0].toLowerCase()}`;
              if (!lead.email) {
                for (const path of contactPaths) {
                  if (aborted()) break;
                  try {
                    await p.goto(new URL(path, lead.website).href, { timeout: 4000 }).catch(() => {});
                    await p.waitForTimeout(500);
                    const ct = await p.locator('body').textContent({ timeout: 2000 }).catch(() => '');
                    if (ct) {
                      const ce = [...ct.matchAll(emailRe)].map(m => m[0]).filter(e => !badRe.test(e));
                      if (ce.length > 0) { lead.email = ce[0]; break; }
                    }
                  } catch (_) {}
                }
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
      add(lead);
    }
  } finally { await b.close(); }
}

async function scrapeEcommerce({ searchString, maxResults }, add, aborted) {
  const b = await launch();
  const p = await b.newPage();
  try {
    await p.goto(`https://www.wish.com/search/${encodeURIComponent(searchString)}`, { timeout: 15000, waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3000);

    const products = await p.locator('[class*="ProductCard"], [class*="product"], [class*="item-card"]').all();
    for (let i = 0; i < Math.min(products.length, maxResults); i++) {
      if (aborted()) break;
      try {
        const el = products[i];
        const title = await el.locator('[class*="name"], [class*="title"], h2, h3').first().textContent().catch(() => '');
        const price = await el.locator('[class*="price"], [class*="cost"]').first().textContent().catch(() => '');
        const link = await el.locator('a').first().getAttribute('href').catch(() => '');
        add({ title: title?.trim() || '', price: price?.trim() || '', url: link || '', source: 'wish' });
      } catch (_) {}
    }

    if (!aborted()) {
      await p.goto(`https://www.zalando.com/catalog/?q=${encodeURIComponent(searchString)}`, { timeout: 10000 }).catch(() => {});
      await p.waitForTimeout(2500);
      const zalando = await p.locator('[class*="product"], [class*="article"], [class*="item"]').all();
      for (let i = 0; i < Math.min(zalando.length, maxResults); i++) {
        if (aborted()) break;
        try {
          const el = zalando[i];
          const title = await el.locator('[class*="name"], h3').first().textContent().catch(() => '');
          const price = await el.locator('[class*="price"]').first().textContent().catch(() => '');
          const link = await el.locator('a').first().getAttribute('href').catch(() => '');
          add({ title: title?.trim() || '', price: price?.trim() || '', url: link || '', source: 'zalando' });
        } catch (_) {}
      }
    }
  } finally { await b.close(); }
}

async function launch() {
  return await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
}

async function txt(page, sel) {
  try { const t = await page.locator(sel).first().textContent({ timeout: 1000 }).catch(() => ''); return t ? t.replace(/[^\x20-\x7E\s]/g, '').trim() : ''; }
  catch (_) { return ''; }
}

async function attr(page, sel, a) {
  try { return await page.locator(sel).first().getAttribute(a, { timeout: 1000 }).catch(() => '') || ''; }
  catch (_) { return ''; }
}

module.exports = { scrape };
