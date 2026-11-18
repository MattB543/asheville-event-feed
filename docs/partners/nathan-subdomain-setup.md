# Serving Nathan's Newsletter at nathan.avlgo.com, with the AVL GO banner

Hand this whole file to the Claude (or other coding agent) that works on the
nathansnewsletter.com codebase. It explains what we're doing and why, the exact code
to add, what to check, and what to send back to Matt.

## What this is

AVL GO (www.avlgo.com, Matt's Asheville events site) wants to offer Nathan's
Newsletter at **nathan.avlgo.com**. That address will serve **the same site, from the
same hosting, with the same files** as nathansnewsletter.com. The only difference is a
thin AVL GO banner across the very top of the page, 44px tall, linking back to AVL GO.

- On **nathansnewsletter.com** nothing changes, visually or otherwise. The banner never
  draws there, and its script isn't even downloaded.
- On **nathan.avlgo.com** the banner sits above the site as a normal block. It scrolls
  away with the page; it is not fixed or sticky.
- AVL GO hosts the banner script, so when Matt changes the banner, nathan.avlgo.com
  picks it up on the next page load. **Don't copy the script into this repo**; always
  load it from `https://www.avlgo.com/embed/banner.js`.
- The banner draws inside a Shadow DOM, so this site's CSS can't reach it and its CSS
  can't reach this site. That only isolates styling: the script itself runs with this
  page's full privileges, like any script tag. Including it means trusting AVL GO.
- Nathan owns and runs everything else: the content, the Buttondown list, the hosting.
  AVL GO only provides the banner and the DNS name.

## The contract (what AVL GO promises, and what this site provides)

- **The element:** `<avlgo-banner>`, as the first child of `<body>`.
- **The height:** exactly `44px + env(safe-area-inset-top)`. This site reserves that
  space so nothing shifts when the script arrives.
- **Where it draws:** only on `nathan.avlgo.com`, or on any host when the URL has
  `?avlgo-banner=1` (for testing).
- **If it fails:** if www.avlgo.com is down or slow, or an ad blocker blocks the script,
  this site renders normally, with just the 44px reserved strip left empty.
- **Security headers:** the site sends no Content-Security-Policy today. If one is ever
  added, it must allow the script and logo from `https://www.avlgo.com` and the inline
  snippet from Step 2 (by hash or nonce). Don't loosen a CSP more than that.
- **Changes:** if AVL GO ever changes the height or the element name, Matt will tell
  Nathan first.

## Step 0: Wait for Matt's deploy

The banner script has to be live before any of this can be tested. Check that
`https://www.avlgo.com/embed/banner.js` returns JavaScript (status 200), not a 404. If
it 404s, tell Nathan to ask Matt to deploy it.

## Step 1: Serve the site on nathan.avlgo.com

Add `nathan.avlgo.com` as a second custom domain on the hosting that serves
nathansnewsletter.com. Keep nathansnewsletter.com as the primary domain. Don't redirect
either domain to the other: both must serve the pages directly.

The site is behind Cloudflare. Find out how it's actually hosted (look for
`wrangler.toml` / `wrangler.jsonc`, a Pages project, a `netlify.toml`, a `vercel.json`,
a GitHub Pages `CNAME` file, or a deploy script), then:

- **Cloudflare Pages:** Pages project → Custom domains → _Set up a custom domain_ →
  `nathan.avlgo.com`. avlgo.com's DNS is **not** on Cloudflare (it's at Namecheap), so
  Cloudflare will ask for a CNAME to `<project>.pages.dev`. That's expected: Matt adds
  it. No nameserver change is needed.
- **Cloudflare Workers (static assets):** Workers _custom domains_ and _routes_ only
  work for zones in this Cloudflare account, and avlgo.com isn't one. The simplest fix
  is a Pages project that serves the same build output. It must deploy automatically
  on **every** production deploy, not as a one-time copy, with the same headers and
  redirects. It also needs a top-level `404.html`: without one, Pages serves the home
  page for every unknown path. Cloudflare for SaaS custom hostnames is the alternative.
  Pick one and explain it to Nathan.
- **Netlify / Vercel:** add it as a domain alias. Both give a CNAME target.
- **GitHub Pages:** it allows only one custom domain per repo, so this won't work as
  is. Tell Nathan and stop at this step.

