// Supabase Configuration
import { supabase } from "./supabase-config.js";
import { initThemeToggle } from "./js/theme.js";

document.addEventListener('DOMContentLoaded', () => {
    initThemeToggle();
    const loginForm = document.getElementById('login-form');
    const errorMessage = document.getElementById('error-message');
    const submitButton = loginForm?.querySelector('button[type="submit"]');
    const PENDING_STUDENT_LOGIN_KEY = 'pending-student-login';
    const OTP_COOLDOWN_KEY = 'student-otp-cooldown-until';
    const OTP_DEFAULT_COOLDOWN_SECONDS = 8;
    const APP_INDEX_URL = new URL('index.html', window.location.href).href;
    let isSendingOtp = false;
    let otpCooldownTimer = null;

    function isPermissionDeniedError(error) {
        const message = (error?.message || '').toLowerCase();
        return error?.status === 401 || error?.status === 403 || error?.code === '42501' || message.includes('permission denied') || message.includes('forbidden');
    }

    function formatAuthError(error) {
        const code = String(error?.code || '').toLowerCase();
        const msg = String(error?.message || '').toLowerCase();
        const details = String(error?.details || '').toLowerCase();

        if (code.includes('pgrst') || msg.includes('verify_student_login_identity') || details.includes('verify_student_login_identity')) {
            return 'Login verification endpoint is missing. Ask admin to run secure-auth-schema.sql in Supabase SQL Editor.';
        }

        if (msg.includes('redirect') || msg.includes('not allowed') || msg.includes('url')) {
            return 'OTP redirect URL is not allowed in Supabase Auth settings. Add your deployed URL and try again.';
        }

        if (msg.includes('email') && msg.includes('rate')) {
            return 'Too many OTP requests. Please wait a minute and try again.';
        }

        if (String(error?.status || '') === '429' || code === '429' || msg.includes('too many requests')) {
            const source = `${error?.message || ''} ${error?.details || ''}`;
            const waitMatch = source.match(/after\s+(\d+)\s*seconds?/i);
            const seconds = Number(waitMatch?.[1] || OTP_DEFAULT_COOLDOWN_SECONDS);
            return `Too many OTP requests. Please wait ${seconds}s and try again.`;
        }

        return error?.message || 'An unexpected error occurred. Please try again.';
    }

    function setSubmitState(disabled, label) {
        if (!submitButton) return;
        submitButton.disabled = disabled;
        if (label) {
            submitButton.innerHTML = `<i class="fa-solid fa-envelope"></i> ${label}`;
        }
    }

    function getOtpCooldownUntil() {
        try {
            return Number(localStorage.getItem(OTP_COOLDOWN_KEY) || '0');
        } catch {
            return 0;
        }
    }

    function setOtpCooldown(seconds) {
        const safeSeconds = Math.max(1, Number(seconds || OTP_DEFAULT_COOLDOWN_SECONDS));
        const until = Date.now() + safeSeconds * 1000;
        try {
            localStorage.setItem(OTP_COOLDOWN_KEY, String(until));
        } catch {
            // Ignore storage failures.
        }
        startOtpCooldownTicker();
    }

    function startOtpCooldownTicker() {
        if (!submitButton) return;

        if (otpCooldownTimer) {
            clearInterval(otpCooldownTimer);
            otpCooldownTimer = null;
        }

        const tick = () => {
            const remainingMs = getOtpCooldownUntil() - Date.now();
            if (remainingMs <= 0) {
                setSubmitState(isSendingOtp, 'Send OTP Link');
                if (otpCooldownTimer) {
                    clearInterval(otpCooldownTimer);
                    otpCooldownTimer = null;
                }
                return;
            }

            const remainingSec = Math.ceil(remainingMs / 1000);
            setSubmitState(true, `Try again in ${remainingSec}s`);
        };

        tick();
        otpCooldownTimer = setInterval(tick, 500);
    }

    startOtpCooldownTicker();

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

    async function handleAuthCallback() {
        const code = new URLSearchParams(window.location.search).get('code');
        if (!code) {
            return false;
        }

        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
            console.error('Failed to exchange OTP code for session:', error);
            errorMessage.textContent = 'Could not complete OTP sign-in. Please request a new link.';
            clearPendingStudentLogin();
            return false;
        }

        window.history.replaceState({}, document.title, window.location.pathname);
        return true;
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

    (async () => {
        await handleAuthCallback();

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
    })();

    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            if (isSendingOtp) {
                return;
            }

            const cooldownMs = getOtpCooldownUntil() - Date.now();
            if (cooldownMs > 0) {
                const seconds = Math.ceil(cooldownMs / 1000);
                errorMessage.textContent = `Please wait ${seconds}s before requesting another OTP.`;
                return;
            }

            errorMessage.textContent = '';
            errorMessage.style.color = '';

            const email = document.getElementById('email').value.trim().toLowerCase();
            const studentId = document.getElementById('student-id').value.trim();

            try {
                isSendingOtp = true;
                setSubmitState(true, 'Sending...');
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
                        emailRedirectTo: APP_INDEX_URL
                    }
                });

                if (otpError) {
                    clearPendingStudentLogin();
                    const source = `${otpError?.message || ''} ${otpError?.details || ''}`;
                    const waitMatch = source.match(/after\s+(\d+)\s*seconds?/i);
                    const waitSeconds = Number(waitMatch?.[1] || 0);
                    if (waitSeconds > 0) {
                        setOtpCooldown(waitSeconds);
                    }
                    errorMessage.textContent = formatAuthError(otpError);
                    return;
                }

                setOtpCooldown(OTP_DEFAULT_COOLDOWN_SECONDS);
                errorMessage.textContent = 'OTP login link sent. Check your email, open the link, and you will be signed in automatically.';
                errorMessage.style.color = '#166534';
                loginForm.reset();
            } catch (err) {
                console.error('An unexpected error occurred:', err);
                errorMessage.textContent = formatAuthError(err);
            } finally {
                isSendingOtp = false;
                if (getOtpCooldownUntil() <= Date.now()) {
                    setSubmitState(false, 'Send OTP Link');
                }
            }
        });
    }
});