-- Security hardening for browser-only admin client (no service role key in frontend)
-- Run in Supabase SQL Editor.

-- 1) Ensure schema usage + table grants for authenticated users
GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT ON admins TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON elections, election_positions, election_candidates, election_eligible_students TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON students, positions, candidates, votes TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- 2) Ensure RLS is enabled
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_eligible_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;

-- 3) Admin helper predicate pattern: user exists in admins table
-- Admins table should be readable only to own record
DROP POLICY IF EXISTS "Allow authenticated users to check if they are admin" ON admins;
CREATE POLICY "Allow authenticated users to check if they are admin" ON admins
FOR SELECT USING (auth.uid() = user_id);

-- 4) Multi-election policies for authenticated admins
DROP POLICY IF EXISTS "Allow authenticated admins to manage elections" ON elections;
CREATE POLICY "Allow authenticated admins to manage elections" ON elections
FOR ALL
USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

DROP POLICY IF EXISTS "Allow authenticated admins to manage election positions" ON election_positions;
CREATE POLICY "Allow authenticated admins to manage election positions" ON election_positions
FOR ALL
USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

DROP POLICY IF EXISTS "Allow authenticated admins to manage election candidates" ON election_candidates;
CREATE POLICY "Allow authenticated admins to manage election candidates" ON election_candidates
FOR ALL
USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

DROP POLICY IF EXISTS "Allow authenticated admins to manage election eligibility" ON election_eligible_students;
CREATE POLICY "Allow authenticated admins to manage election eligibility" ON election_eligible_students
FOR ALL
USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- Read policies for election mapping data
DROP POLICY IF EXISTS "Allow anyone to view elections" ON elections;
CREATE POLICY "Allow anyone to view elections" ON elections FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow anyone to view election positions" ON election_positions;
CREATE POLICY "Allow anyone to view election positions" ON election_positions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow anyone to view election candidates" ON election_candidates;
CREATE POLICY "Allow anyone to view election candidates" ON election_candidates FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow students to view own eligibility" ON election_eligible_students;
CREATE POLICY "Allow students to view own eligibility" ON election_eligible_students
FOR SELECT USING (auth.uid() = student_id OR EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- 5) Votes policies for admins + students
DROP POLICY IF EXISTS "Allow students to insert their own votes" ON votes;
CREATE POLICY "Allow students to insert their own votes" ON votes
FOR INSERT WITH CHECK (auth.uid() = student_id);

DROP POLICY IF EXISTS "Allow students to see their own votes" ON votes;
CREATE POLICY "Allow students to see their own votes" ON votes
FOR SELECT USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Allow admins to see all votes" ON votes;
CREATE POLICY "Allow admins to see all votes" ON votes
FOR SELECT USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

DROP POLICY IF EXISTS "Allow authenticated admins to manage votes" ON votes;
CREATE POLICY "Allow authenticated admins to manage votes" ON votes
FOR ALL
USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- 6) Legacy table management for admins only
ALTER TABLE election_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow admins to manage election settings" ON election_settings;
CREATE POLICY "Allow admins to manage election settings" ON election_settings
FOR ALL
USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- 7) Lightweight audit logging table and policies
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id bigserial PRIMARY KEY,
  admin_user_id uuid NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON admin_audit_logs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE admin_audit_logs_id_seq TO authenticated;

DROP POLICY IF EXISTS "Allow admins to read audit logs" ON admin_audit_logs;
CREATE POLICY "Allow admins to read audit logs" ON admin_audit_logs
FOR SELECT USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

DROP POLICY IF EXISTS "Allow admins to insert audit logs" ON admin_audit_logs;
CREATE POLICY "Allow admins to insert audit logs" ON admin_audit_logs
FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid())
  AND admin_user_id = auth.uid()
);
