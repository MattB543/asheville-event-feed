/*
 * AVL GO banner for partner sites hosted under avlgo.com (nathan.avlgo.com).
 *
 * The partner page loads this with one script tag and an empty <avlgo-banner>
 * at the top of <body>. It draws only on the hosts in HOSTS, or anywhere with
 * ?avlgo-banner=1 (for testing before DNS is set up), inside a shadow root so
 * neither site's CSS reaches the other. It is a static file, so every deploy
 * updates every partner page; keep HEIGHT in step with the partner's reserved
 * space (their setup guide says 44px).
 *
 * The links are a copy of the header's main tabs (components/EventTabSwitcher.tsx).
 */
(function () {
  var HOSTS = ['nathan.avlgo.com'];
  var SITE = 'https://www.avlgo.com';
  var HEIGHT = 44;
  var LINKS = [
    { href: '/events', label: 'Events' },
    { href: '/events/top30', label: 'Top events' },
    { href: '/news', label: 'News' },
    { href: '/parking', label: 'Parking' },
    { href: '/camps', label: 'Summer camps' },
  ];

  var forced = /[?&]avlgo-banner=1(?:&|$)/.test(location.search);
  if (HOSTS.indexOf(location.hostname) === -1 && !forced) return;
  if (!window.customElements || customElements.get('avlgo-banner')) return;

  var css =
    ':host{all:initial;display:block;height:calc(' + HEIGHT + 'px + env(safe-area-inset-top,0px));' +
    'box-sizing:border-box;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) 0 env(safe-area-inset-left,0px);background:#fff;' +
    'border-bottom:1px solid #e5e7eb;font:500 14px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
    '-webkit-font-smoothing:antialiased;position:relative;z-index:11}' +
    '.bar{height:' + HEIGHT + 'px;max-width:1200px;margin:0 auto;padding:0 16px;box-sizing:border-box;' +
    'display:flex;align-items:center;gap:14px}' +
    '.logo{flex:none;display:flex;align-items:center;height:100%}' +
    '.logo img{height:20px;width:auto;display:block}' +
    '.sep{flex:none;width:1px;height:18px;background:#e5e7eb}' +
    'nav{flex:1;min-width:0;display:flex;align-items:center;gap:2px;overflow-x:auto;' +
    'scrollbar-width:none;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent);' +
    'mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent);padding-right:24px}' +
    'nav::-webkit-scrollbar{display:none}' +
    'a{color:inherit;text-decoration:none}' +
    'nav a{flex:none;color:#6b7280;padding:7px 10px;border-radius:6px;white-space:nowrap;transition:color .15s,background .15s}' +
    'nav a:hover{color:#0871aa;background:#e8f4f8}' +
    // Inset: the nav scrolls sideways, so it clips anything drawn outside its links
    'a:focus-visible{outline:2px solid #0871aa;outline-offset:-2px}' +
    '.tag{flex:none;margin-left:auto;font-size:12px;font-weight:400;color:#6b7280;white-space:nowrap}' +
    '@media (max-width:767px){.tag{display:none}nav{padding-right:16px}}' +
    '@media (max-width:480px){.bar{gap:8px;padding:0 0 0 12px}.logo img{height:17px}nav a{padding:7px 7px;font-size:13px}.sep{display:none}}';

  var nav = LINKS.map(function (l) {
    return '<a href="' + SITE + l.href + '">' + l.label + '</a>';
  }).join('');

  var html =
    '<style>' + css + '</style>' +
    // No role="banner": the partner page has its own header landmark; the labeled nav is ours
    '<div class="bar">' +
    '<a class="logo" href="' + SITE + '/" aria-label="AVL GO home">' +
    '<img src="' + SITE + '/avlgo_logo.png" alt="AVL GO" width="73" height="20"></a>' +
    '<span class="sep" aria-hidden="true"></span>' +
    '<nav aria-label="AVL GO">' + nav + '</nav>' +
    '<span class="tag">Every Asheville event, one place</span>' +
    '</div>';

  customElements.define(
    'avlgo-banner',
    class extends HTMLElement {
      connectedCallback() {
        if (this.shadowRoot) return;
        this.attachShadow({ mode: 'open' }).innerHTML = html;
      }
    }
  );

  // A page that skipped the placeholder still gets the banner, just with a shift. Only once
  // parsing is done: an async script can run before the parser reaches the placeholder,
  // and inserting one then would leave two banners
  function ensure() {
    if (!document.querySelector('avlgo-banner')) {
      document.body.insertBefore(document.createElement('avlgo-banner'), document.body.firstChild);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure);
  else ensure();
})();
