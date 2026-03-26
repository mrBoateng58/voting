-- Multi-election support migration
-- Run this in Supabase SQL editor.

-- 1) Elections table
CREATE TABLE IF NOT EXISTS elections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_time timestamptz,
  end_time timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Election positions mapping
CREATE TABLE IF NOT EXISTS election_positions (
  id bigserial PRIMARY KEY,
  election_id uuid NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  position_id bigint NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  UNIQUE (election_id, position_id)
);

-- 3) Election eligibility mapping
CREATE TABLE IF NOT EXISTS election_eligible_students (
  id bigserial PRIMARY KEY,
  election_id uuid NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (election_id, student_id)
);

-- 3b) Election candidates mapping
CREATE TABLE IF NOT EXISTS election_candidates (
  id bigserial PRIMARY KEY,
  election_id uuid NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  candidate_id bigint NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (election_id, candidate_id)
);

-- 4) Add election_id to votes table if missing
ALTER TABLE votes
  ADD COLUMN IF NOT EXISTS election_id uuid REFERENCES elections(id) ON DELETE CASCADE;

-- 5) Replace old unique key to make voting unique per election + position
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'votes_student_id_position_id_key'
  ) THEN
    ALTER TABLE votes DROP CONSTRAINT votes_student_id_position_id_key;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'votes_student_election_position_unique'
  ) THEN
    ALTER TABLE votes
      ADD CONSTRAINT votes_student_election_position_unique UNIQUE (student_id, election_id, position_id);
  END IF;
END $$;

-- 6) Helpful indexes
CREATE INDEX IF NOT EXISTS idx_votes_election_id ON votes(election_id);
CREATE INDEX IF NOT EXISTS idx_election_eligible_students_election_id ON election_eligible_students(election_id);
CREATE INDEX IF NOT EXISTS idx_election_positions_election_id ON election_positions(election_id);
CREATE INDEX IF NOT EXISTS idx_election_candidates_election_id ON election_candidates(election_id);

-- 7) Enable RLS on new tables
ALTER TABLE elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_eligible_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_candidates ENABLE ROW LEVEL SECURITY;

-- 7b) Explicit grants (prevents "permission denied for table ..." errors)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT ON elections, election_positions, election_eligible_students, election_candidates TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON elections, election_positions, election_eligible_students, election_candidates TO authenticated, service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- 8) Policies (read for all, admin/service-role full access)
DROP POLICY IF EXISTS "Allow anyone to view elections" ON elections;
CREATE POLICY "Allow anyone to view elections" ON elections FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow admins to manage elections" ON elections;
CREATE POLICY "Allow admins to manage elections" ON elections FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Allow authenticated admins to manage elections" ON elections;
CREATE POLICY "Allow authenticated admins to manage elections" ON elections
FOR ALL USING (
  EXISTS (
    SELECT 1
    FROM admins a
    WHERE a.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Allow anyone to view election positions" ON election_positions;
CREATE POLICY "Allow anyone to view election positions" ON election_positions FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow admins to manage election positions" ON election_positions;
CREATE POLICY "Allow admins to manage election positions" ON election_positions FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Allow authenticated admins to manage election positions" ON election_positions;
CREATE POLICY "Allow authenticated admins to manage election positions" ON election_positions
FOR ALL USING (
  EXISTS (
    SELECT 1
    FROM admins a
    WHERE a.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Allow students to view own eligibility" ON election_eligible_students;
CREATE POLICY "Allow students to view own eligibility" ON election_eligible_students
FOR SELECT USING (auth.uid() = student_id OR auth.role() = 'service_role');
DROP POLICY IF EXISTS "Allow admins to manage election eligibility" ON election_eligible_students;
CREATE POLICY "Allow admins to manage election eligibility" ON election_eligible_students
FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Allow authenticated admins to manage election eligibility" ON election_eligible_students;
CREATE POLICY "Allow authenticated admins to manage election eligibility" ON election_eligible_students
FOR ALL USING (
  EXISTS (
    SELECT 1
    FROM admins a
    WHERE a.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Allow anyone to view election candidates" ON election_candidates;
CREATE POLICY "Allow anyone to view election candidates" ON election_candidates FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow admins to manage election candidates" ON election_candidates;
CREATE POLICY "Allow admins to manage election candidates" ON election_candidates
FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Allow authenticated admins to manage election candidates" ON election_candidates;
CREATE POLICY "Allow authenticated admins to manage election candidates" ON election_candidates
FOR ALL USING (
  EXISTS (
    SELECT 1
    FROM admins a
    WHERE a.user_id = auth.uid()
  )
);

-- 9) Optional bootstrap: migrate existing election_settings row into elections
INSERT INTO elections (name, start_time, end_time, status)
SELECT election_name,
       start_time,
       end_time,
       CASE status WHEN 1 THEN 'active' WHEN 2 THEN 'ended' ELSE 'draft' END
FROM election_settings
WHERE NOT EXISTS (SELECT 1 FROM elections)
LIMIT 1;

-- 10) Optional bootstrap: attach all positions and students to first election
INSERT INTO election_positions (election_id, position_id)
SELECT e.id, p.id
FROM elections e
CROSS JOIN positions p
WHERE NOT EXISTS (SELECT 1 FROM election_positions)
ON CONFLICT DO NOTHING;

INSERT INTO election_eligible_students (election_id, student_id)
SELECT e.id, s.id
FROM elections e
CROSS JOIN students s
WHERE NOT EXISTS (SELECT 1 FROM election_eligible_students)
ON CONFLICT DO NOTHING;

INSERT INTO election_candidates (election_id, candidate_id)
SELECT e.id, c.id
FROM elections e
CROSS JOIN candidates c
WHERE NOT EXISTS (SELECT 1 FROM election_candidates)
ON CONFLICT DO NOTHING;
