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

async function scrapeGoogleSearch({ searchString, maxResults }, add, aborted) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(searchString)}&hl=en`;
  try {
    const html = await fetch(url, { wait: 2000 });
    const $ = cheerio.load(html);
    let count = 0;

    // Google search results are in div.g or div[data-hveid]
    $('div.g, div[data-hveid]').each((i, el) => {
      if (count >= maxResults || aborted()) return false;
      const $el = $(el);
      const title = $el.find('h3').first().text().trim();
      const link = $el.find('a').first().attr('href') || '';
      const snippet = $el.find('.VwiC3b, .lEBKkf, span.aCOpRe').first().text().trim();

      // Clean up Google redirect URLs
      let cleanUrl = link;
      const urlMatch = link.match(/\/url\?q=([^&]+)/);
      if (urlMatch) cleanUrl = decodeURIComponent(urlMatch[1]);

      if (title && cleanUrl.startsWith('http')) {
        add({ _source: 'web', title, url: cleanUrl, snippet: snippet || '' });
        count++;
      }
    });

    // If no results found with primary selector, try fallback
    if (count === 0) {
      $('a[href^="http"] h3').each((i, el) => {
        if (count >= maxResults) return false;
        const title = $(el).text().trim();
        const link = $(el).parent().attr('href') || '';
        if (title && link.startsWith('http')) {
          add({ _source: 'web', title, url: link, snippet: '' });
          count++;
        }
      });
    }
  } catch (err) {
    console.error('Google Search error:', err.message);
  }
}

async function scrapeYouTube({ searchString, maxResults }, add, aborted) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchString)}`;
  try {
    const html = await fetch(url, { wait: 3000, scroll: true });
    const $ = cheerio.load(html);
    let count = 0;

    // YouTube renders video data in ytd-video-renderer elements
    $('ytd-video-renderer').each((i, el) => {
      if (count >= maxResults || aborted()) return false;
      const $el = $(el);
      const title = $el.find('#video-title').text().trim();
      const link = $el.find('#video-title').attr('href') || '';
      const channel = $el.find('#channel-name, #text-container').first().text().trim();
      const meta = $el.find('#metadata-line span');
      const views = $(meta[0]).text().trim();
      const uploaded = $(meta[1]).text().trim();

      if (title) {
        add({ _source: 'video', title, channel: channel || '', views: views || '', uploaded: uploaded || '', url: link ? `https://www.youtube.com${link}` : '' });
        count++;
      }
    });

    // Fallback: parse from script tags or simpler elements
    if (count === 0) {
      $('a[href*="/watch?"]').each((i, el) => {
        if (count >= maxResults) return false;
        const $el = $(el);
        const title = $el.attr('title') || $el.text().trim();
        const link = $el.attr('href') || '';
        if (title && link.includes('/watch?')) {
          add({ _source: 'video', title, channel: '', views: '', uploaded: '', url: `https://www.youtube.com${link}` });
          count++;
        }
      });
    }
  } catch (err) {
    console.error('YouTube error:', err.message);
  }
}

module.exports = { scrapeGoogleMaps, scrapeGoogleSearch, scrapeYouTube };
