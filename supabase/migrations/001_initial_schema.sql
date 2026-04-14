-- ============================================================
-- DEBATTLE — Schéma Supabase complet
-- ============================================================

-- Extension UUID
create extension if not exists "pgcrypto";

-- ============================================================
-- TABLE: channels
-- ============================================================
create table if not exists public.channels (
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,          -- ex: "WOLF42"
  host_name    text not null,
  theme        text not null,
  status       text not null default 'lobby'  -- lobby | topic_vote | debate | ai_summary | peer_vote | manifesto | done
                check (status in ('lobby','topic_vote','debate','ai_summary','peer_vote','manifesto','done')),
  topic        text,                          -- problématique choisie après vote
  created_at   timestamptz default now()
);

-- ============================================================
-- TABLE: members
-- ============================================================
create table if not exists public.members (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid references public.channels(id) on delete cascade,
  name         text not null,
  is_host      boolean default false,
  joined_at    timestamptz default now(),
  unique(channel_id, name)
);

-- ============================================================
-- TABLE: topics (3 sujets proposés par l'IA)
-- ============================================================
create table if not exists public.topics (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid references public.channels(id) on delete cascade,
  text         text not null,
  votes        integer default 0,
  position     integer not null  -- 1, 2, 3
);

-- ============================================================
-- TABLE: topic_votes
-- ============================================================
create table if not exists public.topic_votes (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid references public.channels(id) on delete cascade,
  member_id    uuid references public.members(id) on delete cascade,
  topic_id     uuid references public.topics(id) on delete cascade,
  created_at   timestamptz default now(),
  unique(channel_id, member_id)
);

-- ============================================================
-- TABLE: debate_turns
-- ============================================================
create table if not exists public.debate_turns (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid references public.channels(id) on delete cascade,
  member_id    uuid references public.members(id) on delete cascade,
  member_name  text not null,
  round        integer not null default 1,   -- numéro du tour
  content      text not null,
  rebuttal_to  uuid references public.debate_turns(id), -- réfutation directe
  submitted_at timestamptz default now()
);

-- ============================================================
-- TABLE: ai_summaries
-- ============================================================
create table if not exists public.ai_summaries (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid references public.channels(id) on delete cascade,
  member_id    uuid references public.members(id) on delete cascade,
  member_name  text not null,
  summary      text not null,               -- synthèse de l'argument principal
  ai_feedback  text,                        -- avis de l'IA sur la solidité
  score_logic  integer,                     -- 1-10 logique
  score_clarity integer,                   -- 1-10 clarté
  score_impact integer,                    -- 1-10 impact
  created_at   timestamptz default now(),
  unique(channel_id, member_id)
);

-- ============================================================
-- TABLE: peer_votes
-- ============================================================
create table if not exists public.peer_votes (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid references public.channels(id) on delete cascade,
  voter_id     uuid references public.members(id) on delete cascade,
  voted_for_id uuid references public.members(id) on delete cascade,
  criteria     text not null,               -- ex: "logique", "clarté", "conviction"
  created_at   timestamptz default now(),
  unique(channel_id, voter_id, criteria)
);

-- ============================================================
-- TABLE: manifesto
-- ============================================================
create table if not exists public.manifesto (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid references public.channels(id) on delete cascade unique,
  content      text not null,               -- texte généré par Groq
  winner_name  text,
  public_slug  text unique,                 -- pour partage public
  created_at   timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.channels      enable row level security;
alter table public.members       enable row level security;
alter table public.topics        enable row level security;
alter table public.topic_votes   enable row level security;
alter table public.debate_turns  enable row level security;
alter table public.ai_summaries  enable row level security;
alter table public.peer_votes    enable row level security;
alter table public.manifesto     enable row level security;

-- Policies publiques (anon key — accès par code de canal)
create policy "Public read channels"      on public.channels      for select using (true);
create policy "Public insert channels"    on public.channels      for insert with check (true);
create policy "Public update channels"    on public.channels      for update using (true);

create policy "Public read members"       on public.members       for select using (true);
create policy "Public insert members"     on public.members       for insert with check (true);
create policy "Public delete members"     on public.members       for delete using (true);

create policy "Public read topics"        on public.topics        for select using (true);
create policy "Public insert topics"      on public.topics        for insert with check (true);
create policy "Public update topics"      on public.topics        for update using (true);

create policy "Public read topic_votes"   on public.topic_votes   for select using (true);
create policy "Public insert topic_votes" on public.topic_votes   for insert with check (true);

create policy "Public read debate_turns"  on public.debate_turns  for select using (true);
create policy "Public insert debate_turns" on public.debate_turns for insert with check (true);

create policy "Public read ai_summaries"  on public.ai_summaries  for select using (true);
create policy "Public insert ai_summaries" on public.ai_summaries for insert with check (true);
create policy "Public update ai_summaries" on public.ai_summaries for update using (true);

create policy "Public read peer_votes"    on public.peer_votes    for select using (true);
create policy "Public insert peer_votes"  on public.peer_votes    for insert with check (true);

create policy "Public read manifesto"     on public.manifesto     for select using (true);
create policy "Public insert manifesto"   on public.manifesto     for insert with check (true);
create policy "Public update manifesto"   on public.manifesto     for update using (true);

-- ============================================================
-- REALTIME
-- ============================================================
alter publication supabase_realtime add table public.channels;
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.topics;
alter publication supabase_realtime add table public.topic_votes;
alter publication supabase_realtime add table public.debate_turns;
alter publication supabase_realtime add table public.ai_summaries;
alter publication supabase_realtime add table public.peer_votes;
alter publication supabase_realtime add table public.manifesto;

-- ============================================================
-- HELPER: generate_channel_code()
-- ============================================================
create or replace function public.generate_channel_code()
returns text language plpgsql as $$
declare
  adjectives text[] := array['WOLF','FIRE','IRON','SAGE','BOLT','STORM','ECHO','NOVA','PEAK','FLUX'];
  code text;
  attempts int := 0;
begin
  loop
    code := adjectives[1 + floor(random() * array_length(adjectives,1))::int]
            || (10 + floor(random() * 90)::int)::text;
    exit when not exists (select 1 from public.channels where channels.code = code);
    attempts := attempts + 1;
    if attempts > 20 then raise exception 'Cannot generate unique code'; end if;
  end loop;
  return code;
end;
$$;
