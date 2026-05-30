const { ScrapingBeeClient } = require('scrapingbee');
const cheerio = require('cheerio');
const API_KEY = process.env.SCRAPINGBEE_API_KEY || '';

let client;
if (API_KEY) {
  client = new ScrapingBeeClient(API_KEY);
}

async function fetch(url, opts = {}) {
  if (!client) throw new Error('SCRAPINGBEE_API_KEY not set');
  const res = await client.htmlApi({
    url,
    params: { render_js: true, premium_proxy: true, ...opts },
  });
  return res.data;
}

async function scrapeGoogleMaps({ searchString, locationQuery, maxResults }, add, aborted) {
  const query = locationQuery ? `${searchString} near ${locationQuery}` : searchString;
  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}/`;

  try {
    const html = await fetch(searchUrl, { wait: 3000, custom_google: true });
    const $ = cheerio.load(html);

    const seen = new Set();
    let count = 0;

    $(`a[href*="/maps/place/"]`).each((i, el) => {
      if (count >= maxResults || aborted()) return false;
      const $el = $(el);
      const name = $el.attr('aria-label');
      const href = $el.attr('href');
      if (!name || !href) return;
      const cleanName = name.split(',')[0].trim();
      if (!cleanName || seen.has(cleanName)) return;
      seen.add(cleanName);

      // Extract stars from nearby span
      let stars = 0;
      const allStars = $(`[aria-label*="stars"]`);
      if (allStars.length > count) {
        const label = $(allStars[count]).attr('aria-label') || '';
        const match = label.match(/[\d.]+/);
        if (match) stars = parseFloat(match[0]);
      }

      add({
        _source: 'maps',
        title: cleanName,
        stars,
        address: '',
        phone: '',
        website: '',
        url: href.startsWith('http') ? href : `https://www.google.com${href}`,
      });
      count++;
    });
  } catch (err) {
    console.error('Maps error:', err.message);
  }
}

async function scrapeGoogleSearch({ searchString, maxResults }, add, aborted) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(searchString)}&hl=en`;
  try {
    const html = await fetch(url, { wait: 2000, custom_google: true });
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
    const res = await client.htmlApi({
      url,
      params: { render_js: true, wait: 3000 },
    });
    const $ = cheerio.load(res.data);
    let count = 0;

    // Extract video links - simple approach that works reliably
    $('a[href*="/watch?"]').each((i, el) => {
      if (count >= maxResults || aborted()) return false;
      const $el = $(el);
      const title = $el.attr('title') || $el.text().trim();
      const link = $el.attr('href') || '';
      if (title && link.includes('/watch?')) {
        add({ _source: 'video', title, channel: '', views: '', uploaded: '', url: `https://www.youtube.com${link}` });
        count++;
      }
    });
  } catch (err) {
    console.error('YouTube error:', err.message);
  }
}

module.exports = { scrapeGoogleMaps, scrapeGoogleSearch, scrapeYouTube };
