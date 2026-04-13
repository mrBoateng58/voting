// Supabase Configuration
import { supabase } from "./supabase-config.js";
import { initThemeToggle } from "./js/theme.js";

document.addEventListener('DOMContentLoaded', () => {
    initThemeToggle();
    const loginForm = document.getElementById('login-form');
    const errorMessage = document.getElementById('error-message');

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
        saveStudentSnapshot(student);
        const destination = await resolvePostLoginRoute(student.id);
        window.location.href = destination;
    });

    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            errorMessage.textContent = '';
            errorMessage.style.color = '';

            const email = document.getElementById('email').value.trim().toLowerCase();
            const studentId = document.getElementById('student-id').value.trim();
            const accessCode = document.getElementById('access-code').value;

            try {
                console.log('Attempting student access-code login with email and student ID:', email, studentId);

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

                const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                    email,
                    password: accessCode
                });

                if (authError || !authData?.user?.email) {
                    errorMessage.textContent = 'Login failed. Check your access code and try again.';
                    return;
                }

                const { data, error } = await supabase
                    .from('students')
                    .select('id,name,email,student_id,has_voted')
                    .eq('email', authData.user.email)
                    .eq('student_id', studentId)
                    .maybeSingle();

                if (error || !data) {
                    await supabase.auth.signOut();
                    if (error && isPermissionDeniedError(error)) {
                        errorMessage.textContent = 'Login is blocked by database permissions. Please contact admin to run secure-auth-schema.sql.';
                        return;
                    }
                    errorMessage.textContent = 'Student ID does not match this account.';
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