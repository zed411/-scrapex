const { scrapeGoogleMaps } = require('./scraper');
scrapeGoogleMaps({ searchString: 'Coffee shops', locationQuery: 'Bushwick', maxResults: 3 })
  .then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(e => console.error(e));
