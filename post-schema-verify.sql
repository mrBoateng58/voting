-- Post-setup verification checks for secure-auth-schema.sql

-- 1) Table existence
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'students','admins','positions','candidates','votes',
    'elections','election_positions','election_candidates','election_eligible_students',
    'admin_audit_logs'
  )
ORDER BY table_name;

-- 2) RLS enabled flags
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'students','admins','positions','candidates','votes',
    'elections','election_positions','election_candidates','election_eligible_students',
    'admin_audit_logs'
  )
ORDER BY tablename;

-- 3) Votes unique constraint check
SELECT conname, pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = 'votes'
  AND c.conname = 'votes_student_election_position_unique';

-- 4) Student/auth mapping quality checks
SELECT s.id, s.name, s.email
FROM public.students s
LEFT JOIN auth.users u
  ON lower(u.email) = lower(s.email)
WHERE u.id IS NULL
ORDER BY s.email;

SELECT u.id, u.email
FROM auth.users u
LEFT JOIN public.students s
  ON lower(s.email) = lower(u.email)
WHERE s.id IS NULL
ORDER BY u.email;

-- 5) Policy list snapshot
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'students','admins','positions','candidates','votes',
    'elections','election_positions','election_candidates','election_eligible_students',
    'admin_audit_logs'
  )
ORDER BY tablename, policyname;
