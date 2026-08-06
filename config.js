// ============================================================
// ku jom? — configuration
// ============================================================
//
// googleApiKey (optional but recommended for a public launch):
//   A free Google Maps Platform key with the *Maps Embed API*
//   enabled. The Embed API has unlimited free usage — it never
//   bills, regardless of traffic.
//
//   1. console.cloud.google.com → create project
//   2. Enable "Maps Embed API"
//   3. Create an API key, restrict it to your domain + Embed API
//   4. Paste it below
//
// If left empty, the game falls back to Google's keyless share
// embed, which also works without any account.
//
// supabaseUrl / supabaseAnonKey (optional — enables live parties):
//   Powers the waiting room, live player list, and scoreboard.
//   Realtime channels need NO database tables — just the project.
//
//   1. supabase.com → New project (free, no card)
//   2. Project Settings → API
//   3. Copy "Project URL" and the "anon public" key below
//
//   The anon key is designed to be public — safe in a static site.
//   Note: free projects pause after ~1 week with zero traffic
//   (one click to restore in the dashboard).
//
// If left empty, party links fall back to async challenges
// (same rounds, compare scores after).
//
window.KUJOM_CONFIG = {
  googleApiKey: "",
  supabaseUrl: "https://inqxznzqhhwyhdqtfccf.supabase.co",
  supabaseAnonKey: "sb_publishable_IJZkIGw2fyLr4c0B_ApQtg_Zg2Ro2gv",
  roundsPerGame: 5,
  maxScore: 5000,
  // score falloff in km — smaller = stricter. 15 is tuned for
  // a country the size of Kosovo.
  falloffKm: 15,
};
