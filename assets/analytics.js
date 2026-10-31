// Visitor analytics. Runs only on the live site, so local previews don't count as visits.
// Umami: visitors, pages, countries, referrers, time on page (cookieless).
// Microsoft Clarity: session recordings and heatmaps.
// Google Analytics: detailed reports. Set GA_ID to the "G-..." Measurement ID to turn it on.
// To tell visits apart, share links like https://mehradfaridan.github.io/?ref=uoft
(function () {
  var UMAMI_ID = 'dd50282c-73c0-4fec-ab7c-3ffd9c1707d1';
  var CLARITY_ID = 'z64g8lc23m';
  var GA_ID = 'G-TPGYCLY45P';

  if (location.hostname !== 'mehradfaridan.github.io') return;

  function load(src, attrs) {
    var s = document.createElement('script');
    s.async = true;
    s.src = src;
    for (var k in attrs) s.setAttribute(k, attrs[k]);
    document.head.appendChild(s);
  }

  load('https://cloud.umami.is/script.js', { 'data-website-id': UMAMI_ID });

  window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
  load('https://www.clarity.ms/tag/' + CLARITY_ID);

  if (GA_ID) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
    load('https://www.googletagmanager.com/gtag/js?id=' + GA_ID);
  }
})();
