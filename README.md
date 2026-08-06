# ku jom?

A geography guessing game about Kosovo. You get dropped somewhere on Street View,
look around, and pin where you think you are. Five rounds, scored by distance.

Kosovo was only added to Google Street View in July 2026, so most of this imagery
is brand new — there is no accumulated muscle memory for it yet.

**Play:** [kujom.vercel.app](https://kujom.vercel.app/)

## Features

- **10,000 real locations** across Kosovo, every one a verified Street View panorama
- **Solo play** with an all-time leaderboard
- **Challenge links** — share your exact five spots and compare scores
- **Live party rooms** — a waiting room, then everyone plays the same rounds at
  once with a live scoreboard
- **Per-game leaderboards** — everyone who plays a shared link appears on one board

## Stack

Plain HTML, CSS, and JavaScript. No build step, no framework.

| Piece | What it does |
| --- | --- |
| Google Maps Embed API | the 360° panoramas (unlimited free tier) |
| Leaflet + CARTO tiles | the guess map |
| Supabase Realtime | party rooms, presence, live scores |
| Supabase Postgres | leaderboards |

## Running locally

Any static server works:

```bash
python -m http.server 8137
# then open http://localhost:8137
```

Opening `index.html` directly from disk also works — locations load as a script,
not a `fetch`, specifically so `file://` isn't blocked by CORS.

## Setup

### 1. Leaderboards and parties (optional)

Create a free Supabase project, then run [`supabase/schema.sql`](supabase/schema.sql)
in the SQL Editor. Put your Project URL and **publishable** (anon) key in
`config.js`.

The publishable key is designed to be public — Row Level Security is what protects
the data. The policies allow reading the board and inserting a plausible score,
and nothing else: updates and deletes affect zero rows, and scores above
`rounds × 5000` are rejected by the database.

> Never put a `service_role` or `sb_secret_` key in `config.js`. It ships to every
> visitor's browser.

Without Supabase configured the game still works — party links degrade to async
challenge links, and leaderboards are hidden.

### 2. Google Maps key (recommended before launch)

The game works with no key at all, using Google's keyless share embed. For a
public deployment prefer a real key:

1. Google Cloud Console → new project
2. Enable **Maps Embed API**
3. Create an API key, restrict it to the Embed API and your domain
4. Paste it into `config.js` as `googleApiKey`

The Maps **Embed** API is free with unlimited usage, unlike the dynamic
Street View JS API which bills after 5,000 loads/month.

## Deploying

Push to GitHub, import the repo in Vercel, deploy. No build command, no output
directory, no environment variables — it's a static site.

## Regenerating the location data

`data/locations.js` is a 10,000-location sample of a larger
[map-making.app](https://map-making.app) export (`temp.json`, gitignored).
Each entry is `[lat, lng, panoId]`. The `panoId` matters: it pins each round to
one exact official panorama instead of whatever Google finds nearby.

## Known limitations

- Anyone can POST a plausible score to the leaderboard without playing, since the
  API key is necessarily public. Fixing it properly needs a server-side function
  that validates the guesses.
- Free Supabase projects pause after about a week of no traffic.
- Rounds always start facing north.

## Credits

Street View imagery © Google. Map tiles © OpenStreetMap contributors, © CARTO.
Not affiliated with Google or GeoGuessr.
