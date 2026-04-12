-- Secure, idempotent schema + policy setup for auth-based voting flow
-- Run this in Supabase SQL Editor (single script).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Core tables (safe if already created)
CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  student_id text UNIQUE NOT NULL,
  email text UNIQUE NOT NULL,
  department text,
  has_voted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admins (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_auth_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.positions (
  id bigserial PRIMARY KEY,
  position_name text UNIQUE NOT NULL,
  max_vote int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.candidates (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  position_id bigint NOT NULL REFERENCES public.positions(id) ON DELETE CASCADE,
  photo text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.election_settings (
  id bigserial PRIMARY KEY,
  election_name text NOT NULL,
  start_time timestamptz,
  end_time timestamptz,
  status int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.elections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_time timestamptz,
  end_time timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.election_positions (
  id bigserial PRIMARY KEY,
  election_id uuid NOT NULL REFERENCES public.elections(id) ON DELETE CASCADE,
  position_id bigint NOT NULL REFERENCES public.positions(id) ON DELETE CASCADE,
  UNIQUE (election_id, position_id)
);

CREATE TABLE IF NOT EXISTS public.election_candidates (
  id bigserial PRIMARY KEY,
  election_id uuid NOT NULL REFERENCES public.elections(id) ON DELETE CASCADE,
  candidate_id bigint NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (election_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS public.election_eligible_students (
  id bigserial PRIMARY KEY,
  election_id uuid NOT NULL REFERENCES public.elections(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (election_id, student_id)
);

CREATE TABLE IF NOT EXISTS public.votes (
  id bigserial PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  candidate_id bigint NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  position_id bigint NOT NULL REFERENCES public.positions(id) ON DELETE CASCADE,
  election_id uuid REFERENCES public.elections(id) ON DELETE CASCADE,
  vote_time timestamptz NOT NULL DEFAULT now()
);

-- Ensure votes has election_id column on older deployments
ALTER TABLE public.votes
  ADD COLUMN IF NOT EXISTS election_id uuid REFERENCES public.elections(id) ON DELETE CASCADE;

-- Move uniqueness from (student_id, position_id) to (student_id, election_id, position_id)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'votes_student_id_position_id_key'
      AND conrelid = 'public.votes'::regclass
  ) THEN
    ALTER TABLE public.votes DROP CONSTRAINT votes_student_id_position_id_key;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'votes_student_election_position_unique'
      AND conrelid = 'public.votes'::regclass
  ) THEN
    ALTER TABLE public.votes
      ADD CONSTRAINT votes_student_election_position_unique
      UNIQUE (student_id, election_id, position_id);
  END IF;
END $$;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_votes_election_id ON public.votes(election_id);
CREATE INDEX IF NOT EXISTS idx_votes_student_id ON public.votes(student_id);
CREATE INDEX IF NOT EXISTS idx_election_positions_election_id ON public.election_positions(election_id);
CREATE INDEX IF NOT EXISTS idx_election_candidates_election_id ON public.election_candidates(election_id);
CREATE INDEX IF NOT EXISTS idx_election_eligible_students_election_id ON public.election_eligible_students(election_id);

-- Grants
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

GRANT SELECT ON public.positions, public.candidates, public.elections, public.election_positions, public.election_candidates TO anon, authenticated;
GRANT SELECT ON public.students, public.votes, public.election_eligible_students, public.admins, public.election_settings TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.students, public.positions, public.candidates, public.elections, public.election_positions, public.election_candidates, public.election_eligible_students TO authenticated;
GRANT INSERT ON public.votes TO authenticated;
REVOKE ALL ON public.students FROM anon;

-- Student login identity verifier for OTP flow (email + student_id pre-check)
CREATE OR REPLACE FUNCTION public.verify_student_login_identity(
  p_email text,
  p_student_id text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE lower(s.email) = lower(trim(p_email))
      AND s.student_id = trim(p_student_id)
  );
$$;

REVOKE ALL ON FUNCTION public.verify_student_login_identity(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_student_login_identity(text, text) TO anon, authenticated;

-- Enable RLS
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.election_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.election_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.election_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.election_eligible_students ENABLE ROW LEVEL SECURITY;

-- Drop old or conflicting policies
DROP POLICY IF EXISTS "Allow anonymous to view students for login" ON public.students;
DROP POLICY IF EXISTS "students_anon_select" ON public.students;
DROP POLICY IF EXISTS "students_service_all" ON public.students;
DROP POLICY IF EXISTS "Allow students to see their own data" ON public.students;
DROP POLICY IF EXISTS "Students can read own profile by email" ON public.students;
DROP POLICY IF EXISTS "Students can update own voted flag" ON public.students;
DROP POLICY IF EXISTS "Allow admins to manage all student data" ON public.students;
DROP POLICY IF EXISTS "Allow authenticated admins to manage students" ON public.students;

DROP POLICY IF EXISTS "Allow authenticated users to check if they are admin" ON public.admins;
DROP POLICY IF EXISTS "Deny all other access to admins table" ON public.admins;
DROP POLICY IF EXISTS "Admins self lookup" ON public.admins;
DROP POLICY IF EXISTS "No anon admin rows" ON public.admins;

DROP POLICY IF EXISTS "Allow anyone to view positions" ON public.positions;
DROP POLICY IF EXISTS "Public read positions" ON public.positions;
DROP POLICY IF EXISTS "Allow admins to manage positions" ON public.positions;

DROP POLICY IF EXISTS "Allow anyone to view candidates" ON public.candidates;
DROP POLICY IF EXISTS "Public read candidates" ON public.candidates;
DROP POLICY IF EXISTS "Allow admins to manage candidates" ON public.candidates;

DROP POLICY IF EXISTS "Allow students to insert their own votes" ON public.votes;
DROP POLICY IF EXISTS "Students can insert own votes by profile link" ON public.votes;
DROP POLICY IF EXISTS "Allow public student vote insert" ON public.votes;
DROP POLICY IF EXISTS "Allow students to see their own votes" ON public.votes;
DROP POLICY IF EXISTS "Students can read own votes by profile link" ON public.votes;
DROP POLICY IF EXISTS "Allow admins to see all votes" ON public.votes;
DROP POLICY IF EXISTS "Allow authenticated admins to manage votes" ON public.votes;
DROP POLICY IF EXISTS "Allow authenticated admins to delete votes" ON public.votes;

DROP POLICY IF EXISTS "Allow anyone to view election settings" ON public.election_settings;
DROP POLICY IF EXISTS "Allow admins to manage election settings" ON public.election_settings;

DROP POLICY IF EXISTS "Allow anyone to view elections" ON public.elections;
DROP POLICY IF EXISTS "Public read elections" ON public.elections;
DROP POLICY IF EXISTS "Allow admins to manage elections" ON public.elections;
DROP POLICY IF EXISTS "Allow authenticated admins to manage elections" ON public.elections;

DROP POLICY IF EXISTS "Allow anyone to view election positions" ON public.election_positions;
DROP POLICY IF EXISTS "Public read election positions" ON public.election_positions;
DROP POLICY IF EXISTS "Allow admins to manage election positions" ON public.election_positions;
DROP POLICY IF EXISTS "Allow authenticated admins to manage election positions" ON public.election_positions;

DROP POLICY IF EXISTS "Allow anyone to view election candidates" ON public.election_candidates;
DROP POLICY IF EXISTS "Public read election candidates" ON public.election_candidates;
DROP POLICY IF EXISTS "Allow admins to manage election candidates" ON public.election_candidates;
DROP POLICY IF EXISTS "Allow authenticated admins to manage election candidates" ON public.election_candidates;

DROP POLICY IF EXISTS "Allow students to view own eligibility" ON public.election_eligible_students;
DROP POLICY IF EXISTS "Allow admins to manage election eligibility" ON public.election_eligible_students;
DROP POLICY IF EXISTS "Allow authenticated admins to manage election eligibility" ON public.election_eligible_students;
DROP POLICY IF EXISTS "Allow authenticated admins to delete eligibility" ON public.election_eligible_students;

-- Admins table policies (least privilege)
CREATE POLICY "Admins self lookup" ON public.admins
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "No anon admin rows" ON public.admins
FOR SELECT
TO anon
USING (false);

-- Students policies
CREATE POLICY "Students can read own profile by email" ON public.students
FOR SELECT
TO authenticated
USING (lower(email) = lower(auth.jwt()->>'email'));

CREATE POLICY "Students can update own voted flag" ON public.students
FOR UPDATE
TO authenticated
USING (lower(email) = lower(auth.jwt()->>'email'))
WITH CHECK (lower(email) = lower(auth.jwt()->>'email'));

CREATE POLICY "Allow authenticated admins to manage students" ON public.students
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

-- Public read metadata policies
CREATE POLICY "Public read positions" ON public.positions
FOR SELECT TO public
USING (true);

CREATE POLICY "Public read candidates" ON public.candidates
FOR SELECT TO public
USING (true);

CREATE POLICY "Public read elections" ON public.elections
FOR SELECT TO public
USING (true);

CREATE POLICY "Public read election positions" ON public.election_positions
FOR SELECT TO public
USING (true);

CREATE POLICY "Public read election candidates" ON public.election_candidates
FOR SELECT TO public
USING (true);

-- Admin management policies
CREATE POLICY "Allow admins to manage positions" ON public.positions
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

CREATE POLICY "Allow admins to manage candidates" ON public.candidates
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

CREATE POLICY "Allow admins to manage elections" ON public.elections
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

CREATE POLICY "Allow admins to manage election positions" ON public.election_positions
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

CREATE POLICY "Allow admins to manage election candidates" ON public.election_candidates
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

CREATE POLICY "Allow admins to manage election eligibility" ON public.election_eligible_students
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

CREATE POLICY "Allow students to view own eligibility" ON public.election_eligible_students
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.id = election_eligible_students.student_id
      AND lower(s.email) = lower(auth.jwt()->>'email')
  )
  OR EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid())
);

-- Votes policies (student write + own read, admin read)
CREATE POLICY "Students can insert own votes by profile link" ON public.votes
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.id = votes.student_id
      AND lower(s.email) = lower(auth.jwt()->>'email')
  )
  AND EXISTS (
    SELECT 1
    FROM public.elections e
    WHERE e.id = votes.election_id
      AND e.status = 'active'
  )
  AND (
    NOT EXISTS (
      SELECT 1 FROM public.election_eligible_students es
      WHERE es.election_id = votes.election_id
    )
    OR EXISTS (
      SELECT 1 FROM public.election_eligible_students es
      WHERE es.election_id = votes.election_id
        AND es.student_id = votes.student_id
    )
  )
  AND (
    NOT EXISTS (
      SELECT 1 FROM public.election_candidates ec
      WHERE ec.election_id = votes.election_id
    )
    OR EXISTS (
      SELECT 1 FROM public.election_candidates ec
      WHERE ec.election_id = votes.election_id
        AND ec.candidate_id = votes.candidate_id
    )
  )
);

CREATE POLICY "Students can read own votes by profile link" ON public.votes
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.id = votes.student_id
      AND lower(s.email) = lower(auth.jwt()->>'email')
  )
);

