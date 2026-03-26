-- Fix permissions and RLS policies for multi-election tables
-- Run this in Supabase SQL Editor.

-- Ensure tables exist (safe if already present)
CREATE TABLE IF NOT EXISTS elections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_time timestamptz,
  end_time timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS election_positions (
  id bigserial PRIMARY KEY,
  election_id uuid NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  position_id bigint NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  UNIQUE (election_id, position_id)
);

CREATE TABLE IF NOT EXISTS election_eligible_students (
  id bigserial PRIMARY KEY,
  election_id uuid NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (election_id, student_id)
);

CREATE TABLE IF NOT EXISTS election_candidates (
  id bigserial PRIMARY KEY,
  election_id uuid NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  candidate_id bigint NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (election_id, candidate_id)
);

ALTER TABLE votes
  ADD COLUMN IF NOT EXISTS election_id uuid REFERENCES elections(id) ON DELETE CASCADE;

-- Ensure privileges are present for API roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON elections, election_positions, election_eligible_students, election_candidates TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON elections, election_positions, election_eligible_students, election_candidates TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Enable RLS
ALTER TABLE elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_eligible_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_candidates ENABLE ROW LEVEL SECURITY;

-- Elections policies
DROP POLICY IF EXISTS "Allow anyone to view elections" ON elections;
CREATE POLICY "Allow anyone to view elections" ON elections
FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow service role to manage elections" ON elections;

DROP POLICY IF EXISTS "Allow authenticated admins to manage elections" ON elections;
CREATE POLICY "Allow authenticated admins to manage elections" ON elections
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM admins a
    WHERE a.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM admins a
    WHERE a.user_id = auth.uid()
  )
);

-- Election positions policies
DROP POLICY IF EXISTS "Allow anyone to view election positions" ON election_positions;
CREATE POLICY "Allow anyone to view election positions" ON election_positions
FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow service role to manage election positions" ON election_positions;

DROP POLICY IF EXISTS "Allow authenticated admins to manage election positions" ON election_positions;
CREATE POLICY "Allow authenticated admins to manage election positions" ON election_positions
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM admins a
    WHERE a.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM admins a
    WHERE a.user_id = auth.uid()
  )
);

-- Election eligibility policies
DROP POLICY IF EXISTS "Allow students to view own eligibility" ON election_eligible_students;
CREATE POLICY "Allow students to view own eligibility" ON election_eligible_students
FOR SELECT USING (auth.uid() = student_id OR EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

DROP POLICY IF EXISTS "Allow service role to manage election eligibility" ON election_eligible_students;

DROP POLICY IF EXISTS "Allow authenticated admins to manage election eligibility" ON election_eligible_students;
CREATE POLICY "Allow authenticated admins to manage election eligibility" ON election_eligible_students
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM admins a
    WHERE a.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM admins a
    WHERE a.user_id = auth.uid()
  )
);

-- Election candidates policies
DROP POLICY IF EXISTS "Allow anyone to view election candidates" ON election_candidates;
CREATE POLICY "Allow anyone to view election candidates" ON election_candidates
FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow service role to manage election candidates" ON election_candidates;

DROP POLICY IF EXISTS "Allow authenticated admins to manage election candidates" ON election_candidates;
CREATE POLICY "Allow authenticated admins to manage election candidates" ON election_candidates
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM admins a
    WHERE a.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM admins a
    WHERE a.user_id = auth.uid()
  )
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_votes_election_id ON votes(election_id);
CREATE INDEX IF NOT EXISTS idx_election_positions_election_id ON election_positions(election_id);
CREATE INDEX IF NOT EXISTS idx_election_eligible_students_election_id ON election_eligible_students(election_id);
CREATE INDEX IF NOT EXISTS idx_election_candidates_election_id ON election_candidates(election_id);