The host will issue the HTTPS certificate once Matt's CNAME is live. That can take a
few minutes after DNS changes. Make sure `http://nathan.avlgo.com/...` redirects to
`https://nathan.avlgo.com/...` on the same host, keeping the path and query. Most hosts
have an "Always use HTTPS" setting for this.

## Step 2: Add the banner to every page

Add this to the `<head>` of **every** page template: home, each issue page, `about/`,
`local/`, `halloween/`, 404 and anything else. It goes after the stylesheet link, so
it overrides nothing.

```html
<script>
  // AVL GO banner: only on nathan.avlgo.com (or ?avlgo-banner=1 to test anywhere)
  if (
    location.hostname === 'nathan.avlgo.com' ||
    /[?&]avlgo-banner=1(?:&|$)/.test(location.search)
  ) {
    document.documentElement.classList.add('avlgo');
    var s = document.createElement('script');
    s.src = 'https://www.avlgo.com/embed/banner.js';
    s.async = true;
    document.head.appendChild(s);
  }
</script>
<style>
  avlgo-banner {
    display: none;
  }
  html.avlgo avlgo-banner {
    display: block;
    height: calc(44px + env(safe-area-inset-top, 0px));
  }
</style>
```

Then make this the **very first thing inside `<body>`** on every page:

```html
<avlgo-banner></avlgo-banner>
```

If the site ever adds a "skip to content" link, put that first and the banner right
after it, so keyboard users can still skip straight to the content.

Why it's built like this:

- The inline check means nathansnewsletter.com never downloads AVL GO's script.
- The `html.avlgo` class reserves the 44px before the script arrives, so the page
  doesn't jump.
- The script is async, so it never delays this site's own rendering.

If the site is generated (a build script, templates or partials), put both snippets in
the shared layout or partial, not in each output file.

## Step 3: Keep search engines pointed at nathansnewsletter.com

nathan.avlgo.com serves the same pages, so it has to tell Google the original lives on
nathansnewsletter.com. Otherwise the two hosts compete as duplicates.

- `<link rel="canonical">` and `og:url` must stay **absolute
  `https://nathansnewsletter.com/...` URLs** on every page. Check that nothing builds
  them from `location` or a relative path. They already look right on the home page;
  confirm the templates hard-code the domain.
- JSON-LD `url` / `@id` values: same rule, keep them on nathansnewsletter.com.
- `sitemap.xml`, `robots.txt` and `feed.xml` keep listing nathansnewsletter.com URLs.
  No changes there.

## Step 4: Keep visitors on whichever host they came in on

Someone browsing nathan.avlgo.com should stay there when they click around the site.

- **Navigation links** in the templates and scripts that point at
  `https://nathansnewsletter.com/...` should become **root-relative**, keeping the rest
  of the URL: `https://nathansnewsletter.com/halloween/` → `/halloween/`, the home link
  → `/`. Use root-relative paths, not `./` or `halloween/`: those resolve differently
  from nested pages like `/issues/2026-10-30/`. Links that are already relative and
  work, leave alone.
- **Leave these absolute** on nathansnewsletter.com: the canonical / `og:url` /
  JSON-LD URLs from Step 3, `feed.xml` links, and anything that's emailed (the
  newsletter itself).
- **Generated share and export links:** `issueUrl()` in `assets/widgets.js` builds
  from `location.origin`, and card sharing uses the current page URL. On
  nathan.avlgo.com those would hand out nathan.avlgo.com links. Shared links should
  promote nathansnewsletter.com, so build them from that domain instead.

`assets/site.js` treats links whose `hostname` differs from `location.hostname` as
external (around line 84). After the change above that does the right thing on both
hosts. Also search the code for any other hard-coded `nathansnewsletter.com` used in a
hostname comparison, and make it work on both hosts.

## Step 5: Analytics

The Umami script has `data-domains="nathansnewsletter.com"`, so visits to
nathan.avlgo.com aren't counted. Change it to:

```html
data-domains="nathansnewsletter.com,nathan.avlgo.com"
```

Umami records the hostname, so Nathan can still split the two in reports.

## Step 6: Check the layout with the banner on

Add `?avlgo-banner=1` to any page, locally or on the live site, and the banner draws as
it will on nathan.avlgo.com. Check these at 320px, 375px (phones), 768px and 1280px:

