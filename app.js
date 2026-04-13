// Supabase Configuration
import { supabase } from "./supabase-config.js";
import { initThemeToggle } from "./js/theme.js";

document.addEventListener('DOMContentLoaded', () => {
    initThemeToggle();

    const loginForm = document.getElementById('login-form');
    const errorMessage = document.getElementById('error-message');
    const STUDENT_SESSION_KEY = 'student-authenticated';

    function isPermissionDeniedError(error) {
        const message = (error?.message || '').toLowerCase();
        return error?.status === 401 || error?.status === 403 || error?.code === '42501' || message.includes('permission denied') || message.includes('forbidden');
    }

    function saveStudentSnapshot(student) {
        const payload = JSON.stringify(student);
        try {
            sessionStorage.setItem(STUDENT_SESSION_KEY, payload);
        } catch {
            // Ignore session storage failures on restrictive browsers.
        }
        try {
            localStorage.setItem(STUDENT_SESSION_KEY, payload);
        } catch {
            // Ignore local storage failures and proceed.
        }
    }

    function readStudentSnapshot() {
        try {
            const sessionValue = sessionStorage.getItem(STUDENT_SESSION_KEY);
            if (sessionValue) {
                return JSON.parse(sessionValue);
            }
        } catch {
            // Ignore parse/storage errors.
        }

        try {
            const localValue = localStorage.getItem(STUDENT_SESSION_KEY);
            if (localValue) {
                const parsed = JSON.parse(localValue);
                try {
                    sessionStorage.setItem(STUDENT_SESSION_KEY, localValue);
                } catch {
                    // Ignore cache sync failures.
                }
                return parsed;
            }
        } catch {
            // Ignore parse/storage errors.
        }

        return null;
    }

    function clearStudentSnapshot() {
        try {
            sessionStorage.removeItem(STUDENT_SESSION_KEY);
        } catch {
            // Ignore storage cleanup failures.
        }
        try {
            localStorage.removeItem(STUDENT_SESSION_KEY);
        } catch {
            // Ignore storage cleanup failures.
        }
    }

    async function resolvePostLoginRoute(studentId) {
        try {
            const { data: activeElection, error: electionError } = await supabase
                .from('elections')
                .select('id')
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (electionError || !activeElection) {
                return 'student/dashboard.html';
            }

            const { data: eligibility, error: eligibilityError } = await supabase
                .from('election_eligible_students')
                .select('student_id')
                .eq('election_id', activeElection.id)
                .eq('student_id', studentId)
                .maybeSingle();

            if (eligibilityError && isPermissionDeniedError(eligibilityError)) {
                return 'student/dashboard.html';
            }

            if (!eligibility) {
                const { count, error: eligibilityCountError } = await supabase
                    .from('election_eligible_students')
                    .select('student_id', { count: 'exact', head: true })
                    .eq('election_id', activeElection.id);

                if (!eligibilityCountError && Number(count || 0) === 0) {
                    return 'student/vote.html';
                }

                return 'student/dashboard.html';
            }

            const { data: priorVotes } = await supabase
                .from('votes')
                .select('id')
                .eq('election_id', activeElection.id)
                .eq('student_id', studentId)
                .limit(1);

            if ((priorVotes || []).length > 0) {
                return 'student/dashboard.html';
            }

            return 'student/vote.html';
        } catch (err) {
            console.error('Unable to resolve post-login route:', err);
            return 'student/dashboard.html';
        }
    }

    async function validateSnapshot(snapshot) {
        if (!snapshot?.email || !snapshot?.student_id) {
            return null;
        }

        const { data, error } = await supabase
            .from('students')
            .select('id,name,email,student_id,has_voted')
            .eq('email', String(snapshot.email).toLowerCase())
            .eq('student_id', snapshot.student_id)
            .maybeSingle();

        if (error || !data) {
            return null;
        }

        return {
            id: data.id,
            name: data.name,
            email: data.email,
            student_id: data.student_id,
            has_voted: !!data.has_voted,
            sessionIssuedAt: Date.now()
        };
    }

    (async () => {
        const existingSnapshot = readStudentSnapshot();
        if (!existingSnapshot) return;

        const refreshedSnapshot = await validateSnapshot(existingSnapshot);
        if (!refreshedSnapshot) {
            clearStudentSnapshot();
            return;
        }

        saveStudentSnapshot(refreshedSnapshot);
        const destination = await resolvePostLoginRoute(refreshedSnapshot.id);
        window.location.href = destination;
    })();

    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            errorMessage.textContent = '';
            errorMessage.style.color = '';

            const email = document.getElementById('email').value.trim().toLowerCase();
            const studentId = document.getElementById('student-id').value.trim();

            try {
                console.log('Attempting student login with email and student ID:', email, studentId);

                const { data, error } = await supabase
                    .from('students')
                    .select('id,name,email,student_id,has_voted')
                    .eq('email', email)
                    .eq('student_id', studentId)
                    .maybeSingle();

                if (error || !data) {
                    if (error && isPermissionDeniedError(error)) {
                        errorMessage.textContent = 'Login is blocked by database permissions. Please contact admin to run student-id-login-compat.sql.';
                        return;
                    }
                    errorMessage.textContent = 'Login failed. Check your email/student ID and try again.';
                    return;
                }

                const sessionStudent = {
                    id: data.id,
                    name: data.name,
                    email: data.email,
                    student_id: data.student_id,
                    has_voted: !!data.has_voted,
                    sessionIssuedAt: Date.now()
                };

                saveStudentSnapshot(sessionStudent);
                const destination = await resolvePostLoginRoute(data.id);
                window.location.href = destination;
            } catch (err) {
                console.error('An unexpected error occurred:', err);
                errorMessage.textContent = 'An unexpected error occurred. Please try again.';
            }
        });
    }
});
