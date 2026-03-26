-- Fix RLS policy to allow student login validation
-- This allows anonymous users to query the students table for login
CREATE POLICY "Allow anonymous to view students for login" ON "students"
  FOR SELECT USING (true);
