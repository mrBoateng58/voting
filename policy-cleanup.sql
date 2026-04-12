-- Run this after secure-auth-schema.sql if old permissive policies still exist.

BEGIN;

-- Remove broad student read/write compatibility leftovers.
DROP POLICY IF EXISTS students_anon_select ON public.students;
DROP POLICY IF EXISTS students_service_all ON public.students;
DROP POLICY IF EXISTS "Allow anonymous to view students for login" ON public.students;

-- Ensure anon cannot read student PII directly.
REVOKE ALL ON public.students FROM anon;
GRANT SELECT ON public.students TO authenticated;

COMMIT;

-- Verify
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'students'
ORDER BY policyname;
