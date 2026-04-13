-- Compatibility mode for student login via email + student_id (no Supabase Auth required for students)
-- Run this in Supabase SQL Editor if student login returns 401 on students table.
-- WARNING: This mode is less strict than auth-bound mode.

BEGIN;

-- 1) Grants for public client access used by student flow
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.students TO anon, authenticated;
GRANT SELECT ON public.elections, public.election_positions, public.election_candidates, public.election_eligible_students, public.positions, public.candidates TO anon, authenticated;
GRANT SELECT, INSERT ON public.votes TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- 2) Students: allow lookup by email + student_id from browser
DROP POLICY IF EXISTS "Students can read own profile by email" ON public.students;
DROP POLICY IF EXISTS "Allow anonymous to view students for login" ON public.students;
DROP POLICY IF EXISTS "students_anon_select" ON public.students;

CREATE POLICY "students_anon_select" ON public.students
FOR SELECT
TO anon, authenticated
USING (true);

-- Keep admin full management policy
DROP POLICY IF EXISTS "Allow authenticated admins to manage students" ON public.students;
CREATE POLICY "Allow authenticated admins to manage students" ON public.students
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

-- 3) Election metadata readable to public client
DROP POLICY IF EXISTS "Public read elections" ON public.elections;
CREATE POLICY "Public read elections" ON public.elections
FOR SELECT TO public
USING (true);

DROP POLICY IF EXISTS "Public read election positions" ON public.election_positions;
CREATE POLICY "Public read election positions" ON public.election_positions
FOR SELECT TO public
USING (true);

DROP POLICY IF EXISTS "Public read election candidates" ON public.election_candidates;
CREATE POLICY "Public read election candidates" ON public.election_candidates
FOR SELECT TO public
USING (true);

DROP POLICY IF EXISTS "Public read positions" ON public.positions;
CREATE POLICY "Public read positions" ON public.positions
FOR SELECT TO public
USING (true);

DROP POLICY IF EXISTS "Public read candidates" ON public.candidates;
CREATE POLICY "Public read candidates" ON public.candidates
FOR SELECT TO public
USING (true);

-- Eligibility is needed by student routing + ballot checks
DROP POLICY IF EXISTS "Allow students to view own eligibility" ON public.election_eligible_students;
DROP POLICY IF EXISTS "Public read election eligibility" ON public.election_eligible_students;
CREATE POLICY "Public read election eligibility" ON public.election_eligible_students
FOR SELECT TO public
USING (true);

-- Keep admin manage eligibility
DROP POLICY IF EXISTS "Allow admins to manage election eligibility" ON public.election_eligible_students;
CREATE POLICY "Allow admins to manage election eligibility" ON public.election_eligible_students
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

-- 4) Votes: allow public select/insert required by current student.js flow
DROP POLICY IF EXISTS "Students can read own votes by profile link" ON public.votes;
DROP POLICY IF EXISTS "Allow students to see their own votes" ON public.votes;
DROP POLICY IF EXISTS "Public read votes" ON public.votes;
CREATE POLICY "Public read votes" ON public.votes
FOR SELECT TO public
USING (true);

DROP POLICY IF EXISTS "Students can insert own votes by profile link" ON public.votes;
DROP POLICY IF EXISTS "Allow students to insert their own votes" ON public.votes;
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

-- Keep admin vote read policy
DROP POLICY IF EXISTS "Allow admins to see all votes" ON public.votes;
CREATE POLICY "Allow admins to see all votes" ON public.votes
FOR SELECT
TO authenticated
USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

COMMIT;
