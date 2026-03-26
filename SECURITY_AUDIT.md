# Security & Code Quality Audit Report
*Generated: March 26, 2026*

## 🔴 CRITICAL ISSUES

### 1. **EXPOSED API CREDENTIALS** (CRITICAL)
**Location**: `supabase-config.js`
- Your Supabase API keys are hardcoded and visible in the repository
- Even though it's an anon key, it exposes your project URL and can be used to enumerate data
- The repo is public on GitHub, making this a security vulnerability

**Fix**:
```javascript
// supabase-config.js
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'YOUR_URL_HERE'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_KEY_HERE'
```
Use environment variables or GitHub Secrets for deployment.

---

### 2. **RLS POLICY LOGIC ERROR** (CRITICAL)
**Location**: `schema.sql`, lines 95-100, `security-hardening.sql`
- Policies use `auth.role() = 'service_role'` for admin operations on positions and candidates
- This will **never match** for authenticated users (only service role = backend admin in Supabase)
- Admin positions/candidates management will silently fail

**Fix**: Use the admin table lookup pattern like votes policies do:
```sql
-- WRONG (current):
CREATE POLICY "Allow admins to manage positions" ON positions
  FOR ALL USING (auth.role() = 'service_role');

-- CORRECT:
CREATE POLICY "Allow admins to manage positions" ON positions
  FOR ALL USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));
```

---

### 3. **DOUBLE VOTE RACE CONDITION** (HIGH)
**Location**: `js/student.js`, lines 340-400
- No client-side check for duplicate votes before submission
- Two rapid clicks on submit could create race condition
- Database constraint prevents it, but user sees confusing errors

**Fix**: Disable submit button after first click:
```javascript
if (votes.length === 0) {
    throw new Error('Please select candidates before submitting.');
}

updateSubmitAvailability(false); // Add this BEFORE API call
setVoteMessage('Submitting your vote...', 'default');
```

---

## 🟠 HIGH PRIORITY ISSUES

### 4. **NO INPUT VALIDATION ON FORMS**
**Affected areas**:
- Admin: Student add/edit, candidate management, position management
- Student: Vote form relies only on HTML5 validation
- Admin Excel import (if present)

**Risks**:
- XSS via unescaped HTML in names, emails, etc.
- Data type mismatches cause silent failures
- Empty strings bypass visual validation

**Quick fixes**:
```javascript
// Add validation function
function validateStudentInput(name, email, studentId, department) {
    if (!name?.trim()) throw new Error('Name is required');
    if (!email?.trim() || !email.includes('@')) throw new Error('Valid email required');
    if (!studentId?.trim()) throw new Error('Student ID is required');
    if (name.length > 255) throw new Error('Name too long');
    if (email.length > 255) throw new Error('Email too long');
    return true;
}
```

---

### 5. **STALE SESSION IN MULTI-TAB SCENARIOS** (MEDIUM)
**Location**: `js/student.js`, `js/admin.js`
- Students' sessions stored in localStorage with timestamps
- Browser tabs don't sync session state
- If student votes in one tab, another tab won't know

**Scenario**: Student opens vote page in Tab 1, votes successfully. Tab 2 still thinks `has_voted = false`, lets them vote again.

**Fix**: Use sessionStorage for tab-specific state, localStorage for persistent data only.

---

### 6. **ADMIN AUTHENTICATION RELIES ON localStorage FLAG** (MEDIUM)
**Location**: `js/admin.js`, lines 50-85
- Uses `localStorage.getItem('admin-authenticated')` as first check
- Flag could be set by user manually in DevTools
- Then validates against auth session (good), but first flag is weak

**Better approach**:
```javascript
// Skip the flag check if not in production, or only check auth session
const isAdmin = await checkIfUserIsAdmin(); // Direct DB check only
```

---

### 7. **NO RATE LIMITING ON SENSITIVE OPERATIONS** (MEDIUM)
- Admin can create unlimited students from Excel import
- No limit on login attempts
- Vote submission not throttled (though unique constraint helps)

