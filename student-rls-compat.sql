-- Student flow compatibility policies for email + student_id login mode.
-- Run in Supabase SQL editor if students can log in but election status/ballot checks fail.
-- IMPORTANT: Do not create public SELECT policies on votes.

-- 1) Keep student login lookup available for public client (required by email+student_id login flow).
DROP POLICY IF EXISTS "Allow anonymous to view students for login" ON students;
CREATE POLICY "Allow anonymous to view students for login" ON students
  FOR SELECT
  TO public
  USING (true);

-- 2) Ensure election metadata can be read publicly by the student app.
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

-- 3) If you need strict eligibility/vote checks, migrate students fully to Supabase Auth mode
-- and use the auth-bound policies in supabase-auth-hardening.sql.
