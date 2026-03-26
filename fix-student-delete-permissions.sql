-- Fix student deletion permissions for authenticated admins
-- Run in Supabase SQL Editor if student delete is still blocked.

-- Ensure students table has a policy allowing authenticated admins to DELETE
DROP POLICY IF EXISTS "Allow authenticated admins to manage students" ON students;
CREATE POLICY "Allow authenticated admins to manage students" ON students
FOR ALL
USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- Ensure election_eligible_students allows admin deletion
DROP POLICY IF EXISTS "Allow authenticated admins to delete eligibility" ON election_eligible_students;
CREATE POLICY "Allow authenticated admins to delete eligibility" ON election_eligible_students
FOR DELETE
USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- Ensure votes allows admin deletion
DROP POLICY IF EXISTS "Allow authenticated admins to delete votes" ON votes;
CREATE POLICY "Allow authenticated admins to delete votes" ON votes
FOR DELETE
USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- Verify your current admin is in the admins table (run to check):
-- SELECT id, user_id FROM admins WHERE user_id = auth.uid();
-- If no row is returned, your admin account needs to be added to the admins table.
