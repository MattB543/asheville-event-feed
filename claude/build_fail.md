22:05:56.499

Creating an optimized production build ...
22:05:56.685

[baseline-browser-mapping] The data in this module is over two months old. To ensure accurate Baseline data, please update: `npm i baseline-browser-mapping@latest -D`
22:06:03.365

✓ Compiled successfully in 6.3s
22:06:03.367

Running TypeScript ...
22:06:08.486

Failed to compile.
22:06:08.486

22:06:08.486

./app/api/cron/route.ts:73:17
22:06:08.486

Type error: Property 'length' does not exist on type 'PromiseSettledResult<ScrapedEvent[]>'.
22:06:08.486

Property 'length' does not exist on type 'PromiseRejectedResult'.
22:06:08.486

22:06:08.487

71 | stats.scraping.duration = Date.now() - scrapeStartTime;
22:06:08.487

72 | stats.scraping.total =
22:06:08.487

> 73 | avlEvents.length +
> 22:06:08.487

     |                 ^

22:06:08.487

74 | ebEvents.length +
22:06:08.487

75 | meetupEvents.length +
22:06:08.487

76 | harrahsEvents.length +
22:06:08.528

Next.js build worker exited with code: 1 and signal: null
22:06:08.565

Error: Command "npm run build" exited with 1