- **`.datebar` (sticky, `top: 0`):** at the top of the page it should sit just under
  the banner. Once you scroll past the banner it should stick to the top of the screen
  as it does today.
- **`.site { min-height: 100vh }`:** the page is now 44px taller than the screen on
  short pages. That's fine, but if Nathan wants it exact, add
  `html.avlgo .site { min-height: calc(100vh - 44px - env(safe-area-inset-top, 0px)); }`.
- **Fixed elements** (`.dock`, `.dock-sheet`, `.preview-kit`, `.card-modal`): they're
  pinned to the bottom of the screen or cover all of it, so the banner doesn't affect
  them. Confirm they still look right.
- **`.rail` / `.rail-in` (sticky sidebar at 1100px+) and in-page jumps** (the `.jump`
  list, `#anchor` links): they use `--stick` and the `.band` / `.pick` scroll margins
  to clear the sticky datebar. Confirm a jump still lands with its heading visible
  below the datebar, and the rail still lines up after scrolling.
- **iPhone notch:** the banner pads itself by `safe-area-inset-top` (and left/right in
  landscape). `.datebar` also pads by `safe-area-inset-top` all the time, so where
  that inset isn't zero (an iPhone in landscape, or saved to the home screen), the
  top of the page has the inset twice until the datebar sticks. If that looks wrong,
  add `html.avlgo .datebar { padding-top: 0; }` and only pad it once it's stuck.
- **Keyboard and the card modal:** the modal moves focus into itself, but Tab can
  still reach links behind it, and now that includes the banner's links. Optional
  improvement: make the page behind the modal `inert` while it's open (including
  `<avlgo-banner>`), or switch to a native `<dialog>` with `showModal()`.
- **Signup form** (Buttondown): subscribe once from `?avlgo-banner=1` and confirm it
  arrives in Buttondown.

## Step 7: Things that are separate per host (no action needed)

- **localStorage** belongs to one host. A visitor's saved "My weekend" picks on
  nathansnewsletter.com won't show up on nathan.avlgo.com, and the reverse. That's
  expected; most people will only ever use one of them.
- **Cookies:** if this site sets any, they stay on the host that set them. Never set a
  cookie with `Domain=avlgo.com` or `.avlgo.com`: it would reach every avlgo.com site.

## Step 8: Deploy, then send Matt this

1. The **CNAME target** for `nathan` (e.g. `nathans-newsletter.pages.dev`), plus any
   **TXT verification record** the host asks for (name and value).
2. Which hosting platform it is and how nathan.avlgo.com gets deployed (same project,
   or a second one that deploys automatically).
3. Confirmation that Steps 2-5 are deployed to production.
4. Screenshots of `https://nathansnewsletter.com/?avlgo-banner=1` at phone and desktop
   widths.

Once Matt has added the DNS record and the certificate is issued, check on the real
subdomain (the `?avlgo-banner=1` preview can't test hosting, analytics or storage):

- `https://nathan.avlgo.com/` shows the banner, and so do an issue page, `about/`,
  `local/` and `halloween/`, with all their images, styles and scripts loading.
- `http://nathan.avlgo.com/about/` redirects to `https://nathan.avlgo.com/about/`.
- `https://nathan.avlgo.com/no-such-page/` returns a real 404, not the home page.
- "My weekend", the cards and add-to-calendar work there.
- Umami records the visit under the nathan.avlgo.com hostname.
- A Buttondown signup from nathan.avlgo.com arrives.
- View source: the canonical still says nathansnewsletter.com.
- `https://nathansnewsletter.com/` shows no banner and loads nothing from avlgo.com
  (DevTools → Network, filter "avlgo").

## Turning it off

- **Just the banner:** delete the Step 2 snippet. nathan.avlgo.com keeps serving the
  site without it.
- **Ending the subdomain:** in this order:
  1. Matt deletes the `nathan` CNAME.
  2. Nathan leaves nathan.avlgo.com attached on his hosting for a day, so cached DNS
     answers expire.
  3. Then Nathan removes it from the hosting.

  The order matters. A CNAME left pointing at a host that no longer claims the name
  is a "dangling" record: on some hosts anyone could claim that hostname and serve
  their own pages at nathan.avlgo.com.
