-- Migration 029: atomic moment reaction increment
--
-- Replaces the read-then-write in useMoments.recordOye() with a single
-- UPDATE that cannot race. Previously: SELECT voyo_reactions, then
-- UPDATE voyo_reactions = value + 1 — two rapid OYEs both read N and
-- both write N+1, losing one increment.
--
-- Usage: supabase.rpc('record_moment_reaction', { p_moment_id: id })
-- Target project: anmgyxhnyhbyxzpjhxgx (VOYO Music)
-- Apply via Supabase SQL editor.

CREATE OR REPLACE FUNCTION record_moment_reaction(
  p_moment_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE voyo_moments
    SET voyo_reactions = COALESCE(voyo_reactions, 0) + 1
  WHERE id = p_moment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION record_moment_reaction(UUID) TO authenticated, anon;
