const ScrapingBee = require('scrapingbee');
const cheerio = require('cheerio');
const API_KEY = process.env.SCRAPINGBEE_API_KEY || '';

let client;
if (API_KEY) {
  client = new ScrapingBee(API_KEY);
}

async function fetch(url, opts = {}) {
  if (!client) throw new Error('SCRAPINGBEE_API_KEY not set');
  const params = { render_js: true, premium_proxy: true, ...opts };
  const res = await client.get({ url, params });
  return res.data;
}

async function scrapeGoogleMaps({ searchString, locationQuery, maxResults }, add, aborted) {
  const query = locationQuery ? `${searchString} near ${locationQuery}` : searchString;
  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}/`;

  try {
    const html = await fetch(searchUrl, { wait: 3000, scroll: true });
    const $ = cheerio.load(html);

    // Find all place links
    const places = [];
    $(`a[href*="/maps/place/"]`).each((i, el) => {
      if (places.length >= maxResults) return false;
      const $el = $(el);
      const name = $el.attr('aria-label');
      const href = $el.attr('href');
      if (name && href && !places.some(p => p.name === name)) {
        places.push({
          name: name.split(',')[0].trim(),
          url: href.startsWith('http') ? href : `https://www.google.com${href}`,
          stars: 0,
        });
      }
    });

    // Extract stars near each place link
    places.forEach((place, idx) => {
      // Find a nearby span with an aria-label containing "stars"
      const allEls = $(`[aria-label*="stars"]`);
      if (allEls.length > idx) {
        const label = $(allEls[idx]).attr('aria-label') || '';
        const match = label.match(/[\d.]+/);
        if (match) place.stars = parseFloat(match[0]);
      }
    });

    // Process each place - get details from its page
    for (let i = 0; i < Math.min(places.length, maxResults); i++) {
      if (aborted()) break;
      const place = places[i];

      try {
        const detailHtml = await fetch(place.url, { wait: 1500 });
        const $d = cheerio.load(detailHtml);

        let phone = '', website = '', address = '';

        $d('[data-tooltip]').each((i, el) => {
          const tip = $(el).attr('data-tooltip') || '';
          const text = $(el).text().trim();
          if (tip.includes('phone') && text) phone = text;
          if (tip.includes('address') && text) address = text;
        });

        $d('[data-item-id="authority"]').each((i, el) => {
          const href = $(el).attr('href');
          if (href) website = href;
        });

        add({ _source: 'maps', title: place.name, stars: place.stars, address, phone, website, url: place.url });

        // Visit website for email (leads)
        if (website && !aborted()) {
          try {
            const siteHtml = await fetch(website, { render_js: false, premium_proxy: false, wait: 500 });
            const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            const badRe = /\.(png|jpg|jpeg|gif|svg|css|js|ico)$|@example\.|@\./i;
            const emails = [...siteHtml.matchAll(emailRe)].map(m => m[0]).filter(e => !badRe.test(e));
            const email = emails[0] || '';
            const li = siteHtml.match(/linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]+/i);
            const linkedin = li ? `https://${li[0].toLowerCase()}` : '';
            if (email || linkedin) {
              add({ _source: 'leads', title: place.name, name: place.name, website, phone, address, email, linkedin });
            }
          } catch (_) {}
        }
      } catch (_) {
        add({ _source: 'maps', title: place.name, stars: place.stars, address: '', phone: '', website: '', url: place.url });
      }
    }
  } catch (err) {
    console.error('ScrapingBee error:', err.message);
  }
}

module.exports = { scrapeGoogleMaps };
