14:31:36.124 Running build in Washington, D.C., USA (East) – iad1
14:31:36.124 Build machine configuration: 4 cores, 8 GB
14:31:36.247 Cloning github.com/MattB543/asheville-event-feed (Branch: main, Commit: 77fae7f)
14:31:36.248 Previous build caches not available.
14:31:36.416 Cloning completed: 168.000ms
14:31:36.759 Running "vercel build"
14:31:37.174 Vercel CLI 48.11.0
14:31:37.782 Installing dependencies...
14:31:40.138 npm warn deprecated rimraf@3.0.2: Rimraf versions prior to v4 are no longer supported
14:31:40.702 npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.
14:31:40.743 npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported
14:31:41.864 npm warn deprecated @esbuild-kit/esm-loader@2.6.5: Merged into tsx: https://tsx.is
14:31:41.881 npm warn deprecated @esbuild-kit/core-utils@3.3.2: Merged into tsx: https://tsx.is
14:32:00.371
14:32:00.372 added 432 packages in 22s
14:32:00.372
14:32:00.372 149 packages are looking for funding
14:32:00.372 run `npm fund` for details
14:32:00.428 Running "npm run build"
14:32:00.752
14:32:00.752 > asheville-event-feed@0.1.0 build
14:32:00.752 > next build
14:32:00.752
14:32:01.641 Attention: Next.js now collects completely anonymous telemetry regarding usage.
14:32:01.642 This information is used to shape Next.js' roadmap and prioritize features.
14:32:01.642 You can learn more, including how to opt-out if you'd not like to participate in this anonymous program, by visiting the following URL:
14:32:01.642 https://nextjs.org/telemetry
14:32:01.642
14:32:01.655 ▲ Next.js 16.0.3 (Turbopack)
14:32:01.655
14:32:01.690 Creating an optimized production build ...
14:32:09.851
14:32:09.852 > Build error occurred
14:32:09.855 Error: Turbopack build failed with 5 errors:
14:32:09.855 ./node_modules/patchright-core/lib/vite/recorder/assets/codicon-DCmgc-ay.ttf
14:32:09.855 Unknown module type
14:32:09.855 This module doesn't have an associated type. Use a known file extension, or register a loader for it.
14:32:09.856
14:32:09.856 Read more: https://nextjs.org/docs/app/api-reference/next-config-js/turbo#webpack-loaders
14:32:09.856
14:32:09.856
14:32:09.856 ./node_modules/patchright-core/lib/vite/recorder/index.html
14:32:09.856 Unknown module type
14:32:09.856 This module doesn't have an associated type. Use a known file extension, or register a loader for it.
14:32:09.856
14:32:09.856 Read more: https://nextjs.org/docs/app/api-reference/next-config-js/turbo#webpack-loaders
14:32:09.856
14:32:09.856
14:32:09.856 ./node_modules/patchright-core/lib/server/bidi/bidiOverCdp.js:34:26
14:32:09.856 Module not found: Can't resolve 'chromium-bidi/lib/cjs/bidiMapper/BidiMapper'
14:32:09.856 [0m [90m 32 |[39m })[33m;[39m
14:32:09.856 [90m 33 |[39m module[33m.[39mexports [33m=[39m **toCommonJS(bidiOverCdp_exports)[33m;[39m
14:32:09.856 [31m[1m>[22m[39m[90m 34 |[39m [36mvar[39m bidiMapper [33m=[39m **toESM(require([32m"chromium-bidi/lib/cjs/bidiMapper/BidiMapper"[39m))[33m;[39m
14:32:09.857 [90m |[39m [31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m
14:32:09.857 [90m 35 |[39m [36mvar[39m bidiCdpConnection [33m=[39m **toESM(require([32m"chromium-bidi/lib/cjs/cdp/CdpConnection"[39m))[33m;[39m
14:32:09.857 [90m 36 |[39m [36mvar[39m import_debugLogger [33m=[39m require([32m"../utils/debugLogger"[39m)[33m;[39m
14:32:09.857 [90m 37 |[39m [36mconst[39m bidiServerLogger [33m=[39m (prefix[33m,[39m [33m...[39margs) [33m=>[39m {[0m
14:32:09.857
14:32:09.857
14:32:09.857
14:32:09.857 Import trace:
14:32:09.857 App Route:
14:32:09.857 ./node_modules/patchright-core/lib/server/bidi/bidiOverCdp.js
14:32:09.857 ./node_modules/patchright-core/lib/server/bidi/bidiChromium.js
14:32:09.857 ./node_modules/patchright-core/lib/server/playwright.js
14:32:09.857 ./node_modules/patchright-core/lib/androidServerImpl.js
14:32:09.857 ./node_modules/patchright-core/lib/inProcessFactory.js
14:32:09.857 ./node_modules/patchright-core/lib/inprocess.js
14:32:09.858 ./node_modules/patchright-core/index.js
14:32:09.858 ./node_modules/patchright-core/index.mjs
14:32:09.858 ./lib/scrapers/facebook-discover.ts
14:32:09.858 ./lib/scrapers/facebook.ts
14:32:09.858 ./app/api/cron/route.ts
14:32:09.858
14:32:09.858 https://nextjs.org/docs/messages/module-not-found
14:32:09.858
14:32:09.858
14:32:09.858 ./node_modules/patchright-core/lib/server/bidi/bidiOverCdp.js:35:33
14:32:09.858 Module not found: Can't resolve 'chromium-bidi/lib/cjs/cdp/CdpConnection'
14:32:09.858 [0m [90m 33 |[39m module[33m.[39mexports [33m=[39m **toCommonJS(bidiOverCdp_exports)[33m;[39m
14:32:09.858 [90m 34 |[39m [36mvar[39m bidiMapper [33m=[39m **toESM(require([32m"chromium-bidi/lib/cjs/bidiMapper/BidiMapper"[39m))[33m;[39m
14:32:09.858 [31m[1m>[22m[39m[90m 35 |[39m [36mvar[39m bidiCdpConnection [33m=[39m **toESM(require([32m"chromium-bidi/lib/cjs/cdp/CdpConnection"[39m))[33m;[39m
14:32:09.859 [90m |[39m [31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m
14:32:09.859 [90m 36 |[39m [36mvar[39m import_debugLogger [33m=[39m require([32m"../utils/debugLogger"[39m)[33m;[39m
14:32:09.859 [90m 37 |[39m [36mconst[39m bidiServerLogger [33m=[39m (prefix[33m,[39m [33m...[39margs) [33m=>[39m {
14:32:09.859 [90m 38 |[39m import_debugLogger[33m.[39mdebugLogger[33m.[39mlog(prefix[33m,[39m args)[33m;[39m[0m
14:32:09.859
14:32:09.859
14:32:09.859
14:32:09.859 Import trace:
14:32:09.859 App Route:
14:32:09.859 ./node_modules/patchright-core/lib/server/bidi/bidiOverCdp.js
14:32:09.859 ./node_modules/patchright-core/lib/server/bidi/bidiChromium.js
14:32:09.859 ./node_modules/patchright-core/lib/server/playwright.js
14:32:09.859 ./node_modules/patchright-core/lib/androidServerImpl.js
14:32:09.859 ./node_modules/patchright-core/lib/inProcessFactory.js
14:32:09.860 ./node_modules/patchright-core/lib/inprocess.js
14:32:09.860 ./node_modules/patchright-core/index.js
14:32:09.860 ./node_modules/patchright-core/index.mjs
14:32:09.860 ./lib/scrapers/facebook-discover.ts
14:32:09.860 ./lib/scrapers/facebook.ts
14:32:09.860 ./app/api/cron/route.ts
14:32:09.860
14:32:09.860 https://nextjs.org/docs/messages/module-not-found
14:32:09.860
14:32:09.860
14:32:09.860 ./node_modules/patchright-core/lib/server/electron/loader.js:2:17
14:32:09.860 Module not found: Can't resolve 'electron'
14:32:09.860 [0m [90m 1 |[39m [32m"use strict"[39m[33m;[39m
14:32:09.860 [31m[1m>[22m[39m[90m 2 |[39m [36mconst[39m { app } [33m=[39m require([32m"electron"[39m)[33m;[39m
14:32:09.860 [90m |[39m [31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m[31m[1m^[22m[39m
14:32:09.860 [90m 3 |[39m [36mconst[39m { chromiumSwitches } [33m=[39m require([32m"../chromium/chromiumSwitches"[39m)[33m;[39m
14:32:09.861 [90m 4 |[39m process[33m.[39margv[33m.[39msplice([35m1[39m[33m,[39m process[33m.[39margv[33m.[39mindexOf([32m"--remote-debugging-port=0"[39m))[33m;[39m
14:32:09.861 [90m 5 |[39m [36mfor[39m ([36mconst[39m arg [36mof[39m chromiumSwitches()) {[0m
14:32:09.861
14:32:09.861
14:32:09.861
14:32:09.861 Import trace:
14:32:09.861 App Route:
14:32:09.861 ./node_modules/patchright-core/lib/server/electron/loader.js
14:32:09.861 ./node_modules/patchright-core/lib/server/electron/electron.js
14:32:09.861 ./node_modules/patchright-core/lib/server/playwright.js
14:32:09.861 ./node_modules/patchright-core/lib/browserServerImpl.js
14:32:09.861 ./node_modules/patchright-core/lib/inProcessFactory.js
14:32:09.861 ./node_modules/patchright-core/lib/inprocess.js
14:32:09.861 ./node_modules/patchright-core/index.js
14:32:09.861 ./node_modules/patchright-core/index.mjs
14:32:09.861 ./lib/scrapers/facebook-discover.ts
14:32:09.861 ./lib/scrapers/facebook.ts
14:32:09.861 ./app/api/cron/route.ts
14:32:09.861
14:32:09.861 https://nextjs.org/docs/messages/module-not-found
14:32:09.862
14:32:09.862
14:32:09.862 at <unknown> (https://nextjs.org/docs/messages/module-not-found)
14:32:09.862 at <unknown> (https://nextjs.org/docs/messages/module-not-found)
14:32:09.862 at <unknown> (https://nextjs.org/docs/messages/module-not-found)
14:32:09.931 Error: Command "npm run build" exited with 1
