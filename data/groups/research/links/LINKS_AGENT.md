# Group directory links agent

AVL GO (an Asheville, NC event site) has a public Group Directory of recurring community groups. Most
listings have no website, so visitors have nowhere to go when a group has no upcoming events. Your
job, per record: **find the group's real website**, and check two things the site owner cares about:
whether the group meets **in person**, and (for business networking groups only) whether it is
**worth listing**.

## Inputs

`data/groups/research/links/input/batch-NN.json` → `{ batch, records: [...] }`. Each record has:

- `key`: copy verbatim into your output.
- `status`: either `listed` (in the directory now) or `networking_recheck` (a business-networking group
  an earlier pass rejected; see "Networking" below; `earlier_reject_note` says why).
- `name`, `description`, `category`, `schedule`, `home_base`: the current listing.
- `current_website`: what we have now (often null; may be wrong).
- `meetup_url`: the group's Meetup page, if any. Stored separately; it never counts as the website.
- Live-event context: `event_count`, `future_count`, `first_seen`, `last_seen`, `organizers` (often
  the **venue**, not the group), `locations`, `sample_titles`, `sample_urls`, `description_excerpt`.

## 1. Website: search for EVERY record

Run **WebSearch** (mode "standard") for every record, with 1–3 searches each (e.g. `"<name>" Asheville`,
`"<name>" <town>`, `"<name>" facebook`), and **WebFetch** a candidate page when you're not sure it is
the right group. This pass exists because the last one barely searched. Do not skip records that already
have a `current_website`; verify those too (two were wrong last time: one pointed at a single venue
event, one at a venue's general calendar).

What counts, in order of preference:
1. The group's own website (or its page on a parent org's site, e.g. a local chapter page, a church's
   page for this specific ministry or circle, a library's page for this specific club).
2. The group's own Facebook page or group, or Instagram, when that is its main presence.
3. A national organisation's meeting-finder page for **this local meeting/chapter** (e.g. a local AA or
   Recovery Dharma meeting listing).

Never: an event aggregator (Mountain Xpress, AVL Today, Eventbrite, AllEvents, Patch, ExploreAsheville),
a venue's general calendar or a single event page, a Meetup URL, a news article, a Google Maps link,
a Linktree that only lists one event, or a site for a **different** group with a similar name.
If nothing trustworthy turns up, `website: null`. A wrong link is worse than none. Use the event
context (venue, town, host names in the descriptions) to make sure it's the same group.

## 2. Format: in person or remote only

The owner does not want groups that only meet online. Using the event `locations`, titles, descriptions
and what you find on the web:
- `in_person`: meets at physical places (most groups).
- `hybrid`: in person with an online option. That's fine; it stays.
- `remote_only`: every gathering is online/Zoom/virtual (locations like "Online", "Zoom", "Virtual
  event", no physical venue anywhere). These get removed.
- `unclear`: you genuinely cannot tell. That stays listed.

## 3. Networking: only for business / professional networking groups

Set `networking` to null for everything that is not a business-networking group (a hiking club, a
choir, a support group, a tech-interest meetup with talks, a professional association's educational
chapter are NOT networking groups for this purpose).

For groups whose main purpose is **business networking, referrals, lead generation, deal-making or
selling to each other**, judge whether a local visitor would find it legit and valuable:
- `keep`: a real, recurring, in-person group with a credible identity: a known national brand or
  established association with a real local chapter (e.g. BiggerPockets, a REIA, a chamber-style
  association), an industry group with substance (speakers, education, real membership), meeting in
  person.
- `cut`: low value or sketchy: generic "networking" mixers with no identity, one-person lead-gen
  vehicles, MLM/"wealth"/brokerage-recruiting programming, referral clubs that exist to sell
  memberships, groups with one or two events and no presence anywhere, or anything remote only.

Every `networking_recheck` record needs `keep` or `cut`. A `listed` record that turns out to be a
low-value networking group gets `cut` too.

## Output

Write `data/groups/research/links/results/batch-NN.json` (same NN), **exactly one result per input
record, in input order**:

```json
{
  "batch": 1,
  "results": [
    {
      "key": "c:blue-ridge-bicycle-club",
      "website": "https://www.blueridgebikeclub.org/",
      "website_change": "verified",
      "format": "in_person",
      "networking": null,
      "confidence": 0.9,
      "notes": "Club site lists the same weekly rides; matches the Asheville on Bikes listings."
    }
  ]
}
```

- `website`: a full `https://` URL or null.
- `website_change`: `verified` (current one is right) | `found` (we had none, you found one) |
  `replaced` (current one was wrong, yours is better) | `removed` (current one was wrong, nothing
  better found) | `none` (no website before or after).
- `format`: `in_person` | `hybrid` | `remote_only` | `unclear`.
- `networking`: null | `keep` | `cut`.
- `confidence`: 0–1, how sure you are of the website (or of the null).
- `notes`: max 200 characters: what you searched and found; why for any `remote_only`, `cut`,
  `replaced`, `removed`.

Before finishing, re-read your output and check: valid JSON, one result per input record in the same
order, keys copied exactly, every non-null website starts with `http`, enums from the lists above.
Then reply with a short summary: counts found / verified / replaced / removed / none, any
remote_only, the networking calls, and anything surprising.
