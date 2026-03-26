// Supabase Configuration
// TODO: Replace these with your actual Supabase project credentials
// Get these from: https://app.supabase.com/project/_/settings/api

const SUPABASE_URL = 'https://pkfgqrsfknxlqhlqhjwz.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrZmdxcnNma254bHFobHFoand6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MjMzNTMsImV4cCI6MjA4OTQ5OTM1M30.TeNi5bBUF1Oeh2jiyPwPVAQ-SkYmc9lZAugYCqzNFTY'

// Initialize Supabase client (for students and public operations)
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Admin operations now use the authenticated anon client under RLS policies.
const supabaseAdmin = supabase

export { SUPABASE_URL, SUPABASE_ANON_KEY, supabase, supabaseAdmin }
