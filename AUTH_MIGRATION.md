# Student Auth Migration (Supabase)

The student login flow now uses Supabase Auth sessions instead of trusting browser storage alone.

## What changed in app behavior

- Students sign in with email + password via Supabase Auth.
- The app then loads the matching student profile from `students` by email.
- Voting pages require an active authenticated user session.
- Logout now signs out from Supabase Auth and clears local/session cache.

## Required setup steps

1. Ensure each student has a Supabase Auth account in Authentication -> Users.
2. Ensure the account email matches `students.email` exactly.
3. Set an initial password for each student account.
4. Run `supabase-auth-hardening.sql` in SQL Editor.

## Notes

- The login form now labels the second field as Password.
- Existing rows in `students` do not need schema changes for this migration.
- If a user authenticates but has no matching row in `students`, login is rejected.

## Rollout tip

Use a staged rollout:

1. Provision test student auth accounts first.
2. Validate login, dashboard status, vote submit, and logout.
3. Provision the rest of student users.
