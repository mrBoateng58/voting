# Admin Access Control Deployment Guide

This project now supports separating admin access from student access at the proxy layer.

## What is implemented in the app

- Student login page no longer exposes admin navigation.
- Admin login page no longer links back to student login.
- Admin logout returns to admin login page.
- App-level admin guard still verifies user exists in `admins` table.

## Required deployment hardening (recommended)

Use a reverse proxy (Nginx/Apache/Caddy) to place admin under a separate host/path.

### Recommended pattern

1. Public student site: `https://app.example.com/`
2. Admin site: `https://admin.example.com/secure-admin/`
3. At proxy layer, enforce:
- IP allowlist (office/VPN ranges)
- HTTP Basic Auth (first gate)
- Rate limiting on admin requests

A ready Nginx sample is included in:
- `deploy/nginx-admin-gateway.conf`

## Why this helps

- Reduces brute-force exposure before requests reach your app.
- Reduces discoverability of admin endpoints.
- Adds defense in depth on top of Supabase role checks.

## Final checklist

1. Deploy `admin` pages only behind protected host/path.
2. Remove any public links to admin endpoints (done in UI).
3. Keep Supabase `admins` table authorization checks enabled (already in app).
4. Monitor failed auth attempts in proxy logs.