CREATE POLICY "Allow admins to see all votes" ON public.votes
FOR SELECT
TO authenticated
USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

-- Legacy election_settings only for admin fallback pages
CREATE POLICY "Allow admins to manage election settings" ON public.election_settings
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

-- Audit table + policies
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id bigserial PRIMARY KEY,
  admin_user_id uuid NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.admin_audit_logs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.admin_audit_logs_id_seq TO authenticated;

DROP POLICY IF EXISTS "Allow admins to read audit logs" ON public.admin_audit_logs;
CREATE POLICY "Allow admins to read audit logs" ON public.admin_audit_logs
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

DROP POLICY IF EXISTS "Allow admins to insert audit logs" ON public.admin_audit_logs;
CREATE POLICY "Allow admins to insert audit logs" ON public.admin_audit_logs
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid())
  AND admin_user_id = auth.uid()
);

-- Optional bootstrap from legacy election_settings
INSERT INTO public.elections (name, start_time, end_time, status)
SELECT
  es.election_name,
  es.start_time,
  es.end_time,
  CASE es.status WHEN 1 THEN 'active' WHEN 2 THEN 'ended' ELSE 'draft' END
FROM public.election_settings es
WHERE NOT EXISTS (SELECT 1 FROM public.elections)
LIMIT 1;

INSERT INTO public.election_positions (election_id, position_id)
SELECT e.id, p.id
FROM public.elections e
CROSS JOIN public.positions p
WHERE NOT EXISTS (SELECT 1 FROM public.election_positions)
ON CONFLICT DO NOTHING;

INSERT INTO public.election_candidates (election_id, candidate_id)
SELECT e.id, c.id
FROM public.elections e
CROSS JOIN public.candidates c
WHERE NOT EXISTS (SELECT 1 FROM public.election_candidates)
ON CONFLICT DO NOTHING;

INSERT INTO public.election_eligible_students (election_id, student_id)
SELECT e.id, s.id
FROM public.elections e
CROSS JOIN public.students s
WHERE NOT EXISTS (SELECT 1 FROM public.election_eligible_students)
ON CONFLICT DO NOTHING;
