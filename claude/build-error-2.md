12:31:29.974 Running build in Washington, D.C., USA (East) – iad1
12:31:29.975 Build machine configuration: 4 cores, 8 GB
12:31:30.103 Cloning github.com/MattB543/asheville-event-feed (Branch: main, Commit: 0fcfbf0)
12:31:30.598 Cloning completed: 495.000ms
12:31:31.633 Restored build cache from previous deployment (FBR446bbNHY7AuHym5TtMYCsnt7g)
12:31:32.544 Running "vercel build"
12:31:32.983 Vercel CLI 50.1.3
12:31:33.303 Installing dependencies...
12:31:34.791
12:31:34.791 added 2 packages in 1s
12:31:34.792
12:31:34.792 227 packages are looking for funding
12:31:34.792 run `npm fund` for details
12:31:34.824 Detected Next.js version: 16.0.10
12:31:34.829 Running "npm run build"
12:31:34.928
12:31:34.928 > asheville-event-feed@0.1.0 build
12:31:34.928 > next build
12:31:34.928
12:31:35.923 ▲ Next.js 16.0.10 (Turbopack)
12:31:35.924
12:31:35.962 Creating an optimized production build ...
12:31:46.918 ✓ Compiled successfully in 10.4s
12:31:46.920 Running TypeScript ...
12:31:55.133 Failed to compile.
12:31:55.134
12:31:55.134 ./components/EventCard.tsx:102:3
12:31:55.134 Type error: 'scoreTier' is declared but its value is never read.
12:31:55.134
12:31:55.134 [0m [90m 100 |[39m displayMode [33m=[39m [32m'full'[39m[33m,[39m
12:31:55.134 [90m 101 |[39m onExpandMinimized[33m,[39m
12:31:55.134 [31m[1m>[22m[39m[90m 102 |[39m scoreTier [33m=[39m [32m'quality'[39m[33m,[39m
12:31:55.134 [90m |[39m [31m[1m^[22m[39m
12:31:55.135 [90m 103 |[39m eventScore[33m,[39m
12:31:55.135 [90m 104 |[39m }[33m:[39m [33mEventCardProps[39m) {
12:31:55.135 [90m 105 |[39m [36mconst[39m [imgError[33m,[39m setImgError] [33m=[39m useState([36mfalse[39m)[33m;[39m[0m
12:31:55.188 Next.js build worker exited with code: 1 and signal: null
12:31:55.235 Error: Command "npm run build" exited with 1
