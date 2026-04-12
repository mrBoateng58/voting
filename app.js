// Supabase Configuration
import { supabase } from "./supabase-config.js";
import { initThemeToggle } from "./js/theme.js";

document.addEventListener('DOMContentLoaded', () => {
    initThemeToggle();
    const loginForm = document.getElementById('login-form');
    const errorMessage = document.getElementById('error-message');
    const PENDING_STUDENT_LOGIN_KEY = 'pending-student-login';

    function isPermissionDeniedError(error) {
        const message = (error?.message || '').toLowerCase();
        return error?.status === 401 || error?.status === 403 || error?.code === '42501' || message.includes('permission denied') || message.includes('forbidden');
    }

    function saveStudentSnapshot(student) {
        const payload = JSON.stringify(student);
        try {
            sessionStorage.setItem('student-authenticated', payload);
        } catch {
            // Ignore session storage failures on restrictive mobile browsers.
        }
        try {
            localStorage.setItem('student-authenticated', payload);
        } catch {
            // Ignore local storage failures and proceed with in-memory navigation.
        }
    }

    function savePendingStudentLogin(email, studentId) {
        try {
            sessionStorage.setItem(PENDING_STUDENT_LOGIN_KEY, JSON.stringify({
                email: String(email || '').toLowerCase(),
                studentId: String(studentId || ''),
                createdAt: Date.now()
            }));
        } catch {
            // Ignore storage failures and continue OTP flow.
        }
    }

    function readPendingStudentLogin() {
        try {
            const raw = sessionStorage.getItem(PENDING_STUDENT_LOGIN_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function clearPendingStudentLogin() {
        try {
            sessionStorage.removeItem(PENDING_STUDENT_LOGIN_KEY);
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

            // If eligibility cannot be verified, fail closed to dashboard.
            if (eligibilityError && isPermissionDeniedError(eligibilityError)) {
                return 'student/dashboard.html';
            }

            if (!eligibility) {
                // If no eligibility rows exist for this election, treat election as open-to-all.
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

    async function hydrateStudentFromAuth() {
        try {
            const { data: userData, error: userError } = await supabase.auth.getUser();
            if (userError || !userData?.user?.email) {
                return null;
            }

            const { data: student, error: studentError } = await supabase
                .from('students')
                .select('id,name,email,student_id,has_voted')
                .eq('email', userData.user.email)
                .maybeSingle();

            if (studentError || !student) {
                return null;
            }

            return {
                id: student.id,
                name: student.name,
                email: student.email,
                student_id: student.student_id,
                has_voted: !!student.has_voted,
                sessionIssuedAt: Date.now()
            };
        } catch (err) {
            console.error('Failed to hydrate student session:', err);
            return null;
        }
    }

    // If a student is already authenticated, skip showing the login form again.
    hydrateStudentFromAuth().then(async (student) => {
        if (!student) return;

        const pendingLogin = readPendingStudentLogin();
        if (pendingLogin) {
            const pendingEmail = String(pendingLogin.email || '').toLowerCase();
            const pendingStudentId = String(pendingLogin.studentId || '');
            const studentEmail = String(student.email || '').toLowerCase();
            const studentStudentId = String(student.student_id || '');

            if (pendingEmail !== studentEmail || pendingStudentId !== studentStudentId) {
                clearPendingStudentLogin();
                await supabase.auth.signOut();
                errorMessage.textContent = 'Student ID verification failed for this email. Please try again.';
                return;
            }

            clearPendingStudentLogin();
        }

        saveStudentSnapshot(student);
        const destination = await resolvePostLoginRoute(student.id);
        window.location.href = destination;
    });

    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            errorMessage.textContent = '';

            const email = document.getElementById('email').value.trim().toLowerCase();
            const studentId = document.getElementById('student-id').value.trim();

            try {
                console.log('Attempting OTP login with email and student ID:', email, studentId);

                // Clear stale session first to avoid identity confusion with previous logins.
                try {
                    await supabase.auth.signOut();
                } catch (signOutError) {
                    console.warn('Continuing login despite sign-out issue:', signOutError);
                }

                const { data: identityOk, error: identityError } = await supabase.rpc('verify_student_login_identity', {
                    p_email: email,
                    p_student_id: studentId
                });

                if (identityError) {
                    if (isPermissionDeniedError(identityError)) {
                        errorMessage.textContent = 'Login is blocked by database permissions. Please contact admin to run secure-auth-schema.sql.';
                        return;
                    }
                    throw identityError;
                }

                if (!identityOk) {
                    errorMessage.textContent = 'Login failed. Check your email/student ID and try again.';
                    return;
                }

                savePendingStudentLogin(email, studentId);

                const { error: otpError } = await supabase.auth.signInWithOtp({
                    email,
                    options: {
                        shouldCreateUser: true,
                        emailRedirectTo: `${window.location.origin}/index.html`
                    }
                });

                if (otpError) {
                    clearPendingStudentLogin();
                    errorMessage.textContent = 'Could not send OTP email. Please try again.';
                    return;
                }

                errorMessage.textContent = 'OTP login link sent. Check your email, open the link, and you will be signed in automatically.';
                errorMessage.style.color = '#166534';
                loginForm.reset();
            } catch (err) {
                console.error('An unexpected error occurred:', err);
                errorMessage.textContent = 'An unexpected error occurred. Please try again.';
            }
        });
    }
});