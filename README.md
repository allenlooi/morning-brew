# Morning Brew

A self-refreshing social intelligence dashboard. A scheduled job pulls fresh
items per section using the Anthropic API with live web search, merges them into
a rolling 30-day archive, and writes `data.json`. The static `index.html` reads
that file. No server to run.

> Note: "Morning Brew" is also the name of an existing US media company. Fine for
> an internal tool; pick a different name if this ever goes external.

## What's in here

| File | Purpose |
|---|---|
| `index.html` | The dashboard. Static, deployable anywhere. Reads `data.json`. White theme, blue and green accents. |
| `fetch.mjs` | Pulls fresh items, merges the 30-day archive, writes `data.json`. Edit your sections here. |
| `data.json` | Current rolling data. Auto-overwritten by the scheduled job. |
| `.github/workflows/refresh.yml` | Runs `fetch.mjs` daily and commits the result. |

## Where the data comes from

Each card links to its primary source (`source` opens the article in a new tab).
The items themselves are gathered by Claude using the **web_search** tool, which
queries the open web and returns links to publishers such as Hootsuite,
SocialPilot, Campaign Asia, Marketing-Interactive, AnyMind and the local
Malaysian and Singaporean trade press. It is search-based, not a fixed feed or a
paid listening API, so coverage and quality vary. Always verify an item against
its source before client use. To upgrade to true social listening later, the
same `fetch.mjs` pattern can call a vendor API (Meltwater, Brandwatch, Sprout)
instead of web search.

## History / the 30-day window

On first deploy you see the seeded items. From then on, every run merges new
finds into the archive and drops anything first seen more than 30 days ago. So
the dashboard always shows a rolling last-30-days view that fills out over time.
New items each run are flagged green and sorted to the top. Tune the window with
`RETAIN_DAYS` in `fetch.mjs`.

## Setup (about 10 minutes)

1. **Create a GitHub repo** and add all of these files (keep the
   `.github/workflows/` folder structure intact).
2. **Get an Anthropic API key** at https://console.anthropic.com. This is
   separate from your Claude chat subscription.
3. **Add the key as a repo secret.** Settings → Secrets and variables → Actions →
   New repository secret, named exactly `ANTHROPIC_API_KEY`.
4. **Turn on Pages.** Settings → Pages → Source "Deploy from a branch", branch
   `main`, folder `/ (root)`. Live at `https://<username>.github.io/<repo>/`.
5. **Run it once.** Actions → "Refresh Morning Brew" → "Run workflow".

## Schedule

Set in `.github/workflows/refresh.yml`. Default `0 23 * * *` is **07:00 Singapore
time** daily (GitHub cron uses UTC). Add another `- cron:` line to run more often.

## Change the sections

Edit the `SECTIONS` array in `fetch.mjs`: `id`, `label`, `desc`, `hint`. The
dashboard adapts automatically to whatever sections are in `data.json`.

## Cost

Roughly seven searches plus light generation per run, a few US cents per day.
Swap `MODEL` to a Haiku string (see API docs) to cut it further.

## Run locally (optional)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node fetch.mjs
python3 -m http.server   # open http://localhost:8000
```
