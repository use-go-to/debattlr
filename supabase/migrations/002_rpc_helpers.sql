-- ============================================================
-- Migration 002 — RPC helpers
-- ============================================================

-- Atomic vote increment to avoid race conditions
create or replace function public.increment_topic_votes(p_topic_id uuid)
returns void language sql as $$
  update public.topics set votes = votes + 1 where id = p_topic_id;
$$;
