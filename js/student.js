// Supabase Configuration
import { supabase, supabaseAdmin } from "../supabase-config.js";
import { initThemeToggle } from "./theme.js";
import { RealtimeManager } from "./realtime.js";

document.addEventListener('DOMContentLoaded', () => {
    initThemeToggle();
    const STUDENT_SESSION_KEY = 'student-authenticated';
    const STUDENT_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
    let activeElectionId = null;

    function isPermissionDeniedError(error) {
        const msg = (error?.message || '').toLowerCase();
        return error?.status === 401 || error?.status === 403 || error?.code === '42501' || msg.includes('permission denied') || msg.includes('forbidden');
    }

    function readStudentSession() {
        let sessionValue = null;
        try {
            sessionValue = sessionStorage.getItem(STUDENT_SESSION_KEY);
        } catch {
            sessionValue = null;
        }

        if (sessionValue) {
            try {
                const session = JSON.parse(sessionValue);
                // Check if session has expired
                if (session?.sessionIssuedAt && (Date.now() - Number(session.sessionIssuedAt) > STUDENT_SESSION_MAX_AGE_MS)) {
                    clearStudentSession();
                    return null;
                }
                return session;
            } catch {
                try {
                    sessionStorage.removeItem(STUDENT_SESSION_KEY);
                } catch {
                    // Ignore storage cleanup failures.
                }
            }
        }

        let localValue = null;
        try {
            localValue = localStorage.getItem(STUDENT_SESSION_KEY);
        } catch {
            localValue = null;
        }

        if (localValue) {
            try {
                const parsed = JSON.parse(localValue);
                // Check if session has expired
                if (parsed?.sessionIssuedAt && (Date.now() - Number(parsed.sessionIssuedAt) > STUDENT_SESSION_MAX_AGE_MS)) {
                    clearStudentSession();
                    return null;
                }
                try {
                    sessionStorage.setItem(STUDENT_SESSION_KEY, JSON.stringify(parsed));
                } catch {
                    // Keep local storage as fallback.
                }
                return parsed;
            } catch {
                try {
                    localStorage.removeItem(STUDENT_SESSION_KEY);
                } catch {
                    // Ignore storage cleanup failures.
                }
            }
        }

        return null;
    }

    function saveStudentSession(student) {
        const payload = JSON.stringify(student);
        try {
            sessionStorage.setItem(STUDENT_SESSION_KEY, payload);
        } catch {
            // Ignore session storage failures on restrictive mobile browsers.
        }
        try {
            localStorage.setItem(STUDENT_SESSION_KEY, payload);
        } catch {
            // Ignore local storage failures and proceed.
        }
    }

    function clearStudentSession() {
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

    async function validateStudentSession() {
        try {
            const student = readStudentSession();
            if (!student?.email) {
                clearStudentSession();
                return null;
            }

            const { data: authData, error: authError } = await supabase.auth.getUser();
            const authEmail = (!authError && authData?.user?.email) ? String(authData.user.email).toLowerCase() : null;
            const studentEmail = String(student.email || '').toLowerCase();
            const useAuthIdentity = !!authEmail && authEmail === studentEmail;

            let query = supabase
                .from('students')
                .select('id,name,email,student_id,has_voted')
                .eq('email', useAuthIdentity ? authEmail : student.email);

            if (!useAuthIdentity && student.student_id) {
                // Legacy fallback validation when auth session is unavailable.
                query = query.eq('student_id', student.student_id);
            }

            const { data, error } = await query.maybeSingle();

            if (error || !data) {
                // If backend policies temporarily block revalidation, keep valid local session briefly.
                if (student?.id && student?.student_id && (Date.now() - Number(student.sessionIssuedAt || 0) <= STUDENT_SESSION_MAX_AGE_MS)) {
                    if (error && isPermissionDeniedError(error)) {
                        return student;
                    }
                }
                clearStudentSession();
                return null;
            }

            const refreshedStudent = {
                ...student,
                id: data.id,
                name: data.name,
                email: data.email,
                student_id: data.student_id,
                has_voted: !!data.has_voted,
                sessionIssuedAt: student?.sessionIssuedAt || Date.now()
            };

            saveStudentSession(refreshedStudent);
            return refreshedStudent;
        } catch (error) {
            console.error('Failed to validate student session:', error);
            const fallbackStudent = readStudentSession();
            if (fallbackStudent?.id && fallbackStudent?.student_id && (Date.now() - Number(fallbackStudent.sessionIssuedAt || 0) <= STUDENT_SESSION_MAX_AGE_MS)) {
                return fallbackStudent;
            }
            clearStudentSession();
            return null;
        }
    }

    function updateSubmitAvailability(canSubmit) {
        const submitButton = document.querySelector('button[type="submit"][form="vote-form"]');
        if (!submitButton) return;

        submitButton.style.display = canSubmit ? 'inline-flex' : 'none';
        submitButton.disabled = !canSubmit;
    }

    function setVoteMessage(message, tone = 'default') {
        const errorEl = document.getElementById('error-message');
        if (!errorEl) return;

        if (tone === 'success') {
            errorEl.style.color = '#166534';
        } else if (tone === 'error') {
            errorEl.style.color = '#b42318';
        } else {
            errorEl.style.color = '';
        }

        errorEl.textContent = message;
    }

    function setStatusText(elementId, value, tone = 'neutral') {
        const el = document.getElementById(elementId);
        if (!el) return;

        el.textContent = value;
        el.classList.remove('status-tone-good', 'status-tone-warn', 'status-tone-neutral');

        if (tone === 'good') {
            el.classList.add('status-tone-good');
        } else if (tone === 'warn') {
            el.classList.add('status-tone-warn');
        } else {
            el.classList.add('status-tone-neutral');
        }
    }

    function renderDashboardStatus(state) {
        const summary = document.getElementById('election-status-summary');
        if (!summary) return;

        if (state.hasError) {
            summary.textContent = state.hasPolicyError
                ? 'Election status is restricted by database policy. Contact an admin.'
                : 'Unable to load election status right now. Please refresh the page.';
            setStatusText('status-election', 'Unknown', 'warn');
            setStatusText('status-eligibility', 'Unknown', 'warn');
            setStatusText('status-vote', 'Unknown', 'warn');
            return;
        }

        if (!state.isActive) {
            summary.textContent = 'No election is active at the moment.';
            setStatusText('status-election', 'No Active Election', 'warn');
            setStatusText('status-eligibility', 'Not Applicable', 'neutral');
            setStatusText('status-vote', 'Not Submitted', 'neutral');
            return;
        }

        const electionLabel = state.electionName ? `Active: ${state.electionName}` : 'Active Election';
        setStatusText('status-election', electionLabel, 'good');

        if (!state.isEligible) {
            summary.textContent = 'An election is active, but your account is not eligible for this ballot.';
            setStatusText('status-eligibility', 'Not Eligible', 'warn');
            setStatusText('status-vote', 'Not Submitted', 'neutral');
            return;
        }

        setStatusText('status-eligibility', 'Eligible', 'good');

        if (state.alreadyVoted) {
            summary.textContent = 'Your vote has been submitted for the active election.';
            setStatusText('status-vote', 'Submitted', 'good');
            return;
        }

        summary.textContent = 'You are eligible to vote now. Use Cast Vote to continue.';
        setStatusText('status-vote', 'Pending', 'warn');
    }

    // Student Dashboard
    if (window.location.pathname.includes('dashboard.html')) {
        validateStudentSession().then((student) => {
            if (!student) {
                window.location.href = '../index.html';
                return;
            }

            document.getElementById('student-name').textContent = student.name;

            initializeVotingContext(student).then((state) => {
                renderDashboardStatus(state);

                // Set up realtime subscriptions if election is active
                if (state.isActive && state.isEligible && !state.alreadyVoted && activeElectionId) {
                    // Subscribe to student's own votes - quick update when submission confirmed
                    RealtimeManager.subscribeToStudentVotes(student.id, async () => {
                        console.log('✓ Vote detected! Updating dashboard...');
                        const updatedState = await initializeVotingContext(student);
                        renderDashboardStatus(updatedState);
                        if (updatedState.alreadyVoted) {
                            // Only show toast on actual vote confirmation
                            const msg = document.createElement('div');
                            msg.style.cssText = 'position:fixed; top:20px; right:20px; background:#166534; color:#fff; padding:12px 20px; border-radius:4px; z-index:9999; font-size:14px;';
                            msg.textContent = '✓ Vote submitted successfully!';
                            document.body.appendChild(msg);
                            setTimeout(() => msg.remove(), 3000);
                        }
                    });

                    // Subscribe to election status changes (main update trigger)
                    RealtimeManager.subscribeToElectionStatus(activeElectionId, async (updatedElection) => {
                        if (updatedElection.status !== 'active') {
                            console.log('✓ Election closed. Updating dashboard...');
                            const updatedState = await initializeVotingContext(student);
                            renderDashboardStatus(updatedState);
                        }
                    });
                }
            });

            // Clean up subscriptions when leaving dashboard
            window.addEventListener('beforeunload', () => {
                RealtimeManager.unsubscribeAll();
            });
        });
    }
    
    // Voting Page
    if (window.location.pathname.includes('vote.html')) {
        const voteForm = document.getElementById('vote-form');
        const voteSuccessActions = document.getElementById('vote-success-actions');
        const stayOnBallotButton = document.getElementById('stay-on-ballot');

        if (stayOnBallotButton) {
            stayOnBallotButton.addEventListener('click', () => {
                voteSuccessActions?.classList.add('hidden');
                setVoteMessage('Your vote has already been recorded for this election.', 'success');
            });
        }

        voteForm.innerHTML = '<p class="subtitle">Loading your ballot...</p>';
        updateSubmitAvailability(false);

        validateStudentSession().then((student) => {
            if (!student) {
                window.location.href = '../index.html';
                return;
            }

            // Check election status and student eligibility for active election.
            initializeVotingContext(student).then(async ({ isActive, isEligible, alreadyVoted, electionName, hasError, hasPolicyError }) => {
                if (hasError) {
                    if (hasPolicyError) {
                        voteForm.innerHTML = '<p class="subtitle">Voting data access is currently restricted by database policy. Please contact an admin.</p>';
                        setVoteMessage('Ballot access is currently restricted by policy.', 'error');
                    } else {
                        voteForm.innerHTML = '<p class="subtitle">We could not load election data right now. Please refresh and try again.</p>';
                        setVoteMessage('Connection issue while loading ballot.', 'error');
                    }
                    updateSubmitAvailability(false);
                    return;
                }

                if (!isActive) {
                    voteForm.innerHTML = '<p class="subtitle">No active election right now. Please check back later.</p>';
                    updateSubmitAvailability(false);
                    return;
                }

                if (!isEligible) {
                    voteForm.innerHTML = `<p class="subtitle">You are not eligible to vote in ${electionName || 'this election'}. Contact election admins for support.</p>`;
                    updateSubmitAvailability(false);
                    return;
                }

                if (alreadyVoted) {
                    voteForm.innerHTML = '<p class="subtitle">Your vote for this election has already been recorded. Thank you for participating.</p>';
                    updateSubmitAvailability(false);
                    return;
                }

                const hasBallot = await loadVotingForm(activeElectionId);
                updateSubmitAvailability(hasBallot);
            });
        });

        voteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const student = await validateStudentSession();
            if (!student) {
                window.location.href = '../index.html';
                return;
            }

            const formData = new FormData(voteForm);
            const votes = [];
            for (const [positionId, candidateId] of formData.entries()) {
                votes.push({
                    student_id: student.id,
                    candidate_id: candidateId,
                    position_id: positionId,
                    vote_time: new Date()
                });
            }

            try {
                if (votes.length === 0) {
                    throw new Error('Please select candidates before submitting.');
                }

                updateSubmitAvailability(false); // Disable immediately to prevent double-submission
                setVoteMessage('Submitting your vote...', 'default');

                // Insert all votes first. Unique constraint on (student_id, position_id)
                // prevents duplicate voting for a position.
                const payload = votes.map(vote => ({
                    student_id: vote.student_id,
                    candidate_id: Number(vote.candidate_id),
                    position_id: Number(vote.position_id),
                    election_id: activeElectionId,
                    vote_time: vote.vote_time
                }));

                const { error: insertError } = await supabaseAdmin
                    .from('votes')
                    .insert(payload);

                if (insertError) {
                    if (isPermissionDeniedError(insertError)) {
                        throw new Error('Vote submission is blocked by database permissions. Ask admin to run fix-student-vote-permissions.sql.');
                    }
                    throw insertError;
                }

                // Update session storage
                student.has_voted = true;
                saveStudentSession(student);
                // Redirect to thank you page
                window.location.href = 'thank-you.html';
            } catch (error) {
                console.error('Error submitting vote:', error);
                const message = error?.message || 'Error submitting vote. Please try again.';
                setVoteMessage(message, 'error');
                updateSubmitAvailability(true); // Re-enable on error
            }
        });
    }

    async function initializeVotingContext(student) {
        try {
            const { data, error } = await supabase
                .from('elections')
                .select('id,name,status,created_at')
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                return { isActive: false, isEligible: false, alreadyVoted: false, electionName: null, hasError: false, hasPolicyError: false };
            }

            activeElectionId = data.id;

            let isEligible = false;
            let alreadyVoted = false;
            let hasPolicyWarning = false;

            const { data: eligibility, error: eligibilityError } = await supabaseAdmin
                .from('election_eligible_students')
                .select('student_id')
                .eq('election_id', activeElectionId)
                .eq('student_id', student.id)
                .maybeSingle();

            if (eligibilityError) {
                if (isPermissionDeniedError(eligibilityError)) {
                    hasPolicyWarning = true;
                    // Graceful fallback for older/public-login deployments.
                    isEligible = true;
                } else {
                    throw eligibilityError;
                }
            } else {
                isEligible = !!eligibility;

                if (!isEligible) {
                    // When no explicit eligibility rows exist, election is open-to-all students.
                    const { count, error: eligibilityCountError } = await supabase
                        .from('election_eligible_students')
                        .select('student_id', { count: 'exact', head: true })
                        .eq('election_id', activeElectionId);

                    if (!eligibilityCountError && Number(count || 0) === 0) {
                        isEligible = true;
                    }
                }
            }

            const { data: previousVotes, error: votesError } = await supabaseAdmin
                .from('votes')
                .select('id')
                .eq('election_id', activeElectionId)
                .eq('student_id', student.id)
                .limit(1);

            if (votesError) {
                if (isPermissionDeniedError(votesError)) {
                    hasPolicyWarning = true;
                    alreadyVoted = !!student?.has_voted;
                } else {
                    throw votesError;
                }
            } else {
                alreadyVoted = (previousVotes || []).length > 0;
            }

            return {
                isActive: true,
                isEligible,
                alreadyVoted,
                electionName: data.name || null,
                hasError: false,
                hasPolicyError: hasPolicyWarning
            };
        } catch (error) {
            console.error('Error preparing voting context:', error);
            return {
                isActive: false,
                isEligible: false,
                alreadyVoted: false,
                electionName: null,
                hasError: true,
                hasPolicyError: isPermissionDeniedError(error)
            };
        }
    }

    async function loadVotingForm(electionId) {
        try {
            const form = document.getElementById('vote-form');
            form.innerHTML = '';

            // Get positions allowed in this election
            const { data: electionPositions, error: electionPositionsError } = await supabaseAdmin
                .from('election_positions')
                .select('position_id')
                .eq('election_id', electionId);

            if (electionPositionsError) throw electionPositionsError;

            const positionIds = (electionPositions || []).map(p => p.position_id);
            if (!positionIds.length) {
                document.getElementById('vote-form').innerHTML = '<p class="subtitle">No positions configured for this election yet.</p>';
                return false;
            }

            const { data: positions, error: positionsError } = await supabase
                .from('positions')
                .select('*')
                .in('id', positionIds)
                .order('id', { ascending: true });

            if (positionsError) throw positionsError;

            // Get candidates allowed in this election when mapping table exists,
            // otherwise fall back to all candidates for backward compatibility.
            let allowedCandidateIds = null;
            try {
                const { data: mappedCandidates, error: mappedCandidatesError } = await supabaseAdmin
                    .from('election_candidates')
                    .select('candidate_id')
                    .eq('election_id', electionId);

                if (mappedCandidatesError) {
                    throw mappedCandidatesError;
                }

                allowedCandidateIds = (mappedCandidates || []).map(row => row.candidate_id);
            } catch (mappingError) {
                console.warn('Election candidate mapping unavailable, using position-based candidates.', mappingError.message);
            }

            let candidatesQuery = supabase
                .from('candidates')
                .select('*')
                .order('position_id', { ascending: true });

            if (Array.isArray(allowedCandidateIds)) {
                if (!allowedCandidateIds.length) {
                    document.getElementById('vote-form').innerHTML = '<p class="subtitle">No candidates configured for this election yet.</p>';
                    return false;
                }
                candidatesQuery = candidatesQuery.in('id', allowedCandidateIds);
            }

            const { data: candidates, error: candidatesError } = await candidatesQuery;

            if (candidatesError) throw candidatesError;

            let renderedAnyPosition = false;
            for (const position of positions) {
                const fieldset = document.createElement('fieldset');
                fieldset.className = 'vote-position';
                const legend = document.createElement('legend');
                legend.textContent = position.position_name;
                fieldset.appendChild(legend);

                const positionCandidates = candidates.filter(c => c.position_id === position.id);
                if (!positionCandidates.length) {
                    continue;
                }

                renderedAnyPosition = true;
                for (const candidate of positionCandidates) {
                    const label = document.createElement('label');
                    label.className = 'candidate-item';
                    const radio = document.createElement('input');
                    radio.type = 'radio';
                    radio.name = position.id;
                    radio.value = candidate.id;
                    radio.required = true;

                    label.appendChild(radio);
                    label.append(` ${candidate.name}`);
                    fieldset.appendChild(label);
                }
                form.appendChild(fieldset);
            }

            if (!renderedAnyPosition) {
                form.innerHTML = '<p class="subtitle">No candidates are currently available for your ballot.</p>';
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error loading voting form:', error);
            document.getElementById('vote-form').innerHTML = '<p class="subtitle">Unable to load ballot options right now. Please refresh and try again.</p>';
            setVoteMessage('Error loading voting form. Please refresh the page.', 'error');
            return false;
        }
    }
    
    // Logout
    const logoutButton = document.getElementById('logout');
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            try {
                await supabase.auth.signOut();
            } catch (error) {
                console.error('Failed to sign out cleanly:', error);
            }
            clearStudentSession();
            window.location.href = '../index.html';
        });
    }
});
