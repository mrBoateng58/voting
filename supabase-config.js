// Supabase Configuration
// Security: API keys should be set via environment variables, not hardcoded
// For development/testing: use environment variables or set in your deployment platform
// Get these from: https://app.supabase.com/project/_/settings/api

// Load from environment (supports: process.env, import.meta.env, window.__ENV__)
const getEnvVar = (key, fallback = '') => {
  // Try process.env (for Node-based builds)
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  // Try import.meta.env (for Vite builds)
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  // Try window.__ENV__ (for manual deployment)
  if (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__[key]) {
    return window.__ENV__[key];
  }
  return fallback;
};

const SUPABASE_URL = getEnvVar('VITE_SUPABASE_URL', 'https://pkfgqrsfknxlqhlqhjwz.supabase.co')
const SUPABASE_ANON_KEY = getEnvVar('VITE_SUPABASE_ANON_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrZmdxcnNma254bHFobHFoand6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MjMzNTMsImV4cCI6MjA4OTQ5OTM1M30.TeNi5bBUF1Oeh2jiyPwPVAQ-SkYmc9lZAugYCqzNFTY')

// Initialize Supabase client (for students and public operations)
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Admin operations now use the authenticated anon client under RLS policies.
const supabaseAdmin = supabase

export { SUPABASE_URL, SUPABASE_ANON_KEY, supabase, supabaseAdmin }
