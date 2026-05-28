const { scrape } = require('./scraper');
(async () => {
  console.log('=== YOUTUBE ===');
  let r = await scrape({ template: 'youtube', searchString: 'music', maxResults: 2 });
  console.log(JSON.stringify(r, null, 2));

  console.log('\n=== HACKER NEWS ===');
  r = await scrape({ template: 'hackernews', searchString: 'AI', maxResults: 2 });
  console.log(JSON.stringify(r, null, 2));

  console.log('\n=== WIKIPEDIA ===');
  r = await scrape({ template: 'wikipedia', searchString: 'Python programming', maxResults: 2 });
  console.log(JSON.stringify(r, null, 2));
})();
