# Group directory links: fill-in pass

The first links pass (`data/groups/research/links/LINKS_AGENT.md`) ran out of WebSearch budget
partway through, so most of its "no website" answers were never actually searched. This pass redoes
those records **without the WebSearch tool** (its session budget is spent), using two local helpers.

**Read `data/groups/research/links/LINKS_AGENT.md` first.** Its rules for what counts as a website,
`format` and `networking`, and its output schema, all apply unchanged. Only the tooling and the
inputs differ.

## Tools: use these, not WebSearch / WebFetch

Run them with the Bash tool (`SCRATCH` is
`C:/Users/matth/AppData/Local/Temp/claude/C--Users-matth-projects-asheville-event-feed/c46b3e4d-c47a-4b2f-9c84-0c97669cbc2d/scratchpad`):

- Search: `node "$SCRATCH/search.mjs" "<query>" [max]` prints title / URL / snippet for the top results
  (DuckDuckGo, Brave fallback). It spaces requests out across all agents, so each call may take a few
  seconds; that's expected. If it prints `NO RESULTS`, rephrase (drop quotes, add the town) and try once
  more.
- Verify a page: `node "$SCRATCH/page.mjs" "<url>" [chars]` prints status, final URL, title, meta
  description and the start of the visible text.

Search **every** record (1–3 queries, e.g. `"<name>" Asheville`, `<name> <town> <activity>`,
`<name> facebook`). Verify a candidate with page.mjs before using it unless the search snippet already
makes it unambiguous. Facebook and Instagram pages often won't fetch; a search result whose title and
snippet clearly name the group (and its town) is enough for those.

## Inputs

`data/groups/research/links/fill/input/batch-NN.json` → `{ batch, records }`. Each record is a links-pass
input record (see LINKS_AGENT.md) plus `previous`:

- `previous: null`: this record's first-pass result was lost. Do the **full** job: website, format
  and networking.
- `previous: {...}`: the first-pass result. Redo the **website** search properly. Keep `format` and
  `networking` from `previous` unless you find clear evidence they're wrong (say so in `notes`).

## Output

Write `data/groups/research/links/fill/results/batch-NN.json` (same NN) with exactly one result per
input record, in input order, in the LINKS_AGENT.md schema (`key`, `website`, `website_change`,
`format`, `networking`, `confidence`, `notes`). `website_change` is relative to the record's
`current_website` (not to `previous`). Write the file directly with the Write tool or a script
**inside your own batch folder path**; never use a shared temp path like `/tmp/gen.py` (agents collided
on that last time).

Before finishing, re-read the output and check: valid JSON, one result per record, same order, keys
exact, URLs start with http, enums valid. Reply with counts (found / verified / replaced / removed /
none) and anything surprising.