**Recommendation**: Implement client-side throttling:
```javascript
const createStudentThrottle = (function() {
    let lastCall = 0;
    return async (student) => {
        const now = Date.now();
        if (now - lastCall < 1000) throw new Error('Please wait before next action');
        lastCall = now;
        return createStudent(student);
    };
})();
```

---

### 8. **ELECTION_SETTINGS POLICIES ALLOW PUBLIC READ** (MEDIUM)
**Location**: `schema.sql`, lines 113-114
```sql
CREATE POLICY "Allow anyone to view election settings" ON election_settings
  FOR SELECT USING (true);
```
- Election status (`active`/`closed`) is public viewable
- Students could check election status without authentication
- Less of an issue but could allow info leakage

---

## 🟡 MEDIUM PRIORITY ISSUES

### 9. **ERROR MESSAGES CAN LEAK INFORMATION** (LOW-MEDIUM)
**Location**: Various JS files
- Errors like "You have already voted for this position" confirm participation
- Errors like "You are not eligible" leak eligibility info

**Consider**: Generic error messages, log details server-side only.

---

### 10. **NO CSRF PROTECTION** (LOW-MEDIUM)
- Supabase uses JWT tokens (which have CORS protection)
- But if someone embeds your voting page in an iframe on another site, could cause issues
- Add `X-Frame-Options: DENY` header in Supabase settings

---

### 11. **SESSION TIMEOUT NOT ENFORCED** (LOW-MEDIUM)
- No session expiration logic
- Students' sessions persist until cleared manually
- After 1 week, `sessionIssuedAt` timestamp could allow old sessions

**Fix**: Check timestamp in `validateStudentSession()`:
```javascript
const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
if (Date.now() - Number(student.sessionIssuedAt) > MAX_SESSION_AGE_MS) {
    clearStudentSession();
    return null;
}
```

---

### 12. **UNIQUE CONSTRAINT ON VOTES TABLE** (LOW)
- Uses unique key `(student_id, position_id)`
- Good for preventing double votes
- But error message to user isn't friendly if constraint violated

**Verify**: Check actual schema for this constraint:
```sql
SELECT constraint_name FROM information_schema.table_constraints 
WHERE table_name = 'votes' AND constraint_type = 'UNIQUE';
```

---

## 🟢 MINOR ISSUES / BEST PRACTICES

### 13. **Excel Import Validation**
- No file size limit
- No format validation (just checks column names)
- Could cause memory issues with huge files

---

### 14. **Realtime Subscriptions**
- Using smart batching (good)
- But no subscription cleanup on page unload
- Could leak memory if users navigate frequently

---

### 15. **Error Logging**
- Errors logged to console but no backend logging
- Can't track issues post-deployment
- Add error reporting service (Sentry, LogRocket, etc.)

---

## ✅ RECOMMENDATIONS (Priority Order)

| Priority | Action | Effort |
|----------|--------|--------|
| 🔴 CRITICAL | Fix RLS policies for admin tables (positions, candidates) | 15 min |
| 🔴 CRITICAL | Move API keys to environment variables | 10 min |
| 🟠 HIGH | Add input validation to all forms | 30 min |
| 🟠 HIGH | Disable submit button during vote submission | 5 min |
| 🟠 HIGH | Fix double-vote race condition | 10 min |
| 🟡 MEDIUM | Add session timeout logic | 15 min |
| 🟡 MEDIUM | Implement rate limiting | 20 min |
| 🟢 LOW | Add error reporting service | 20 min |

---

## Quick Implementation Steps

### Step 1: Fix RLS Policies (15 min)
The positions, candidates, and election_settings tables need corrected policies.

### Step 2: Secure API Keys (10 min)
Remove hardcoded keys from repo, use environment variables.

### Step 3: Form Validation (30 min)
Add validation functions to student/admin forms before submission.

Would you like me to implement these fixes? I'd recommend starting with **Steps 1-3** (the critical issues).
