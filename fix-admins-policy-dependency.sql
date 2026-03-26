-- Fix: "permission denied for table admins" during student flows.
-- Cause: Some table policies reference public.admins in EXISTS clauses,
-- but anon/authenticated roles may lack table SELECT privilege, causing hard errors.

-- 1) Allow roles to reference admins table in policy evaluation.
GRANT SELECT ON TABLE public.admins TO anon;
GRANT SELECT ON TABLE public.admins TO authenticated;

-- 2) Keep rows protected with strict RLS policies.
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- Replace with explicit least-privilege policies.
DROP POLICY IF EXISTS "Allow authenticated users to check if they are admin" ON public.admins;
DROP POLICY IF EXISTS "Deny all other access to admins table" ON public.admins;
DROP POLICY IF EXISTS "Admins self lookup" ON public.admins;
DROP POLICY IF EXISTS "No anon admin rows" ON public.admins;

CREATE POLICY "Admins self lookup" ON public.admins
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "No anon admin rows" ON public.admins
  FOR SELECT
  TO anon
  USING (false);

-- Keep write operations blocked from client roles.
-- (Service role bypasses RLS and remains able to manage this table server-side.)
