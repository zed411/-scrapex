async function scrape({ template, searchString, locationQuery, maxResults = 10, job, browser }) {
  const add = (item) => { if (job && !job.aborted) { item._source = template; job.items.push(item); } };
  const aborted = () => job && job.aborted;

  switch (template) {
    case 'youtube': return scrapeYouTube({ searchString, maxResults }, add, aborted, browser);
    case 'tiktok': return scrapeTikTok({ searchString, maxResults }, add, aborted, browser);
    case 'leads': return scrapeLeads({ searchString, locationQuery, maxResults }, add, aborted, browser);
    case 'ecommerce': return scrapeEcommerce({ searchString, maxResults }, add, aborted, browser);
    default: return scrapeGoogleMaps({ searchString, locationQuery, maxResults }, add, aborted, browser);
  }
}

async function scrapeGoogleMaps({ searchString, locationQuery, maxResults }, add, aborted, browser) {
  const p = await browser.newPage();
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
  } finally { await p.close(); }
}

async function scrapeYouTube({ searchString, maxResults }, add, aborted, browser) {
  const p = await browser.newPage();
  try {
    await p.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(searchString)}`, { timeout: 15000, waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3000);
    await p.waitForSelector('ytd-video-renderer', { timeout: 8000 }).catch(() => {});

    const videos = await p.locator('ytd-video-renderer').all();
    for (let i = 0; i < Math.min(videos.length, maxResults); i++) {
      if (aborted()) break;
      try {
        const el = videos[i];
        const title = await el.locator('#video-title').first().textContent().catch(() => '');
        const link = await el.locator('#video-title').first().getAttribute('href').catch(() => '');
        const channel = await el.locator('#channel-name, #text-container').first().textContent().catch(() => '');
        const meta = await el.locator('#metadata-line span').all();
        add({
          title: title?.trim() || '',
          channel: channel?.trim() || '',
          views: meta.length > 0 ? (await meta[0].textContent().catch(() => ''))?.trim() : '',
          uploaded: meta.length > 1 ? (await meta[1].textContent().catch(() => ''))?.trim() : '',
          url: link ? `https://www.youtube.com${link}` : '',
        });
      } catch (_) {}
    }
  } finally { await p.close(); }
}

async function scrapeTikTok({ searchString, maxResults }, add, aborted, browser) {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
    viewport: { width: 390, height: 844 },
  });
  const p = await ctx.newPage();
  await p.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  try {
    await p.goto(`https://www.tiktok.com/search/video?q=${encodeURIComponent(searchString)}`, { timeout: 15000, waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4000);
    for (let s = 0; s < 3; s++) { await p.evaluate(() => window.scrollBy(0, 400)); await p.waitForTimeout(500); if (aborted()) break; }

    const text = await p.locator('body').innerText().catch(() => '');
    const lines = text.split('\n').filter(l => l.trim());
    let i = 0;
    while (i < lines.length && !aborted()) {
      const line = lines[i].trim();
      if (/^[\d.]+[MK]?$/.test(line) && i + 2 < lines.length && lines[i + 2] === 'Share') {
        let author = i + 3 < lines.length ? lines[i + 3] : '', description = '', sound = '';
        let ptr = i + 3;
        if (ptr < lines.length) author = lines[ptr++];
        while (ptr < lines.length && (!lines[ptr].trim() || lines[ptr] === 'more' || lines[ptr] === 'Share')) ptr++;
        if (ptr < lines.length) description = lines[ptr++];
        while (ptr < lines.length && !lines[ptr].trim()) ptr++;
        if (ptr < lines.length) sound = lines[ptr];
        add({ author, description, likes: line, comments: lines[i + 1], sound });
        i = ptr + 1;
      } else { i++; }
    }
  } finally { await p.close(); await ctx.close(); }
}

async function scrapeLeads({ searchString, locationQuery, maxResults }, add, aborted, browser) {
  const businessResults = [];
  const tempAdd = (item) => businessResults.push(item);
  await scrapeGoogleMaps({ searchString, locationQuery, maxResults: Math.min(maxResults, 6) }, tempAdd, aborted, browser);
  if (!businessResults.length || aborted()) return;

  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const phoneRe = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const badRe = /\.(png|jpg|jpeg|gif|svg|css|js|ico)$|@example\.|@your\.|@\./i;
  const contactPaths = ['/contact', '/contact-us', '/contact.html', '/about', '/about-us', '/about.html', '/team', '/support'];

  const p = await browser.newPage();
  for (const biz of businessResults) {
    if (aborted()) break;
    const lead = { name: biz.title || '', website: biz.website || '', phone: biz.phone || '', email: '', linkedin: '', twitter: '', instagram: '', address: biz.address || '' };
    if (biz.website) {
      try {
        await p.goto(biz.website, { timeout: 6000, waitUntil: 'domcontentloaded' }).catch(() => {});
        await p.waitForTimeout(800);
        const body = await p.locator('body').textContent({ timeout: 2000 }).catch(() => '');
        if (body) {
          const emails = [...body.matchAll(emailRe)].map(m => m[0]).filter(e => !badRe.test(e));
          lead.email = emails[0] || '';
          const li = body.match(/linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]+/i);
          if (li) lead.linkedin = `https://${li[0].toLowerCase()}`;
          if (!lead.phone) { const ph = [...body.matchAll(phoneRe)].map(m => m[0]); lead.phone = ph[0] || ''; }
          if (!lead.email) {
            for (const path of contactPaths) {
              if (aborted()) break;
              try {
                await p.goto(new URL(path, biz.website).href, { timeout: 4000 }).catch(() => {});
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
    add(lead);
  }
  await p.close();
}

async function scrapeEcommerce({ searchString, maxResults }, add, aborted, browser) {
  const p = await browser.newPage();
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
  } finally { await p.close(); }
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
