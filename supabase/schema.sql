-- ============================================================
-- ku jom? — leaderboard schema
-- Run this once in: Supabase dashboard → SQL Editor → New query
-- ============================================================

create table if not exists public.scores (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null,
  score      integer     not null,
  rounds     integer     not null default 5,
  -- null = solo game (counts toward the all-time board)
  -- 'c:<code>' = challenge link, 'p:<code>' = live party room
  party      text,
  created_at timestamptz not null default now(),

  constraint name_len   check (char_length(name) between 1 and 20),
  constraint score_sane check (score >= 0 and score <= rounds * 5000),
  constraint rounds_ok  check (rounds between 1 and 10),
  constraint party_len  check (party is null or char_length(party) <= 24)
);

-- all-time solo board
create index if not exists scores_global_idx
  on public.scores (score desc, created_at)
  where party is null;

-- per-game board (challenge links and party rooms)
create index if not exists scores_party_idx
  on public.scores (party, score desc, created_at)
  where party is not null;

-- ------------------------------------------------------------
-- Row Level Security: anyone may read the boards and post a
-- score, but nobody can edit or delete existing rows.
-- ------------------------------------------------------------
alter table public.scores enable row level security;

drop policy if exists "read scores" on public.scores;
create policy "read scores"
  on public.scores for select
  to anon, authenticated
  using (true);

drop policy if exists "post score" on public.scores;
create policy "post score"
  on public.scores for insert
  to anon, authenticated
  with check (
    char_length(name) between 1 and 20
    and rounds between 1 and 10
    and score >= 0
    and score <= rounds * 5000
  );
