-- Supabase Auth hardening for student flow
-- Run in Supabase SQL Editor after verifying table names in your project.

-- 1) Remove broad anonymous student read policy if it exists.
DROP POLICY IF EXISTS "Allow anonymous to view students for login" ON students;

-- 2) Allow authenticated students to read only their own profile by email.
DROP POLICY IF EXISTS "Students can read own profile by email" ON students;
CREATE POLICY "Students can read own profile by email" ON students
  FOR SELECT
  TO authenticated
  USING (email = auth.jwt()->>'email');

-- 3) Allow student self-update of has_voted only for own profile.
DROP POLICY IF EXISTS "Students can update own voted flag" ON students;
CREATE POLICY "Students can update own voted flag" ON students
  FOR UPDATE
  TO authenticated
  USING (email = auth.jwt()->>'email')
  WITH CHECK (email = auth.jwt()->>'email');

-- 4) Restrict vote insert/select to records linked to the authenticated user's email.
DROP POLICY IF EXISTS "Students can insert own votes by profile link" ON votes;
CREATE POLICY "Students can insert own votes by profile link" ON votes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM students s
      WHERE s.id = votes.student_id
        AND s.email = auth.jwt()->>'email'
    )
  );

DROP POLICY IF EXISTS "Students can read own votes by profile link" ON votes;
CREATE POLICY "Students can read own votes by profile link" ON votes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM students s
      WHERE s.id = votes.student_id
        AND s.email = auth.jwt()->>'email'
    )
  );

-- 5) Keep election/ballot metadata readable.
-- If these policies already exist in your project, this section can be skipped.
DROP POLICY IF EXISTS "Public read elections" ON elections;
CREATE POLICY "Public read elections" ON elections
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public read election positions" ON election_positions;
CREATE POLICY "Public read election positions" ON election_positions
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public read election candidates" ON election_candidates;
CREATE POLICY "Public read election candidates" ON election_candidates
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public read positions" ON positions;
CREATE POLICY "Public read positions" ON positions
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public read candidates" ON candidates;
CREATE POLICY "Public read candidates" ON candidates
  FOR SELECT
  TO public
  USING (true);
