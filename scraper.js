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

async function scrapeLeads({ searchString, locationQuery, maxResults }, add, aborted) {
  const query = locationQuery ? `${searchString} ${locationQuery}` : searchString;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;

  try {
    const html = await fetch(url, { wait: 2000, custom_google: true });
    const $ = cheerio.load(html);
    const leads = [];

    // Extract business names and websites from search results
    $('div.g, div[data-hveid], a[href^="http"] h3').each((i, el) => {
      if (leads.length >= maxResults || aborted()) return false;
      const $el = $(el);
      const title = $el.is('h3') ? $el.text().trim() : $el.find('h3').first().text().trim();
      let link = $el.is('h3') ? $el.parent().attr('href') || '' : $el.find('a').first().attr('href') || '';
      const snippet = $el.closest('div').find('.VwiC3b, .lEBKkf, span.aCOpRe').first().text().trim();

      // Clean up Google redirect URLs
      const urlMatch = link.match(/\/url\?q=([^&]+)/);
      if (urlMatch) link = decodeURIComponent(urlMatch[1]);
      if (!link.startsWith('http')) return;

      // Skip known non-business sites
      const skip = ['google.com', 'youtube.com', 'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com', 'wikipedia.org'];
      if (skip.some(s => link.includes(s))) return;

      if (title) {
        // Extract email from snippet if present
        const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const snippetEmail = ([...snippet.matchAll(emailRe)].map(m => m[0]))[0] || '';

        leads.push({ title, url: link, snippet, snippetEmail });
      }
    });

    // Visit each website to find email, LinkedIn, phone
    const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const phoneRe = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const badRe = /\.(png|jpg|jpeg|gif|svg|css|js|ico)$|@example\.|@\./i;

    for (const lead of leads) {
      if (aborted()) break;
      let email = lead.snippetEmail || '';
      let phone = '';
      let linkedin = '';

      try {
        const siteHtml = await fetch(lead.url, { render_js: false, premium_proxy: false, wait: 500 });
        if (siteHtml) {
          if (!email) {
            const emails = [...siteHtml.matchAll(emailRe)].map(m => m[0]).filter(e => !badRe.test(e));
            email = emails[0] || '';
          }
          if (!phone) {
            const phones = [...siteHtml.matchAll(phoneRe)].map(m => m[0]);
            phone = phones[0] || '';
          }
          const li = siteHtml.match(/linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]+/i);
          if (li) linkedin = `https://${li[0].toLowerCase()}`;
        }
      } catch (_) {}

      add({
        _source: 'leads',
        title: lead.title,
        name: lead.title,
        website: lead.url,
        email,
        phone,
        linkedin,
        snippet: lead.snippet,
      });
    }
  } catch (err) {
    console.error('Leads error:', err.message);
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

module.exports = { scrapeLeads, scrapeGoogleSearch, scrapeYouTube };
