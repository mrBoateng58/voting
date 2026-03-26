-- Fix student vote submission permissions for email + student_id login mode
-- Run in Supabase SQL Editor.
-- This enables INSERT into votes for anon/authenticated clients without requiring Supabase Auth uid.

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT INSERT, SELECT ON TABLE public.votes TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;

-- Remove stricter auth.uid-based policies that block student-ID login mode.
DROP POLICY IF EXISTS "Allow students to insert their own votes" ON public.votes;
DROP POLICY IF EXISTS "Students can insert own votes by profile link" ON public.votes;

-- Keep admin read policy if present.
-- DROP/CREATE is not required here for admin read policies.

-- Allow vote inserts when:
-- 1) student exists
-- 2) election is active
-- 3) student is eligible OR election has no eligibility rows (open election)
-- 4) candidate belongs to selected election when mappings exist
DROP POLICY IF EXISTS "Allow public student vote insert" ON public.votes;
CREATE POLICY "Allow public student vote insert" ON public.votes
FOR INSERT
TO public
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.id = votes.student_id
  )
  AND EXISTS (
    SELECT 1
    FROM public.elections e
    WHERE e.id = votes.election_id
      AND e.status = 'active'
  )
  AND (
    NOT EXISTS (
      SELECT 1
      FROM public.election_eligible_students es
      WHERE es.election_id = votes.election_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.election_eligible_students es
      WHERE es.election_id = votes.election_id
        AND es.student_id = votes.student_id
    )
  )
  AND (
    NOT EXISTS (
      SELECT 1
      FROM public.election_candidates ec
      WHERE ec.election_id = votes.election_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.election_candidates ec
      WHERE ec.election_id = votes.election_id
        AND ec.candidate_id = votes.candidate_id
    )
  )
);
