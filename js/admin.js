// Supabase Configuration
import { SUPABASE_URL, supabase, supabaseAdmin } from "../supabase-config.js";
import { initThemeToggle } from "./theme.js";
import { RealtimeManager } from "./realtime.js";

document.addEventListener('DOMContentLoaded', () => {
    initThemeToggle();
    if (/\/admin\/election\.html$/i.test(window.location.pathname)) {
        window.location.href = 'election-candidates.html';
        return;
    }

    setupElectionControlDropdown();
    setupAdminToolsNav();
    normalizeSidebarLabels();
    setupGlobalAccessibility();

    function normalizeSidebarLabels() {
        const labelByHref = {
            'dashboard.html': 'Dashboard',
            'students.html': 'Manage Students',
            'positions.html': 'Manage Positions',
            'candidates.html': 'Manage Candidates',
            'election.html': 'Election Control',
            'results.html': 'View Results',
            'admin-tools.html': 'Admin Tools'
        };

        document.querySelectorAll('.sidebar-nav a').forEach((link) => {
            const href = (link.getAttribute('href') || '').split('?')[0].toLowerCase();
            const key = href.includes('/') ? href.substring(href.lastIndexOf('/') + 1) : href;
            const label = labelByHref[key];
            if (!label) return;

            const text = link.querySelector('.nav-text');
            if (text) {
                text.textContent = label;
            }
        });
    }

    function isPermissionDeniedError(error) {
        const msg = (error?.message || '').toLowerCase();
        return error?.status === 403 || error?.code === '42501' || msg.includes('permission denied') || msg.includes('forbidden');
    }

    async function ensureAdminSession() {
        if (!window.location.pathname.includes('/admin/') || window.location.pathname.includes('/admin/login.html')) {
            return true;
        }

        const localFlag = localStorage.getItem('admin-authenticated') === 'true';
        if (!localFlag) {
            window.location.href = 'login.html';
            return false;
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const user = sessionData?.session?.user;
        if (!user?.id) {
            localStorage.removeItem('admin-authenticated');
            localStorage.removeItem('admin-user-id');
            window.location.href = 'login.html';
            return false;
        }

        const { data: adminData, error: adminError } = await supabaseAdmin
            .from('admins')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (adminError || !adminData) {
            await supabase.auth.signOut();
            localStorage.removeItem('admin-authenticated');
            localStorage.removeItem('admin-user-id');
            window.location.href = 'login.html';
            return false;
        }

        return true;
    }

    function showToast(message, type = 'info') {
        if (!message) return;
        let container = document.querySelector('.app-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'app-toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `app-toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    function ensureAppModal() {
        let modal = document.getElementById('app-modal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'app-modal';
        modal.className = 'app-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'app-modal-title');
        modal.innerHTML = `
            <div class="app-modal-dialog">
                <div class="app-modal-header">
                    <h3 id="app-modal-title" class="app-modal-title">Notice</h3>
                </div>
                <div id="app-modal-body" class="app-modal-body"></div>
                <div class="app-modal-footer">
                    <button id="app-modal-cancel" type="button" class="btn btn-secondary">Cancel</button>
                    <button id="app-modal-confirm" type="button" class="btn btn-primary">OK</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        return modal;
    }

    function openAppModal({ title = 'Notice', message = '', confirmText = 'OK', cancelText = 'Cancel', showCancel = false, tone = 'primary' }) {
        const modal = ensureAppModal();
        const titleEl = modal.querySelector('#app-modal-title');
        const bodyEl = modal.querySelector('#app-modal-body');
        const confirmBtn = modal.querySelector('#app-modal-confirm');
        const cancelBtn = modal.querySelector('#app-modal-cancel');

        titleEl.textContent = title;
        bodyEl.innerHTML = String(message || '').replace(/\n/g, '<br>');
        confirmBtn.textContent = confirmText;
        confirmBtn.className = `btn ${tone === 'destructive' ? 'btn-danger' : tone === 'secondary' ? 'btn-secondary' : 'btn-primary'}`;
        cancelBtn.textContent = cancelText;
        cancelBtn.style.display = showCancel ? 'inline-flex' : 'none';

        modal.classList.add('open');
        confirmBtn.focus();

        return new Promise((resolve) => {
            const close = (result) => {
                modal.classList.remove('open');
                confirmBtn.removeEventListener('click', onConfirm);
                cancelBtn.removeEventListener('click', onCancel);
                modal.removeEventListener('click', onBackdrop);
                document.removeEventListener('keydown', onKeyDown);
                resolve(result);
            };

            const onConfirm = () => close(true);
            const onCancel = () => close(false);
            const onBackdrop = (event) => {
                if (event.target === modal) close(false);
            };
            const onKeyDown = (event) => {
                if (!modal.classList.contains('open')) return;
                if (event.key === 'Escape') {
                    event.preventDefault();
                    close(false);
                }
                if (event.key === 'Enter') {
                    event.preventDefault();
                    close(true);
                }
            };

            confirmBtn.addEventListener('click', onConfirm);
            cancelBtn.addEventListener('click', onCancel);
            modal.addEventListener('click', onBackdrop);
            document.addEventListener('keydown', onKeyDown);
        });
    }

    async function showAlertModal(message, title = 'Notice') {
        await openAppModal({ title, message, confirmText: 'OK', showCancel: false });
    }

    async function showConfirmModal(message, title = 'Please Confirm', confirmText = 'Confirm', tone = 'destructive') {
        return await openAppModal({ title, message, confirmText, cancelText: 'Cancel', showCancel: true, tone });
    }

    // Replace blocking browser alerts with the shared in-app modal.
    window.alert = function(message) {
        showAlertModal(String(message || ''), 'Notice');
    };

    function getStatusBadgeHtml(status) {
        const safe = (status || 'draft').toLowerCase();
        return `<span class="status-badge ${safe}">${safe}</span>`;
    }

    async function logAdminAction(action, targetType = '', targetId = '', details = {}) {
        try {
            const { data: userData } = await supabase.auth.getUser();
            const adminUserId = userData?.user?.id;
            if (!adminUserId) return;

            await supabaseAdmin
                .from('admin_audit_logs')
                .insert([{
                    admin_user_id: adminUserId,
                    action,
                    target_type: targetType || null,
                    target_id: targetId ? String(targetId) : null,
                    details
                }]);
        } catch (error) {
            console.warn('Audit log insert skipped:', error.message);
        }
    }

    function downloadCsv(filename, rows) {
        const csv = rows
            .map(row => row.map(value => {
                const text = value == null ? '' : String(value);
                return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
            }).join(','))
            .join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    async function syncElectionStatusesByTime() {
        try {
            const { data: elections, error } = await supabaseAdmin
                .from('elections')
                .select('id,name,start_time,end_time,status,created_at')
                .order('created_at', { ascending: false });

            if (error || !(elections || []).length) return;

            const now = new Date();
            const updates = [];

            for (const election of elections) {
                const end = election.end_time ? new Date(election.end_time) : null;
                // Manual lifecycle: never auto-promote draft -> active.
                // Auto-close only: if an active election reaches end time, end it.
                if (election.status === 'active' && end && now >= end) {
                    updates.push({ id: election.id, status: 'ended' });
                }
            }

            const activeCandidates = elections.filter(e => e.status === 'active');
            if (activeCandidates.length > 1) {
                const winner = activeCandidates
                    .slice()
                    .sort((a, b) => new Date(b.start_time || b.created_at) - new Date(a.start_time || a.created_at))[0];
                activeCandidates.forEach(e => {
                    if (e.id !== winner.id) updates.push({ id: e.id, status: 'ended' });
                });
            }

            const dedupedUpdates = Array.from(new Map(updates.map(u => [u.id, u])).values());

            for (const u of dedupedUpdates) {
                await supabaseAdmin.from('elections').update({ status: u.status }).eq('id', u.id);
            }
        } catch (error) {
            console.warn('Election status sync skipped:', error.message);
        }
    }

    async function injectActiveElectionBanner() {
        if (!window.location.pathname.includes('/admin/') || window.location.pathname.includes('/admin/login.html')) return;
        const content = document.querySelector('.main-content');
        if (!content) return;

        const existing = document.getElementById('active-election-banner');
        if (existing) existing.remove();

        const active = await getActiveElection();
        const banner = document.createElement('div');
        banner.id = 'active-election-banner';
        banner.className = 'active-election-banner';

        if (active?.name || active?.election_name) {
            const name = active.name || active.election_name;
            const end = active.end_time ? new Date(active.end_time).toLocaleString() : 'No end time';
            banner.innerHTML = `<i class="fas fa-bolt"></i> Active Election: <strong>${name}</strong><span class="meta">Ends: ${end}</span>`;
        } else {
            banner.innerHTML = `<i class="fas fa-circle-info"></i> No active election right now.`;
        }

        content.insertBefore(banner, content.firstChild);
    }

    async function getElectionReadiness(electionId) {
        if (!electionId || isLegacyElectionId(electionId)) {
            return { ready: false, issues: ['Legacy election must be migrated first.'] };
        }

        const issues = [];

        const [{ data: election, error: electionError }, { count: candidateCount, error: candidateError }, { count: eligibleCount, error: eligibleError }] = await Promise.all([
            supabaseAdmin.from('elections').select('id,start_time,end_time').eq('id', electionId).single(),
            supabaseAdmin.from('election_candidates').select('*', { count: 'exact', head: true }).eq('election_id', electionId),
            supabaseAdmin.from('election_eligible_students').select('*', { count: 'exact', head: true }).eq('election_id', electionId)
        ]);

        if (electionError) throw electionError;
        if (candidateError) throw candidateError;
        if (eligibleError) throw eligibleError;

        const start = election?.start_time ? new Date(election.start_time) : null;
        const end = election?.end_time ? new Date(election.end_time) : null;

        if (!start || !end) issues.push('Start and end time must be set.');
        if (start && end && start >= end) issues.push('End time must be after start time.');
        if ((candidateCount || 0) < 1) issues.push('At least one candidate must be assigned.');
        if ((eligibleCount || 0) < 1) issues.push('At least one eligible student must be assigned.');

        return { ready: issues.length === 0, issues };
    }

    function applyElectionEditLock(status) {
        const isActive = status === 'active';
        const candidatesLocked = isActive || selectedElectionLocks.candidatesLocked;
        const eligibilityLocked = isActive || selectedElectionLocks.eligibilityLocked;
        const candidateCheckboxes = document.querySelectorAll('.election-candidate-checkbox');
        const eligibilityCheckboxes = document.querySelectorAll('.eligibility-checkbox');

        candidateCheckboxes.forEach(cb => { cb.disabled = candidatesLocked; });
        eligibilityCheckboxes.forEach(cb => { cb.disabled = eligibilityLocked; });

        ['save-election-candidates', 'select-all-candidates', 'clear-all-candidates']
            .forEach(id => {
                const btn = document.getElementById(id);
                if (btn) {
                    btn.disabled = candidatesLocked;
                    btn.title = candidatesLocked
                        ? (selectedElectionLocks.candidatesLocked
                            ? 'Candidate mapping has been locked after save for this election.'
                            : 'Editing is locked while election is active.')
                        : '';
                }
            });

        ['save-eligibility', 'select-all-eligible', 'clear-all-eligible']
            .forEach(id => {
                const btn = document.getElementById(id);
                if (btn) {
                    btn.disabled = eligibilityLocked;
                    btn.title = eligibilityLocked
                        ? (selectedElectionLocks.eligibilityLocked
                            ? 'Student eligibility has been locked after save for this election.'
                            : 'Editing is locked while election is active. End election first.')
                        : '';
                }
            });

        syncElectionActiveToggle();
    }

    // Admin Login
    const adminLoginForm = document.getElementById('admin-login-form');
    const connectionStatusEl = document.getElementById('connection-status');

    async function checkSupabaseConnection() {
        if (!connectionStatusEl) return;

        if (!navigator.onLine) {
            connectionStatusEl.textContent = 'Supabase status: Offline (no internet connection)';
            connectionStatusEl.style.color = '#c0392b';
            return;
        }

        connectionStatusEl.textContent = 'Supabase status: Checking...';
        connectionStatusEl.style.color = '#64748b';
        try {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('probe-timeout')), 8000);
            });

            // Use Supabase client so the probe follows normal project headers/policies.
            const probePromise = supabase
                .from('positions')
                .select('id')
                .limit(1);

            const result = await Promise.race([probePromise, timeoutPromise]);

            // Permission errors still indicate service reachability.
            const probeError = result?.error;
            const probeMessage = (probeError?.message || '').toLowerCase();
            const isNetworkIssue =
                probeMessage.includes('failed to fetch') ||
                probeMessage.includes('network') ||
                probeMessage.includes('timeout');

            if (isNetworkIssue) {
                connectionStatusEl.textContent = 'Supabase status: Unreachable';
                connectionStatusEl.style.color = '#c0392b';
                return;
            }

            connectionStatusEl.textContent = 'Supabase status: Connected';
            connectionStatusEl.style.color = '#1f9d55';
        } catch (error) {
            if (error && error.message === 'probe-timeout') {
                connectionStatusEl.textContent = 'Supabase status: Timeout (check internet or firewall)';
                connectionStatusEl.style.color = '#c0392b';
            } else {
                connectionStatusEl.textContent = 'Supabase status: Unreachable';
                connectionStatusEl.style.color = '#c0392b';
            }
        }
    }

    if (connectionStatusEl) {
        checkSupabaseConnection();
        window.addEventListener('online', checkSupabaseConnection);
        window.addEventListener('offline', checkSupabaseConnection);
    }

    if (adminLoginForm) {
        adminLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const errorMessageEl = document.getElementById('error-message');
            if (errorMessageEl) errorMessageEl.textContent = '';

            const cooldownUntil = Number(localStorage.getItem('admin-login-cooldown-until') || '0');
            if (Date.now() < cooldownUntil) {
                const seconds = Math.ceil((cooldownUntil - Date.now()) / 1000);
                if (errorMessageEl) errorMessageEl.textContent = `Too many failed attempts. Try again in ${seconds}s.`;
                return;
            }

            if (!navigator.onLine) {
                if (errorMessageEl) errorMessageEl.textContent = 'You are offline. Connect to the internet and try again.';
                return;
            }

            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            
            console.log('Attempting admin login with email:', email);
            
            try {
                // Sign in with Supabase Auth
                const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                    email: email,
                    password: password
                });

                if (authError) {
                    console.error('Auth Error:', authError);
                    if (errorMessageEl) errorMessageEl.textContent = 'Login failed: ' + authError.message;
                    const attempts = Number(localStorage.getItem('admin-login-failures') || '0') + 1;
                    localStorage.setItem('admin-login-failures', String(attempts));
                    if (attempts >= 5) {
                        localStorage.setItem('admin-login-cooldown-until', String(Date.now() + 30000));
                        localStorage.setItem('admin-login-failures', '0');
                    }
                    return;
                }

                if (!authData?.user?.id) {
                    if (errorMessageEl) errorMessageEl.textContent = 'Login failed: No user session returned from Supabase.';
                    return;
                }

                const userId = authData.user.id;
                console.log('Auth successful. User ID:', userId);

                // Check if user is admin in database
                const { data: adminData, error: adminError } = await supabaseAdmin
                    .from('admins')
                    .select('*')
                    .eq('user_id', userId)
                    .single();

                if (adminError || !adminData) {
                    console.error('Admin lookup failed:', adminError);
                    await supabase.auth.signOut();
                    if (errorMessageEl) {
                        if (adminError?.message) {
                            errorMessageEl.textContent = 'Admin authorization failed: ' + adminError.message;
                        } else {
                            errorMessageEl.textContent = 'You are not authorized as an admin.';
                        }
                    }
                    const attempts = Number(localStorage.getItem('admin-login-failures') || '0') + 1;
                    localStorage.setItem('admin-login-failures', String(attempts));
                    if (attempts >= 5) {
                        localStorage.setItem('admin-login-cooldown-until', String(Date.now() + 30000));
                        localStorage.setItem('admin-login-failures', '0');
                    }
                    return;
                }

                console.log('Admin authorized. Redirecting to dashboard...');
                // Admin login successful
                localStorage.setItem('admin-authenticated', 'true');
                localStorage.setItem('admin-user-id', userId);
                localStorage.setItem('admin-login-failures', '0');
                localStorage.removeItem('admin-login-cooldown-until');
                window.location.href = 'dashboard.html';
            } catch (error) {
                console.error('Auth Error:', error);
                const msg = (error && error.message)
                    ? error.message
                    : 'Unexpected network error.';
                if (errorMessageEl) errorMessageEl.textContent = 'Login failed: ' + msg;
            }
        });
    }

    // Check if admin is authenticated
    if (window.location.pathname.includes('/admin/') && !window.location.pathname.includes('/admin/login.html')) {
        ensureAdminSession().then((ok) => {
            if (!ok) return;
            syncElectionStatusesByTime();
            injectActiveElectionBanner();
            setInterval(() => {
                syncElectionStatusesByTime();
                injectActiveElectionBanner();
            }, 60000);
        });
    }

    // Dashboard Statistics
    if (window.location.pathname.includes('dashboard.html')) {
        ensureAdminSession().then((ok) => {
            if (!ok) return;
            loadDashboardStats();
            loadRecentVotingActivity();
        });
    }

    async function performLogout(event) {
        if (event) event.preventDefault();
        try {
            await supabase.auth.signOut();
            localStorage.removeItem('admin-authenticated');
            localStorage.removeItem('admin-user-id');
            window.location.href = 'login.html';
        } catch (error) {
            console.error('Logout error:', error);
            showAlertModal('Could not log out. Please try again.');
        }
    }

    // Logout (direct binding + delegated fallback so it works on all pages)
    const logoutButton = document.getElementById('logout');
    if (logoutButton) {
        logoutButton.addEventListener('click', performLogout);
    }

    document.addEventListener('click', (event) => {
        const logoutLink = event.target.closest('#logout');
        if (!logoutLink) return;
        performLogout(event);
    });
    
    // Manage Students
    const addStudentForm = document.getElementById('add-student-form');
    const studentsList = document.getElementById('students-list');
    if (addStudentForm) {
        addStudentForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('name').value;
            const studentId = document.getElementById('student-id').value;
            const email = document.getElementById('email').value;
            const department = document.getElementById('department').value;

            try {
                const activeElection = await getActiveElection();
                if (activeElection) {
                    showAlertModal('Cannot add students while an election is active. End the active election first.');
                    return;
                }

                const { data, error } = await supabaseAdmin
                    .from('students')
                    .insert([{
                        name: name,
                        student_id: studentId,
                        email: email,
                        department: department,
                        has_voted: false
                    }])
                    .select();

                if (error) throw error;

                showToast('Student added successfully!', 'success');
                addStudentForm.reset();
                loadStudents();
            } catch (error) {
                console.error('Error adding student:', error);
                showAlertModal('Error adding student: ' + error.message, 'Error');
            }
        });
        loadStudents();
    }

    async function loadStudents() {
        try {
            const { data, error } = await supabaseAdmin
                .from('students')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            if (studentsList) {
                studentsList.innerHTML = data.map(student => {
                    return `
                        <tr>
                            <td>${student.name}</td>
                            <td>${student.student_id}</td>
                            <td>${student.email}</td>
                            <td>${student.department || '-'}</td>
                            <td>${student.has_voted ? 'Yes' : 'No'}</td>
                            <td>
                                <div class="row-actions">
                                <button
                                    class="student-edit-btn btn-primary"
                                    data-id="${student.id}"
                                    data-name="${encodeURIComponent(student.name || '')}"
                                    data-student-id="${encodeURIComponent(student.student_id || '')}"
                                    data-email="${encodeURIComponent(student.email || '')}"
                                    data-department="${encodeURIComponent(student.department || '')}"
                                >Edit</button>
                                <button
                                    class="student-delete-btn btn-danger"
                                    data-id="${student.id}"
                                    data-name="${encodeURIComponent(student.name || '')}"
                                >Delete</button>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        } catch (error) {
            console.error('Error loading students:', error);
        }
    }

    let currentEditStudentId = null;

    window.openEditStudent = function(id, name, studentId, email, department) {
        currentEditStudentId = id;
        document.getElementById('edit-name').value = name;
        document.getElementById('edit-student-id').value = studentId;
        document.getElementById('edit-email').value = email;
        document.getElementById('edit-department').value = department;
        
        const modal = document.getElementById('edit-modal');
        modal.style.display = 'flex';
    };

    // Setup edit form submission with delay to ensure HTML is ready
    setTimeout(() => {
        const editStudentForm = document.getElementById('edit-student-form');
        if (editStudentForm) {
            editStudentForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const name = document.getElementById('edit-name').value;
                const studentId = document.getElementById('edit-student-id').value;
                const email = document.getElementById('edit-email').value;
                const department = document.getElementById('edit-department').value;

                try {
                    const { error } = await supabaseAdmin
                        .from('students')
                        .update({
                            name: name,
                            student_id: studentId,
                            email: email,
                            department: department
                        })
                        .eq('id', currentEditStudentId);

                    if (error) throw error;

                    showToast('Student updated successfully!', 'success');
                    document.getElementById('edit-modal').style.display = 'none';
                    loadStudents();
                } catch (error) {
                    console.error('Error updating student:', error);
                    showAlertModal('Error updating student: ' + error.message, 'Error');
                }
            });
        }
    }, 100);

    window.deleteStudent = async function(id, name) {
        const confirmed = await showConfirmModal(`Are you sure you want to delete ${name}? This action cannot be undone.`, 'Delete Student', 'Delete', 'destructive');
        if (!confirmed) {
            return;
        }

        try {
            // Delete dependent rows first to support databases that were migrated
            // without CASCADE constraints on older tables.
            const { error: eligibilityDeleteError } = await supabaseAdmin
                .from('election_eligible_students')
                .delete()
                .eq('student_id', id);
            if (eligibilityDeleteError && !isPermissionDeniedError(eligibilityDeleteError)) {
                throw eligibilityDeleteError;
            }

            const { error: votesDeleteError } = await supabaseAdmin
                .from('votes')
                .delete()
                .eq('student_id', id);
            if (votesDeleteError && !isPermissionDeniedError(votesDeleteError)) {
                throw votesDeleteError;
            }

            const { error } = await supabaseAdmin
                .from('students')
                .delete()
                .eq('id', id);

            if (error) {
                if (isPermissionDeniedError(error)) {
                    throw new Error('Delete blocked by database policy. Run security-hardening.sql and ensure your admin account exists in the admins table.');
                }
                throw error;
            }

            showToast('Student deleted successfully!', 'success');
            loadStudents();
        } catch (error) {
            console.error('Error deleting student:', error);
            showAlertModal('Error deleting student: ' + error.message, 'Error');
        }
    };

    if (studentsList) {
        studentsList.addEventListener('click', (event) => {
            const editBtn = event.target.closest('.student-edit-btn');
            if (editBtn) {
                const id = editBtn.dataset.id;
                const name = decodeURIComponent(editBtn.dataset.name || '');
                const studentId = decodeURIComponent(editBtn.dataset.studentId || '');
                const email = decodeURIComponent(editBtn.dataset.email || '');
                const department = decodeURIComponent(editBtn.dataset.department || '');
                window.openEditStudent(id, name, studentId, email, department);
                return;
            }

            const deleteBtn = event.target.closest('.student-delete-btn');
            if (deleteBtn) {
                const id = deleteBtn.dataset.id;
                const name = decodeURIComponent(deleteBtn.dataset.name || '');
                window.deleteStudent(id, name);
            }
        });
    }

    // Excel Import Functionality
    function setupExcelImport() {
        // Only initialize on the students page.
        if (!window.location.pathname.includes('students.html')) {
            return;
        }

        const importBtn = document.getElementById('import-excel-btn');
        const excelInput = document.getElementById('excel-import-input');

        if (!importBtn || !excelInput) {
            console.warn('Excel import controls not found on students page.');
            return;
        }

        // Remove any existing listeners to prevent duplicates
        const newImportBtn = importBtn.cloneNode(true);
        importBtn.parentNode.replaceChild(newImportBtn, importBtn);
        
        const newExcelInput = excelInput.cloneNode(true);
        excelInput.parentNode.replaceChild(newExcelInput, excelInput);

        // Attach fresh listeners
        newImportBtn.addEventListener('click', () => {
            newExcelInput.click();
        });

        newExcelInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const fileName = (file.name || '').toLowerCase();

            // CSV import works fully offline and is recommended with the provided template.
            if (fileName.endsWith('.csv')) {
                processCsvFile(file);
            } else if (!window.XLSX) {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.min.js';
                script.onload = () => {
                    processExcelFile(file);
                };
                script.onerror = () => {
                    showAlertModal('Could not load Excel library. Please use the CSV template (Download Template) and import the CSV file, or retry with internet enabled.', 'Import Error');
                    console.error('Failed to load SheetJS');
                };
                document.head.appendChild(script);
            } else {
                processExcelFile(file);
            }

            // Reset input
            newExcelInput.value = '';
        });
    }

    // Call setup function when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupExcelImport);
    } else {
        setupExcelImport();
    }

    async function processExcelFile(file) {
        try {
            console.log('Processing Excel file:', file.name);
            
            if (!window.XLSX) {
                showAlertModal('Excel library is still loading. Please try again.', 'Import Error');
                return;
            }

            const reader = new FileReader();
            
            reader.onerror = () => {
                console.error('FileReader error');
                showAlertModal('Error reading file', 'Import Error');
            };

            reader.onload = async (e) => {
                try {
                    console.log('File read, processing...');
                    const data = e.target.result;
                    
                    let workbook;
                    let sheet;
                    let jsonData;

                    try {
                        workbook = window.XLSX.read(data, { type: 'array' });
                        sheet = workbook.Sheets[workbook.SheetNames[0]];
                        jsonData = window.XLSX.utils.sheet_to_json(sheet);
                        console.log('Excel data parsed:', jsonData.length, 'rows');
                    } catch (parseError) {
                        console.error('Error parsing Excel:', parseError);
                        showAlertModal('Error parsing Excel file. Make sure it\'s a valid Excel or CSV file.', 'Import Error');
                        return;
                    }

                    if (!jsonData || jsonData.length === 0) {
                        showAlertModal('No data found in the Excel file', 'Import Error');
                        return;
                    }

                    console.log('First row headers:', Object.keys(jsonData[0]));

                    // Map Excel columns to database fields (case-insensitive)
                    const mappedData = jsonData.map(row => {
                        const mappedRow = {};
                        Object.keys(row).forEach(key => {
                            const lowerKey = key.toLowerCase().replace(/\s+/g, '');
                            if (lowerKey.includes('name')) mappedRow.name = row[key];
                            if (lowerKey.includes('email')) mappedRow.email = row[key];
                            if (lowerKey.includes('studentid') || lowerKey.includes('id')) mappedRow.student_id = row[key];
                            if (lowerKey.includes('department')) mappedRow.department = row[key];
                        });
                        return mappedRow;
                    }).filter(row => row.name && row.email && row.student_id);

                    console.log('Mapped students:', mappedData.length);

                    if (mappedData.length === 0) {
                        showAlertModal('No valid data found in Excel file.\n\nRequired columns: name, email, student_id\n\nMake sure your Excel file has these columns.', 'Import Error');
                        return;
                    }

                    // Show confirmation
                    const confirmed = await showConfirmModal(`Import ${mappedData.length} students?\n\nThis will add new records to the database.`, 'Confirm Import', 'Import', 'primary');
                    if (!confirmed) return;

                    // Import students
                    let successCount = 0;
                    let errorCount = 0;
                    const errors = [];

                    for (const student of mappedData) {
                        try {
                            const cleanName = (student.name || '').toString().trim();
                            const cleanEmail = (student.email || '').toString().trim();
                            const cleanId = (student.student_id || '').toString().trim();
                            const cleanDept = (student.department || '').toString().trim();

                            if (!cleanName || !cleanEmail || !cleanId) {
                                errors.push(`Row skipped: missing required data`);
                                errorCount++;
                                continue;
                            }

                            // Add to the students table
                            const { error } = await supabaseAdmin
                                .from('students')
                                .insert([{
                                    name: cleanName,
                                    student_id: cleanId,
                                    email: cleanEmail,
                                    department: cleanDept,
                                    has_voted: false
                                }]);

                            if (error) {
                                console.error('Error importing:', cleanName, error);
                                errors.push(`${cleanName}: ${error.message}`);
                                errorCount++;
                            } else {
                                console.log('Imported:', cleanName);
                                successCount++;
                            }
                        } catch (error) {
                            console.error('Error importing student:', error);
                            errors.push(`Error: ${error.message}`);
                            errorCount++;
                        }
                    }

                    let message = `Import complete!\n✓ Successfully imported: ${successCount} students\n✗ Failed: ${errorCount} students`;
                    if (errors.length > 0 && errors.length <= 5) {
                        message += `\n\nFirst errors:\n${errors.slice(0, 5).join('\n')}`;
                    }
                    showAlertModal(message, 'Import Result');
                    loadStudents();
                } catch (error) {
                    console.error('Error in reader.onload:', error);
                    showAlertModal('Error processing file: ' + error.message, 'Import Error');
                }
            };

            reader.readAsArrayBuffer(file);
        } catch (error) {
            console.error('Error in processExcelFile:', error);
            showAlertModal('Error: ' + error.message, 'Import Error');
        }
    }

    async function processCsvFile(file) {
        try {
            const text = await file.text();
            const rows = parseCsv(text);
            if (rows.length === 0) {
                showAlertModal('No data found in the CSV file.', 'Import Error');
                return;
            }

            const mappedData = rows.filter(row => row.name && row.email && row.student_id);
            if (mappedData.length === 0) {
                showAlertModal('No valid data found in CSV. Required columns: name, email, student_id', 'Import Error');
                return;
            }

            const confirmed = await showConfirmModal(`Import ${mappedData.length} students?\n\nThis will add new records to the database.`, 'Confirm Import', 'Import', 'primary');
            if (!confirmed) return;

            let successCount = 0;
            let errorCount = 0;
            const errors = [];

            for (const student of mappedData) {
                const cleanName = (student.name || '').toString().trim();
                const cleanEmail = (student.email || '').toString().trim();
                const cleanId = (student.student_id || '').toString().trim();
                const cleanDept = (student.department || '').toString().trim();

                try {
                    const { error } = await supabaseAdmin
                        .from('students')
                        .insert([{
                            name: cleanName,
                            student_id: cleanId,
                            email: cleanEmail,
                            department: cleanDept,
                            has_voted: false
                        }]);

                    if (error) {
                        errors.push(`${cleanName || cleanId}: ${error.message}`);
                        errorCount++;
                    } else {
                        successCount++;
                    }
                } catch (error) {
                    errors.push(`${cleanName || cleanId}: ${error.message}`);
                    errorCount++;
                }
            }

            let message = `Import complete!\n✓ Successfully imported: ${successCount} students\n✗ Failed: ${errorCount} students`;
            if (errors.length > 0 && errors.length <= 5) {
                message += `\n\nFirst errors:\n${errors.slice(0, 5).join('\n')}`;
            }
            showAlertModal(message, 'Import Result');
            loadStudents();
        } catch (error) {
            console.error('CSV import error:', error);
            showAlertModal('Error importing CSV: ' + error.message, 'Import Error');
        }
    }

    function parseCsv(csvText) {
        const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length < 2) return [];

        const headers = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
        const out = [];

        for (let i = 1; i < lines.length; i++) {
            const cols = splitCsvLine(lines[i]);
            const row = {};
            headers.forEach((h, idx) => {
                const value = (cols[idx] || '').trim();
                row[h] = value;
            });

            out.push({
                name: row.name || row.full_name || row.fullname || '',
                email: row.email || '',
                student_id: row.student_id || row.studentid || row.id || '',
                password: row.password || '',
                department: row.department || ''
            });
        }

        return out;
    }

    function splitCsvLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }

        result.push(current);
        return result;
    }

    // Manage Positions
    const addPositionForm = document.getElementById('add-position-form');
    if(addPositionForm) {
        addPositionForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const positionName = document.getElementById('position-name').value;
            try {
                const { data, error } = await supabaseAdmin
                    .from('positions')
                    .insert([{
                        position_name: positionName,
                        max_vote: 1
                    }])
                    .select();

                if (error) throw error;

                showToast('Position added successfully!', 'success');
                addPositionForm.reset();
                loadPositions();
            } catch (error) {
                console.error('Error adding position:', error);
                showAlertModal('Error adding position: ' + error.message, 'Error');
            }
        });
        loadPositions();
    }

    async function loadPositions() {
        try {
            const { data, error } = await supabaseAdmin
                .from('positions')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            const list = document.getElementById('positions-list');
            if (list) {
                list.innerHTML = data.map(p => {
                    return `
                        <tr>
                            <td>${p.position_name}</td>
                            <td>${p.max_vote}</td>
                            <td>
                                <button onclick="window.location.href='edit-position.html?id=${encodeURIComponent(p.id)}'">Edit</button>
                                <button onclick="window.deletePosition('${p.id}', '${(p.position_name || '').replace(/'/g, "\\'")}')" class="btn-danger">Delete</button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
            const select = document.getElementById('position');
            if (select) {
                select.innerHTML = data.map(p => `<option value="${p.id}">${p.position_name}</option>`).join('');
            }
        } catch (error) {
            console.error('Error loading positions:', error);
        }
    }

    if (window.location.pathname.includes('edit-position.html')) {
        setupEditPositionPage();
    }

    async function setupEditPositionPage() {
        const form = document.getElementById('edit-position-form');
        const idInput = document.getElementById('edit-position-id');
        const nameInput = document.getElementById('edit-position-name');
        const maxVoteInput = document.getElementById('edit-max-vote');

        if (!form || !idInput || !nameInput || !maxVoteInput) {
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const positionId = params.get('id');

        if (!positionId) {
            showAlertModal('Position ID is missing.', 'Error');
            window.location.href = 'positions.html';
            return;
        }

        idInput.value = positionId;

        try {
            const { data, error } = await supabaseAdmin
                .from('positions')
                .select('*')
                .eq('id', positionId)
                .single();

            if (error) throw error;

            nameInput.value = data.position_name || '';
            maxVoteInput.value = data.max_vote || 1;
        } catch (error) {
            console.error('Error loading position:', error);
            showAlertModal('Could not load position details: ' + error.message, 'Error');
            window.location.href = 'positions.html';
            return;
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const updatedName = nameInput.value.trim();
            const updatedMaxVote = parseInt(maxVoteInput.value, 10);

            if (!updatedName) {
                showAlertModal('Position name is required.', 'Validation');
                return;
            }

            if (!updatedMaxVote || updatedMaxVote < 1) {
                showAlertModal('Max vote must be at least 1.', 'Validation');
                return;
            }

            try {
                const { error } = await supabaseAdmin
                    .from('positions')
                    .update({
                        position_name: updatedName,
                        max_vote: updatedMaxVote
                    })
                    .eq('id', idInput.value);

                if (error) throw error;

                showToast('Position updated successfully!', 'success');
                window.location.href = 'positions.html';
            } catch (error) {
                console.error('Error updating position:', error);
                showAlertModal('Error updating position: ' + error.message, 'Error');
            }
        });
    }

    window.deletePosition = async function(id, positionName) {
        const confirmed = await showConfirmModal(`Are you sure you want to delete ${positionName}? This will also affect candidates for this position.`, 'Delete Position', 'Delete', 'destructive');
        if (!confirmed) {
            return;
        }

        try {
            const { error } = await supabaseAdmin
                .from('positions')
                .delete()
                .eq('id', id);

            if (error) throw error;

            showToast('Position deleted successfully!', 'success');
            loadPositions();
        } catch (error) {
            console.error('Error deleting position:', error);
            showAlertModal('Error deleting position: ' + error.message, 'Error');
        }
    };

    // Manage Candidates
    const addCandidateForm = document.getElementById('add-candidate-form');
    if (addCandidateForm) {
        loadPositions(); // For the dropdown

        const candidatePhotoInput = document.getElementById('photo-file');
        const candidatePhotoPreview = document.getElementById('candidate-photo-preview');
        if (candidatePhotoInput && candidatePhotoPreview) {
            candidatePhotoInput.addEventListener('change', () => {
                const file = candidatePhotoInput.files && candidatePhotoInput.files[0];
                if (!file) {
                    candidatePhotoPreview.style.display = 'none';
                    candidatePhotoPreview.removeAttribute('src');
                    return;
                }

                const objectUrl = URL.createObjectURL(file);
                candidatePhotoPreview.src = objectUrl;
                candidatePhotoPreview.style.display = 'block';
            });
        }

        addCandidateForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('name').value;
            const positionId = document.getElementById('position').value;
            const photoFileInput = document.getElementById('photo-file');
            const description = document.getElementById('description').value;

            try {
                const uploadedPhotoUrl = await uploadCandidatePhoto(photoFileInput?.files?.[0]);

                const { data, error } = await supabaseAdmin
                    .from('candidates')
                    .insert([{
                        name: name,
                        position_id: positionId,
                        photo: uploadedPhotoUrl,
                        description: description
                    }])
                    .select();

                if (error) throw error;

                showToast('Candidate added successfully!', 'success');
                addCandidateForm.reset();
                if (candidatePhotoPreview) {
                    candidatePhotoPreview.style.display = 'none';
                    candidatePhotoPreview.removeAttribute('src');
                }
                loadCandidates();
            } catch (error) {
                console.error('Error adding candidate:', error);
                showAlertModal('Error adding candidate: ' + error.message, 'Error');
            }
        });
        loadCandidates();
    }

    async function loadCandidates() {
        try {
            // Use join to get position names
            const { data, error } = await supabaseAdmin
                .from('candidates')
                .select(`
                    id,
                    name,
                    photo,
                    description,
                    position_id,
                    created_at,
                    positions!fk_position (
                        id,
                        position_name
                    )
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const list = document.getElementById('candidates-list');
            if (list) {
                list.innerHTML = data.map(c => {
                    const positionName = c.positions?.position_name || 'Unknown Position';
                    const photoDisplay = c.photo ? `<img src="${c.photo}" alt="${c.name}" width="50" style="width: 50px; height: 50px; object-fit: cover; border-radius: 8px;">` : 'No photo';
                    const desc = c.description || '-';
                    return `
                        <tr>
                            <td>${c.name}</td>
                            <td>${positionName}</td>
                            <td>${photoDisplay}</td>
                            <td>${desc.substring(0, 50)}${desc.length > 50 ? '...' : ''}</td>
                            <td>
                                <button onclick="window.location.href='edit-candidate.html?id=${encodeURIComponent(c.id)}'">Edit</button>
                                <button onclick="window.deleteCandidate('${c.id}', '${(c.name || '').replace(/'/g, "\\'")}')" class="btn-danger">Delete</button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        } catch (error) {
            console.error('Error loading candidates:', error);
        }
    }

    if (window.location.pathname.includes('edit-candidate.html')) {
        setupEditCandidatePage();
    }

    window.deleteCandidate = async function(id, name) {
        const confirmed = await showConfirmModal(`Are you sure you want to delete ${name}? This action cannot be undone.`, 'Delete Candidate', 'Delete', 'destructive');
        if (!confirmed) {
            return;
        }

        try {
            const { error } = await supabaseAdmin
                .from('candidates')
                .delete()
                .eq('id', id);

            if (error) throw error;

            showToast('Candidate deleted successfully!', 'success');
            loadCandidates();
        } catch (error) {
            console.error('Error deleting candidate:', error);
            showAlertModal('Error deleting candidate: ' + error.message, 'Error');
        }
    };

    async function setupEditCandidatePage() {
        const form = document.getElementById('edit-candidate-form');
        const idInput = document.getElementById('edit-candidate-id');
        const nameInput = document.getElementById('edit-candidate-name');
        const positionInput = document.getElementById('edit-position');
        const photoInput = document.getElementById('edit-photo-file');
        const descriptionInput = document.getElementById('edit-description');
        const existingPhotoInput = document.getElementById('existing-photo-url');
        const preview = document.getElementById('edit-candidate-photo-preview');
        const noPhotoText = document.getElementById('no-photo-text');

        if (!form || !idInput || !nameInput || !positionInput || !descriptionInput) {
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const candidateId = params.get('id');

        if (!candidateId) {
            showAlertModal('Candidate ID is missing.', 'Error');
            window.location.href = 'candidates.html';
            return;
        }

        try {
            const { data: positions, error: positionsError } = await supabaseAdmin
                .from('positions')
                .select('*')
                .order('position_name', { ascending: true });

            if (positionsError) throw positionsError;
            positionInput.innerHTML = positions.map(p => `<option value="${p.id}">${p.position_name}</option>`).join('');

            const { data: candidate, error: candidateError } = await supabaseAdmin
                .from('candidates')
                .select('*')
                .eq('id', candidateId)
                .single();

            if (candidateError) throw candidateError;

            idInput.value = candidate.id;
            nameInput.value = candidate.name || '';
            positionInput.value = candidate.position_id || '';
            descriptionInput.value = candidate.description || '';
            existingPhotoInput.value = candidate.photo || '';

            if (candidate.photo && preview) {
                preview.src = candidate.photo;
                preview.style.display = 'block';
                if (noPhotoText) noPhotoText.style.display = 'none';
            }

            if (photoInput) {
                photoInput.addEventListener('change', () => {
                    const file = photoInput.files && photoInput.files[0];
                    if (!file) return;
                    const objectUrl = URL.createObjectURL(file);
                    if (preview) {
                        preview.src = objectUrl;
                        preview.style.display = 'block';
                    }
                    if (noPhotoText) noPhotoText.style.display = 'none';
                });
            }
        } catch (error) {
            console.error('Error loading candidate for edit:', error);
            showAlertModal('Could not load candidate details: ' + error.message, 'Error');
            window.location.href = 'candidates.html';
            return;
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            try {
                let finalPhotoUrl = existingPhotoInput.value || '';
                const newPhotoFile = photoInput?.files?.[0];

                if (newPhotoFile) {
                    finalPhotoUrl = await uploadCandidatePhoto(newPhotoFile);
                }

                const { error } = await supabaseAdmin
                    .from('candidates')
                    .update({
                        name: nameInput.value.trim(),
                        position_id: positionInput.value,
                        photo: finalPhotoUrl,
                        description: descriptionInput.value
                    })
                    .eq('id', idInput.value);

                if (error) throw error;

                showToast('Candidate updated successfully!', 'success');
                window.location.href = 'candidates.html';
            } catch (error) {
                console.error('Error updating candidate:', error);
                showAlertModal('Error updating candidate: ' + error.message, 'Error');
            }
        });
    }

    let candidatePhotoStorageMode = null;

    async function ensureCandidatePhotoBucket() {
        if (candidatePhotoStorageMode === 'bucket') {
            return true;
        }

        try {
            const { data: buckets, error } = await supabaseAdmin.storage.listBuckets();
            if (error) throw error;

            const exists = Array.isArray(buckets) && buckets.some(bucket => bucket.name === 'candidate-photos');
            if (exists) {
                candidatePhotoStorageMode = 'bucket';
                return true;
            }

            const { error: createError } = await supabaseAdmin.storage.createBucket('candidate-photos', {
                public: true,
                allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'],
                fileSizeLimit: 5 * 1024 * 1024
            });

            if (createError) {
                throw createError;
            }

            console.info('Created storage bucket "candidate-photos" for candidate uploads.');
            candidatePhotoStorageMode = 'bucket';
            return true;
        } catch (error) {
            candidatePhotoStorageMode = 'dataurl';
            console.info('Storage bucket unavailable. Using local image fallback.');
            return false;
        }
    }

    async function uploadCandidatePhoto(file) {
        if (!file) return '';

        const useBucket = await ensureCandidatePhotoBucket();
        if (!useBucket) {
            return await fileToDataUrl(file);
        }

        const fileExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const safeExt = fileExt.replace(/[^a-z0-9]/g, '') || 'jpg';
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExt}`;
        const filePath = `candidates/${fileName}`;

        const { error: uploadError } = await supabaseAdmin.storage
            .from('candidate-photos')
            .upload(filePath, file, { upsert: false, contentType: file.type || 'image/jpeg' });

        if (uploadError) {
            if ((uploadError.message || '').toLowerCase().includes('bucket not found')) {
                candidatePhotoStorageMode = 'dataurl';
            }
            console.info('Storage upload unavailable. Using local image fallback.');
            return await fileToDataUrl(file);
        }

        const { data: publicUrlData } = supabaseAdmin.storage
            .from('candidate-photos')
            .getPublicUrl(filePath);

        return publicUrlData?.publicUrl || '';
    }

    async function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read image file.'));
            reader.readAsDataURL(file);
        });
    }
    
    // Election Control and Results (multi-election)
    let selectedElectionId = null;
    let selectedElectionStatus = null;
    let selectedElectionLocks = { candidatesLocked: false, eligibilityLocked: false };

    async function loadSelectedElectionLocks() {
        selectedElectionLocks = { candidatesLocked: false, eligibilityLocked: false };

        if (!selectedElectionId || isLegacyElectionId(selectedElectionId)) {
            return;
        }

        try {
            const { data: logs, error } = await supabaseAdmin
                .from('admin_audit_logs')
                .select('action')
                .eq('target_type', 'election')
                .eq('target_id', selectedElectionId)
                .in('action', ['lock_election_candidates', 'lock_election_eligibility']);

            if (error) throw error;

            selectedElectionLocks.candidatesLocked = (logs || []).some(l => l.action === 'lock_election_candidates');
            selectedElectionLocks.eligibilityLocked = (logs || []).some(l => l.action === 'lock_election_eligibility');
        } catch (error) {
            console.warn('Could not load election lock state:', error.message);
        }
    }

    function syncElectionActiveToggle() {
        const toggle = document.getElementById('election-active-toggle');
        const label = document.getElementById('election-active-label');
        if (!toggle || !label) return;

        const isLegacy = isLegacyElectionId(selectedElectionId);
        const isActive = selectedElectionStatus === 'active';

        toggle.checked = isActive;
        toggle.disabled = !selectedElectionId || isLegacy;
        label.textContent = isActive ? 'Active' : 'Inactive';
        label.style.color = isActive ? '#166534' : '';
    }

    if (isElectionControlPage()) {
        setupElectionControlPage();
    }

    if (window.location.pathname.includes('results.html')) {
        setupResultsPage();
    }

    if (window.location.pathname.includes('admin-tools.html')) {
        setupAdminToolsPage();
    }

    function isElectionControlPage() {
        return /\/admin\/election(?:-[a-z-]+)?\.html$/i.test(window.location.pathname);
    }

    function setupAdminToolsNav() {
        const nav = document.querySelector('.sidebar-nav ul');
        if (!nav) return;

        const existing = nav.querySelector('a[href="admin-tools.html"]');
        if (existing) return;

        const resultsLi = Array.from(nav.querySelectorAll('li')).find(li => {
            const a = li.querySelector('a');
            return a && /(^|\/)results\.html$/i.test(a.getAttribute('href') || '');
        });
        if (!resultsLi) return;

        const current = (window.location.pathname.split('/').pop() || '').toLowerCase();
        const li = document.createElement('li');
        li.innerHTML = `<a href="admin-tools.html" class="${current === 'admin-tools.html' ? 'active' : ''}"><i class="nav-icon fas fa-screwdriver-wrench"></i><span class="nav-text">Admin Tools</span></a>`;
        resultsLi.insertAdjacentElement('afterend', li);
    }

    function setupElectionControlDropdown() {
        const nav = document.querySelector('.sidebar-nav ul');
        if (!nav) return;

        const electionLink = Array.from(nav.querySelectorAll('a')).find(a => /(^|\/)election\.html$/i.test(a.getAttribute('href') || ''));
        if (!electionLink) return;

        const electionItem = electionLink.closest('li');
        if (!electionItem) return;

        // Avoid rebuilding when already initialized.
        if (electionItem.querySelector('.nav-parent-toggle')) return;

        const path = (window.location.pathname.split('/').pop() || '').toLowerCase();
        const electionPages = [
            { href: 'election-create.html', label: 'Create Election' },
            { href: 'election-candidates.html', label: 'Candidates' },
            { href: 'election-eligibility.html', label: 'Eligibility' },
            { href: 'election-history.html', label: 'History' }
        ];

        const activeElectionPage = electionPages.some(page => page.href === path);
        const activeSub = electionPages.find(page => page.href === path);

        electionItem.classList.add('nav-group');
        electionItem.innerHTML = `
            <button type="button" class="nav-parent-toggle${activeElectionPage ? ' active' : ''}" aria-expanded="${activeElectionPage ? 'true' : 'false'}">
                <span class="nav-parent-main">
                    <i class="nav-icon fas fa-cogs"></i>
                    <span class="nav-text">Election Control</span>
                </span>
                <i class="fas fa-chevron-down nav-chevron"></i>
            </button>
            <ul class="nav-submenu ${activeElectionPage ? 'open' : ''}">
                ${electionPages.map(page => `<li><a href="${page.href}" class="${activeSub?.href === page.href ? 'active' : ''}">${page.label}</a></li>`).join('')}
            </ul>
        `;

        const toggle = electionItem.querySelector('.nav-parent-toggle');
        const submenu = electionItem.querySelector('.nav-submenu');
        if (toggle && submenu) {
            toggle.addEventListener('click', (event) => {
                event.preventDefault();
                const isOpen = submenu.classList.toggle('open');
                toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            });
        }
    }

    function setupGlobalAccessibility() {
        const sidebar = document.getElementById('sidebar');
        const mobileToggle = document.querySelector('.mobile-toggle');
        const overlay = document.querySelector('.sidebar-overlay');
        const syncExpandedState = () => {
            if (mobileToggle) {
                mobileToggle.setAttribute('aria-expanded', sidebar?.classList.contains('open') ? 'true' : 'false');
            }
        };

        if (mobileToggle) {
            mobileToggle.setAttribute('aria-label', mobileToggle.getAttribute('aria-label') || 'Open admin navigation');
            mobileToggle.setAttribute('aria-controls', 'sidebar');
            syncExpandedState();
        }

        if (overlay) {
            overlay.setAttribute('tabindex', overlay.getAttribute('tabindex') || '0');
            overlay.setAttribute('role', 'button');
            overlay.setAttribute('aria-label', overlay.getAttribute('aria-label') || 'Close navigation');
            overlay.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    if (typeof window.closeSidebar === 'function') {
                        window.closeSidebar();
                    } else {
                        sidebar?.classList.remove('open');
                        overlay.classList.remove('active');
                    }
                    syncExpandedState();
                }
            });
        }

        if (typeof window.toggleSidebar === 'function') {
            const originalToggleSidebar = window.toggleSidebar;
            window.toggleSidebar = function(...args) {
                const result = originalToggleSidebar.apply(this, args);
                syncExpandedState();
                return result;
            };
        }

        if (typeof window.closeSidebar === 'function') {
            const originalCloseSidebar = window.closeSidebar;
            window.closeSidebar = function(...args) {
                const result = originalCloseSidebar.apply(this, args);
                syncExpandedState();
                return result;
            };
        }
    }

    async function getAllElections() {
        try {
            const { data, error } = await supabaseAdmin
                .from('elections')
                .select('*')
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data || []).map(e => ({ ...e, isLegacy: false }));
        } catch (error) {
            console.warn('Falling back to legacy election_settings:', error.message);
            const { data: legacy, error: legacyError } = await supabaseAdmin
                .from('election_settings')
                .select('*')
                .order('id', { ascending: false });
            if (legacyError) throw legacyError;

            return (legacy || []).map(row => ({
                id: `legacy-${row.id}`,
                name: row.election_name,
                start_time: row.start_time,
                end_time: row.end_time,
                status: row.status === 1 ? 'active' : row.status === 2 ? 'ended' : 'draft',
                isLegacy: true,
                legacyId: row.id
            }));
        }
    }

    function isLegacyElectionId(electionId) {
        return typeof electionId === 'string' && electionId.startsWith('legacy-');
    }

    function parseLegacyElectionId(electionId) {
        return Number(String(electionId).replace('legacy-', ''));
    }

    async function getActiveElection() {
        try {
            const { data, error } = await supabaseAdmin
                .from('elections')
                .select('*')
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (error) throw error;
            return data || null;
        } catch (error) {
            console.warn('Active election lookup failed, falling back to old settings table.');
            const { data } = await supabaseAdmin
                .from('election_settings')
                .select('*')
                .eq('status', 1)
                .order('id', { ascending: false })
                .limit(1)
                .maybeSingle();
            return data || null;
        }
    }

    async function setupElectionControlPage() {
        const createForm = document.getElementById('create-election-form');
        const electionSelect = document.getElementById('election-select');
        const startBtn = document.getElementById('start-election');
        const stopBtn = document.getElementById('stop-election');
        const saveScheduleBtn = document.getElementById('save-election-schedule');
        const saveEligibilityBtn = document.getElementById('save-eligibility');
        const saveCandidatesBtn = document.getElementById('save-election-candidates');
        const selectAllCandidatesBtn = document.getElementById('select-all-candidates');
        const clearAllCandidatesBtn = document.getElementById('clear-all-candidates');
        const deleteElectionBtn = document.getElementById('delete-selected-election');
        const exportElectionCsvBtn = document.getElementById('export-election-csv');
        const selectAllBtn = document.getElementById('select-all-eligible');
        const clearAllBtn = document.getElementById('clear-all-eligible');
        const activeToggle = document.getElementById('election-active-toggle');
        const allElectionsList = document.getElementById('all-elections-list');

        if (!electionSelect) return;

        if (createForm) {
            createForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const name = document.getElementById('new-election-name').value.trim();
                const start = document.getElementById('new-election-start').value || null;
                const end = document.getElementById('new-election-end').value || null;

                try {
                    let { error } = await supabaseAdmin
                        .from('elections')
                        .insert([{ name, start_time: start, end_time: end, status: 'draft' }]);

                    // Backward-compatible fallback when new table is unavailable.
                    if (error) {
                        const fallback = await supabaseAdmin
                            .from('election_settings')
                            .insert([{ election_name: name, start_time: start, end_time: end, status: 0 }]);
                        error = fallback.error;
                    }

                    if (error) throw error;
                    createForm.reset();
                    showToast('Election created successfully.', 'success');
                    await populateElectionSelect('election-select');
                    await onElectionSelected();
                    await loadAllElectionsTable();
                } catch (error) {
                    console.error('Error creating election:', error);
                    showAlertModal('Error creating election: ' + error.message + '\nRun migration SQL if elections table does not exist.', 'Error');
                }
            });
        }

        electionSelect.addEventListener('change', onElectionSelected);

        if (startBtn) {
            startBtn.addEventListener('click', async () => {
                if (!selectedElectionId) return;

                const readiness = await getElectionReadiness(selectedElectionId);
                if (!readiness.ready) {
                    showAlertModal(`Cannot start election yet:\n- ${readiness.issues.join('\n- ')}`, 'Readiness Check');
                    return;
                }

                const active = await getActiveElection();
                if (active && active.id !== selectedElectionId) {
                    const proceed = await showConfirmModal('Another election is active. Do you want to end it and start the selected election?', 'Start Election', 'End Current and Start', 'destructive');
                    if (!proceed) return;
                    await updateElectionStatus(active.id, 'ended');
                }
                await updateElectionStatus(selectedElectionId, 'active');
                await onElectionSelected();
                await loadAllElectionsTable();
            });
        }

        if (stopBtn) {
            stopBtn.addEventListener('click', async () => {
                if (!selectedElectionId) return;
                await updateElectionStatus(selectedElectionId, 'ended');
                await onElectionSelected();
                await loadAllElectionsTable();
            });
        }

        if (saveScheduleBtn) {
            saveScheduleBtn.addEventListener('click', saveElectionSchedule);
        }

        if (saveCandidatesBtn) {
            saveCandidatesBtn.addEventListener('click', saveElectionCandidates);
        }

        if (selectAllCandidatesBtn) {
            selectAllCandidatesBtn.addEventListener('click', () => {
                document.querySelectorAll('.election-candidate-checkbox').forEach(cb => { cb.checked = true; });
            });
        }

        if (clearAllCandidatesBtn) {
            clearAllCandidatesBtn.addEventListener('click', () => {
                document.querySelectorAll('.election-candidate-checkbox').forEach(cb => { cb.checked = false; });
            });
        }

        if (deleteElectionBtn) {
            deleteElectionBtn.addEventListener('click', deleteSelectedElection);
        }

        if (exportElectionCsvBtn) {
            exportElectionCsvBtn.addEventListener('click', exportSelectedElectionCsv);
        }

        if (allElectionsList) {
            allElectionsList.addEventListener('click', async (event) => {
                const btn = event.target.closest('.select-election-from-table');
                if (!btn) return;

                const electionId = btn.getAttribute('data-election-id');
                if (!electionId) return;

                selectedElectionId = electionId;
                const select = document.getElementById('election-select');
                if (select) {
                    select.value = electionId;
                }
                await onElectionSelected();
            });
        }

        document.addEventListener('click', async (event) => {
            const migrateBtn = event.target.closest('.migrate-legacy-election-btn');
            if (!migrateBtn) return;

            if (!selectedElectionId || !isLegacyElectionId(selectedElectionId)) {
                showAlertModal('Select a legacy election first.', 'Migration');
                return;
            }

            const confirmed = await showConfirmModal('Migrate this legacy election to the new multi-election tables now?', 'Migrate Election', 'Migrate', 'primary');
            if (!confirmed) return;

            await migrateLegacyElectionToMultiElection(selectedElectionId);
        });

        if (saveEligibilityBtn) {
            saveEligibilityBtn.addEventListener('click', saveElectionEligibility);
        }

        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => {
                document.querySelectorAll('.eligibility-checkbox').forEach(cb => { cb.checked = true; });
            });
        }

        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                document.querySelectorAll('.eligibility-checkbox').forEach(cb => { cb.checked = false; });
            });
        }

        if (activeToggle) {
            activeToggle.addEventListener('change', async () => {
                if (!selectedElectionId || isLegacyElectionId(selectedElectionId)) {
                    activeToggle.checked = false;
                    return;
                }

                if (activeToggle.checked) {
                    const readiness = await getElectionReadiness(selectedElectionId);
                    if (!readiness.ready) {
                        showAlertModal(`Cannot activate election yet:\n- ${readiness.issues.join('\n- ')}`, 'Readiness Check');
                        activeToggle.checked = false;
                        return;
                    }

                    const active = await getActiveElection();
                    if (active && active.id !== selectedElectionId) {
                        const proceed = await showConfirmModal('Another election is active. End it and activate the selected election?', 'Activate Election', 'End Current and Activate', 'destructive');
                        if (!proceed) {
                            activeToggle.checked = false;
                            return;
                        }
                        await updateElectionStatus(active.id, 'ended');
                    }

                    await updateElectionStatus(selectedElectionId, 'active');
                } else if (selectedElectionStatus === 'active') {
                    const proceed = await showConfirmModal('Set this election to inactive?', 'Deactivate Election', 'Set Inactive', 'secondary');
                    if (!proceed) {
                        activeToggle.checked = true;
                        return;
                    }
                    await updateElectionStatus(selectedElectionId, 'ended');
                }

                await onElectionSelected();
                await loadAllElectionsTable();
            });
        }

        await populateElectionSelect('election-select');
        await onElectionSelected();
        await loadAllElectionsTable();
    }

    async function populateElectionSelect(selectId) {
        const select = document.getElementById(selectId);
        if (!select) return;

        try {
            const elections = await getAllElections();
            if (!elections.length) {
                select.innerHTML = '<option value="">No elections yet</option>';
                selectedElectionId = null;
                return;
            }

            select.innerHTML = elections.map(e => `<option value="${e.id}">${e.name} (${e.status})</option>`).join('');

            const savedElectionId = localStorage.getItem('admin-selected-election-id');

            if (!selectedElectionId && savedElectionId && elections.some(e => e.id === savedElectionId)) {
                selectedElectionId = savedElectionId;
            }

            if (!selectedElectionId || !elections.some(e => e.id === selectedElectionId)) {
                selectedElectionId = elections[0].id;
            }
            select.value = selectedElectionId;
            localStorage.setItem('admin-selected-election-id', selectedElectionId);
        } catch (error) {
            console.error('Error loading elections:', error);
            select.innerHTML = '<option value="">No elections found</option>';
            selectedElectionId = null;
        }
    }

    async function onElectionSelected() {
        const select = document.getElementById('election-select');
        if (select) selectedElectionId = select.value || null;
        if (selectedElectionId) {
            localStorage.setItem('admin-selected-election-id', selectedElectionId);
        }
        if (!selectedElectionId) {
            clearSelectedElectionHistory();
            return;
        }

        try {
            let election;
            if (isLegacyElectionId(selectedElectionId)) {
                const legacyId = parseLegacyElectionId(selectedElectionId);
                const { data, error } = await supabaseAdmin
                    .from('election_settings')
                    .select('*')
                    .eq('id', legacyId)
                    .single();
                if (error) throw error;
                election = {
                    status: data.status === 1 ? 'active' : data.status === 2 ? 'ended' : 'draft',
                    start_time: data.start_time,
                    end_time: data.end_time
                };
            } else {
                const { data, error } = await supabaseAdmin
                    .from('elections')
                    .select('*')
                    .eq('id', selectedElectionId)
                    .single();
                if (error) throw error;
                election = data;
            }

            selectedElectionStatus = election.status || 'draft';
            const statusEl = document.getElementById('selected-election-status');
            if (statusEl) statusEl.innerHTML = getStatusBadgeHtml(selectedElectionStatus);
            document.getElementById('selected-election-start').textContent = election.start_time ? new Date(election.start_time).toLocaleString() : 'Not set';
            document.getElementById('selected-election-end').textContent = election.end_time ? new Date(election.end_time).toLocaleString() : 'Not set';

            const startInput = document.getElementById('edit-election-start');
            const endInput = document.getElementById('edit-election-end');
            if (startInput) startInput.value = toDateTimeLocalValue(election.start_time);
            if (endInput) endInput.value = toDateTimeLocalValue(election.end_time);
        } catch (error) {
            console.error('Error loading selected election:', error);
        }

        await loadSelectedElectionLocks();
        applyElectionEditLock(selectedElectionStatus);

        await loadElectionCandidates();
        await loadEligibilityStudents();
        await loadSelectedElectionHistory();
    }

    function clearSelectedElectionHistory() {
        selectedElectionStatus = null;
        selectedElectionLocks = { candidatesLocked: false, eligibilityLocked: false };
        applyElectionEditLock('draft');
        const fields = [
            ['history-eligible-count', '0'],
            ['history-voted-count', '0'],
            ['history-not-voted-count', '0'],
            ['history-turnout', '0%']
        ];
        fields.forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        });

        const winners = document.getElementById('history-winners-list');
        const candidateVotes = document.getElementById('history-candidate-votes-list');
        const activity = document.getElementById('history-vote-activity-list');

        if (winners) winners.innerHTML = '<tr><td colspan="3">Select an election.</td></tr>';
        if (candidateVotes) candidateVotes.innerHTML = '<tr><td colspan="4">Select an election.</td></tr>';
        if (activity) activity.innerHTML = '<tr><td colspan="5">Select an election.</td></tr>';
    }

    async function loadSelectedElectionHistory() {
        const winnersList = document.getElementById('history-winners-list');
        const candidateVotesList = document.getElementById('history-candidate-votes-list');
        const activityList = document.getElementById('history-vote-activity-list');

        if (!winnersList || !candidateVotesList || !activityList) {
            return;
        }

        if (!selectedElectionId) {
            clearSelectedElectionHistory();
            return;
        }

        if (isLegacyElectionId(selectedElectionId)) {
            winnersList.innerHTML = '<tr><td colspan="3">Detailed history is only available for multi-election tables.</td></tr>';
            candidateVotesList.innerHTML = '<tr><td colspan="4">Detailed history is only available for multi-election tables.</td></tr>';
            activityList.innerHTML = '<tr><td colspan="5">Detailed history is only available for multi-election tables.</td></tr>';
            return;
        }

        try {
            const [
                eligibleRes,
                votesRes,
                mappedCandidatesRes,
                candidatesRes,
                positionsRes
            ] = await Promise.all([
                supabaseAdmin
                    .from('election_eligible_students')
                    .select('student_id')
                    .eq('election_id', selectedElectionId),
                supabaseAdmin
                    .from('votes')
                    .select(`
                        id,
                        vote_time,
                        student_id,
                        candidate_id,
                        position_id,
                        students!fk_student (name,student_id),
                        candidates!fk_candidate (name),
                        positions!fk_position (position_name)
                    `)
                    .eq('election_id', selectedElectionId)
                    .order('vote_time', { ascending: false }),
                supabaseAdmin
                    .from('election_candidates')
                    .select('candidate_id')
                    .eq('election_id', selectedElectionId),
                supabaseAdmin
                    .from('candidates')
                    .select('id,name,position_id')
                    .order('name', { ascending: true }),
                supabaseAdmin
                    .from('positions')
                    .select('id,position_name')
            ]);

            if (eligibleRes.error) throw eligibleRes.error;
            if (votesRes.error) throw votesRes.error;
            if (mappedCandidatesRes.error) throw mappedCandidatesRes.error;
            if (candidatesRes.error) throw candidatesRes.error;
            if (positionsRes.error) throw positionsRes.error;

            const eligibleStudents = eligibleRes.data || [];
            const votes = votesRes.data || [];
            const mappedCandidateIds = new Set((mappedCandidatesRes.data || []).map(row => Number(row.candidate_id)));
            const allCandidates = candidatesRes.data || [];
            const positionsById = new Map((positionsRes.data || []).map(p => [Number(p.id), p.position_name]));

            const candidatePool = mappedCandidateIds.size
                ? allCandidates.filter(c => mappedCandidateIds.has(Number(c.id)))
                : allCandidates;

            const eligibleSet = new Set(eligibleStudents.map(row => row.student_id));
            const votedEligibleSet = new Set(
                votes
                    .filter(v => eligibleSet.has(v.student_id))
                    .map(v => v.student_id)
            );

            const eligibleCount = eligibleSet.size;
            const votedCount = votedEligibleSet.size;
            const notVotedCount = Math.max(eligibleCount - votedCount, 0);
            const turnout = eligibleCount ? ((votedCount / eligibleCount) * 100).toFixed(1) : '0.0';

            const eligibleCountEl = document.getElementById('history-eligible-count');
            const votedCountEl = document.getElementById('history-voted-count');
            const notVotedCountEl = document.getElementById('history-not-voted-count');
            const turnoutEl = document.getElementById('history-turnout');

            if (eligibleCountEl) eligibleCountEl.textContent = String(eligibleCount);
            if (votedCountEl) votedCountEl.textContent = String(votedCount);
            if (notVotedCountEl) notVotedCountEl.textContent = String(notVotedCount);
            if (turnoutEl) turnoutEl.textContent = `${turnout}%`;

            const voteCountsByCandidate = new Map();
            const voteCountsByPosition = {};

            votes.forEach(v => {
                const candidateId = Number(v.candidate_id);
                voteCountsByCandidate.set(candidateId, (voteCountsByCandidate.get(candidateId) || 0) + 1);

                const positionName = v.positions?.position_name || positionsById.get(Number(v.position_id)) || 'Unknown Position';
                const candidateName = v.candidates?.name || 'Unknown Candidate';
                if (!voteCountsByPosition[positionName]) voteCountsByPosition[positionName] = {};
                voteCountsByPosition[positionName][candidateName] = (voteCountsByPosition[positionName][candidateName] || 0) + 1;
            });

            const winnerRows = Object.keys(voteCountsByPosition).map(position => {
                const entries = Object.entries(voteCountsByPosition[position]).sort((a, b) => b[1] - a[1]);
                const [winnerName, winnerVotes] = entries[0] || ['-', 0];
                return `<tr><td>${position}</td><td>${winnerName}</td><td>${winnerVotes}</td></tr>`;
            });
            winnersList.innerHTML = winnerRows.length ? winnerRows.join('') : '<tr><td colspan="3">No winners yet.</td></tr>';

            const candidateRows = candidatePool.map(candidate => {
                const votesCount = voteCountsByCandidate.get(Number(candidate.id)) || 0;
                const status = votesCount > 0 ? 'Voted For' : 'Not Voted For';
                const positionName = positionsById.get(Number(candidate.position_id)) || 'Unknown Position';
                return `<tr><td>${candidate.name}</td><td>${positionName}</td><td>${votesCount}</td><td>${status}</td></tr>`;
            });
            candidateVotesList.innerHTML = candidateRows.length ? candidateRows.join('') : '<tr><td colspan="4">No candidates mapped to this election.</td></tr>';

            const activityRows = votes.map(v => {
                const when = v.vote_time ? new Date(v.vote_time).toLocaleString() : '-';
                const studentName = v.students?.name || '-';
                const sid = v.students?.student_id || '-';
                const position = v.positions?.position_name || positionsById.get(Number(v.position_id)) || '-';
                const candidate = v.candidates?.name || '-';
                return `<tr><td>${when}</td><td>${studentName}</td><td>${sid}</td><td>${position}</td><td>${candidate}</td></tr>`;
            });
            activityList.innerHTML = activityRows.length ? activityRows.join('') : '<tr><td colspan="5">No vote history yet for this election.</td></tr>';
        } catch (error) {
            console.error('Error loading selected election history:', error);
            winnersList.innerHTML = `<tr><td colspan="3">${error.message}</td></tr>`;
            candidateVotesList.innerHTML = `<tr><td colspan="4">${error.message}</td></tr>`;
            activityList.innerHTML = `<tr><td colspan="5">${error.message}</td></tr>`;
        }
    }

    async function exportSelectedElectionCsv() {
        if (!selectedElectionId || isLegacyElectionId(selectedElectionId)) {
            showToast('Select a migrated election to export CSV.', 'error');
            return;
        }

        try {
            const [{ data: election, error: electionError }, { data: votes, error: votesError }, { data: eligible, error: eligibleError }] = await Promise.all([
                supabaseAdmin.from('elections').select('id,name,status,start_time,end_time').eq('id', selectedElectionId).single(),
                supabaseAdmin.from('votes').select('vote_time, student_id, position_id, candidates!fk_candidate(name), positions!fk_position(position_name)').eq('election_id', selectedElectionId),
                supabaseAdmin.from('election_eligible_students').select('student_id').eq('election_id', selectedElectionId)
            ]);

            if (electionError) throw electionError;
            if (votesError) throw votesError;
            if (eligibleError) throw eligibleError;

            const eligibleSet = new Set((eligible || []).map(r => r.student_id));
            const votedSet = new Set((votes || []).map(r => r.student_id));

            const rows = [
                ['Election', election.name],
                ['Status', election.status],
                ['Start Time', election.start_time || ''],
                ['End Time', election.end_time || ''],
                ['Eligible Students', String(eligibleSet.size)],
                ['Students Voted', String([...eligibleSet].filter(id => votedSet.has(id)).length)],
                ['Total Votes', String((votes || []).length)],
                [],
                ['Vote Time', 'Position', 'Candidate', 'Student ID']
            ];

            (votes || []).forEach(v => {
                rows.push([
                    v.vote_time ? new Date(v.vote_time).toLocaleString() : '',
                    v.positions?.position_name || '-',
                    v.candidates?.name || '-',
                    v.student_id || '-'
                ]);
            });

            downloadCsv(`election-${selectedElectionId}-history.csv`, rows);
            await logAdminAction('export_election_csv', 'election', selectedElectionId);
            showToast('CSV exported successfully.', 'success');
        } catch (error) {
            console.error('Error exporting CSV:', error);
            showToast('Could not export CSV: ' + error.message, 'error');
        }
    }

    async function deleteSelectedElection() {
        if (!selectedElectionId) {
            showAlertModal('Select an election to delete.', 'Delete Election');
            return;
        }

        const electionSelect = document.getElementById('election-select');
        const selectedOption = electionSelect?.options?.[electionSelect.selectedIndex];
        const electionName = selectedOption ? selectedOption.textContent : 'this election';

        const confirmed = await showConfirmModal(`Delete ${electionName}? This will remove related mappings and election votes.`, 'Delete Election', 'Delete', 'destructive');
        if (!confirmed) return;

        try {
            let error;
            if (isLegacyElectionId(selectedElectionId)) {
                const legacyId = parseLegacyElectionId(selectedElectionId);
                const result = await supabaseAdmin
                    .from('election_settings')
                    .delete()
                    .eq('id', legacyId);
                error = result.error;
            } else {
                const result = await supabaseAdmin
                    .from('elections')
                    .delete()
                    .eq('id', selectedElectionId);
                error = result.error;
            }

            if (error) throw error;

            await logAdminAction('delete_election', 'election', selectedElectionId);
            showToast('Election deleted successfully.', 'success');
            selectedElectionId = null;
            await populateElectionSelect('election-select');
            await onElectionSelected();
            await loadAllElectionsTable();
        } catch (error) {
            console.error('Error deleting election:', error);
            showAlertModal('Error deleting election: ' + error.message, 'Error');
        }
    }

    async function migrateLegacyElectionToMultiElection(legacyElectionId) {
        try {
            const legacyId = parseLegacyElectionId(legacyElectionId);
            if (!legacyId) {
                throw new Error('Invalid legacy election id.');
            }

            const { data: legacyElection, error: legacyError } = await supabaseAdmin
                .from('election_settings')
                .select('*')
                .eq('id', legacyId)
                .single();

            if (legacyError) throw legacyError;
            if (!legacyElection) throw new Error('Legacy election not found.');

            const mappedStatus = legacyElection.status === 1 ? 'active' : legacyElection.status === 2 ? 'ended' : 'draft';
            const electionInsert = await supabaseAdmin
                .from('elections')
                .insert([{
                    name: legacyElection.election_name,
                    start_time: legacyElection.start_time,
                    end_time: legacyElection.end_time,
                    status: mappedStatus
                }])
                .select('id')
                .single();

            if (electionInsert.error) throw electionInsert.error;

            const newElectionId = electionInsert.data?.id;
            if (!newElectionId) throw new Error('Could not create migrated election record.');

            const [positionsRes, candidatesRes, studentsRes] = await Promise.all([
                supabaseAdmin.from('positions').select('id'),
                supabaseAdmin.from('candidates').select('id'),
                supabaseAdmin.from('students').select('id')
            ]);

            if (positionsRes.error) throw positionsRes.error;
            if (candidatesRes.error) throw candidatesRes.error;
            if (studentsRes.error) throw studentsRes.error;

            const positionRows = (positionsRes.data || []).map(p => ({ election_id: newElectionId, position_id: p.id }));
            const candidateRows = (candidatesRes.data || []).map(c => ({ election_id: newElectionId, candidate_id: c.id }));
            const studentRows = (studentsRes.data || []).map(s => ({ election_id: newElectionId, student_id: s.id }));

            const operations = [];
            if (positionRows.length) {
                operations.push(
                    supabaseAdmin
                        .from('election_positions')
                        .upsert(positionRows, { onConflict: 'election_id,position_id', ignoreDuplicates: true })
                );
            }

            if (candidateRows.length) {
                operations.push(
                    supabaseAdmin
                        .from('election_candidates')
                        .upsert(candidateRows, { onConflict: 'election_id,candidate_id', ignoreDuplicates: true })
                );
            }

            if (studentRows.length) {
                operations.push(
                    supabaseAdmin
                        .from('election_eligible_students')
                        .upsert(studentRows, { onConflict: 'election_id,student_id', ignoreDuplicates: true })
                );
            }

            const results = await Promise.all(operations);
            const failed = results.find(r => r.error);
            if (failed?.error) throw failed.error;

            selectedElectionId = newElectionId;
            localStorage.setItem('admin-selected-election-id', newElectionId);

            await populateElectionSelect('election-select');
            const select = document.getElementById('election-select');
            if (select) select.value = newElectionId;

            await onElectionSelected();
            await loadAllElectionsTable();

            await logAdminAction('migrate_legacy_election', 'election', newElectionId, { legacyElectionId: legacyId });
            showToast('Election migrated successfully.', 'success');
        } catch (error) {
            console.error('Error migrating legacy election:', error);
            showAlertModal('Could not migrate this election: ' + error.message + '\nRun fix-multi-election-permissions.sql in Supabase SQL Editor, then try again.', 'Migration Error');
        }
    }

    function toDateTimeLocalValue(dateTime) {
        if (!dateTime) return '';
        const d = new Date(dateTime);
        if (Number.isNaN(d.getTime())) return '';
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    async function loadAllElectionsTable() {
        const list = document.getElementById('all-elections-list');
        const summary = document.getElementById('active-elections-summary');
        if (!list || !summary) return;

        try {
            const elections = await getAllElections();
            const activeCount = elections.filter(e => e.status === 'active').length;
            summary.textContent = `Active elections: ${activeCount}`;

            if (!elections.length) {
                list.innerHTML = '<tr><td colspan="5">No elections found.</td></tr>';
                return;
            }

            list.innerHTML = elections.map(e => {
                const start = e.start_time ? new Date(e.start_time).toLocaleString() : 'Not set';
                const end = e.end_time ? new Date(e.end_time).toLocaleString() : 'Not set';
                return `<tr><td>${e.name}</td><td>${getStatusBadgeHtml(e.status)}</td><td>${start}</td><td>${end}</td><td><button type="button" class="select-election-from-table" data-election-id="${e.id}">Select</button></td></tr>`;
            }).join('');
        } catch (error) {
            list.innerHTML = `<tr><td colspan="5">${error.message}</td></tr>`;
            summary.textContent = 'Active elections: -';
        }
    }

    async function updateElectionStatus(electionId, status) {
        try {
            let error;
            if (isLegacyElectionId(electionId)) {
                const legacyId = parseLegacyElectionId(electionId);
                const legacyStatus = status === 'active' ? 1 : status === 'ended' ? 2 : 0;
                const result = await supabaseAdmin
                    .from('election_settings')
                    .update({ status: legacyStatus })
                    .eq('id', legacyId);
                error = result.error;
            } else {
                const result = await supabaseAdmin
                    .from('elections')
                    .update({ status })
                    .eq('id', electionId);
                error = result.error;
            }

            if (error) throw error;
            showToast(status === 'active' ? 'Election started.' : 'Election ended.', 'success');
            await populateElectionSelect('election-select');
        } catch (error) {
            console.error('Error updating election status:', error);
            showAlertModal('Error updating status: ' + error.message, 'Error');
        }
    }

    async function saveElectionSchedule() {
        if (!selectedElectionId) return;

        const start = document.getElementById('edit-election-start')?.value || null;
        const end = document.getElementById('edit-election-end')?.value || null;

        try {
            let error;
            if (isLegacyElectionId(selectedElectionId)) {
                const legacyId = parseLegacyElectionId(selectedElectionId);
                const result = await supabaseAdmin
                    .from('election_settings')
                    .update({ start_time: start, end_time: end })
                    .eq('id', legacyId);
                error = result.error;
            } else {
                const result = await supabaseAdmin
                    .from('elections')
                    .update({ start_time: start, end_time: end })
                    .eq('id', selectedElectionId);
                error = result.error;
            }

            if (error) throw error;
            showToast('Election schedule updated.', 'success');
            await onElectionSelected();
            await loadAllElectionsTable();
        } catch (error) {
            console.error('Error saving schedule:', error);
            showAlertModal('Error saving schedule: ' + error.message, 'Error');
        }
    }

    async function loadElectionCandidates() {
        const list = document.getElementById('election-candidates-list');
        if (!list || !selectedElectionId) return;

        if (isLegacyElectionId(selectedElectionId)) {
            list.innerHTML = '<tr><td colspan="4">Per-election candidate mapping requires multi-election tables. <button type="button" class="migrate-legacy-election-btn">Migrate This Election</button></td></tr>';
            return;
        }

        try {
            const [{ data: candidates, error: candidatesError }, { data: mappedRows, error: mappedError }] = await Promise.all([
                supabaseAdmin
                    .from('candidates')
                    .select(`
                        id,
                        name,
                        description,
                        position_id,
                        positions!fk_position (
                            id,
                            position_name
                        )
                    `)
                    .order('name', { ascending: true }),
                supabaseAdmin
                    .from('election_candidates')
                    .select('candidate_id')
                    .eq('election_id', selectedElectionId)
            ]);

            if (candidatesError) throw candidatesError;
            if (mappedError) throw mappedError;

            const selectedSet = new Set((mappedRows || []).map(r => String(r.candidate_id)));
            const rows = candidates || [];

            if (!rows.length) {
                list.innerHTML = '<tr><td colspan="4">No candidates found. Add candidates first.</td></tr>';
                applyElectionEditLock(selectedElectionStatus);
                return;
            }

            list.innerHTML = rows.map(c => {
                const positionName = c.positions?.position_name || 'Unknown Position';
                const desc = c.description || '-';
                const checked = selectedSet.has(String(c.id)) ? 'checked' : '';
                return `
                    <tr>
                        <td><input type="checkbox" class="election-candidate-checkbox" data-candidate-id="${c.id}" data-position-id="${c.position_id}" ${checked}></td>
                        <td>${c.name}</td>
                        <td>${positionName}</td>
                        <td>${desc.substring(0, 80)}${desc.length > 80 ? '...' : ''}</td>
                    </tr>
                `;
            }).join('');
            applyElectionEditLock(selectedElectionStatus);
        } catch (error) {
            console.error('Error loading election candidates:', error);
            list.innerHTML = `<tr><td colspan="4">${error.message}</td></tr>`;
        }
    }

    async function saveElectionCandidates() {
        if (!selectedElectionId) return;

        if (selectedElectionLocks.candidatesLocked) {
            showToast('Candidate mapping for this election is locked after save.', 'error');
            return;
        }

        if (selectedElectionStatus === 'active') {
            showToast('Cannot edit candidates while this election is active.', 'error');
            return;
        }

        if (isLegacyElectionId(selectedElectionId)) {
            showAlertModal('Per-election candidate mapping is unavailable for legacy elections. Run migration and use new elections table.', 'Migration Required');
            return;
        }

        const checked = Array.from(document.querySelectorAll('.election-candidate-checkbox:checked'));
        const candidateIds = checked.map(cb => Number(cb.getAttribute('data-candidate-id'))).filter(Number.isFinite);
        const positionIds = [...new Set(checked.map(cb => Number(cb.getAttribute('data-position-id'))).filter(Number.isFinite))];

        const confirmed = await showConfirmModal('Are you sure you want to save these candidate selections? This will replace the current election ballot setup.', 'Save Candidate Mapping', 'Save', 'primary');
        if (!confirmed) return;

        const saveBtn = document.getElementById('save-election-candidates');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
        }

        try {
            const { error: deleteCandidateMapError } = await supabaseAdmin
                .from('election_candidates')
                .delete()
                .eq('election_id', selectedElectionId);
            if (deleteCandidateMapError) throw deleteCandidateMapError;

            if (candidateIds.length) {
                const candidateRows = candidateIds.map(candidateId => ({ election_id: selectedElectionId, candidate_id: candidateId }));
                const { error: insertCandidateMapError } = await supabaseAdmin
                    .from('election_candidates')
                    .insert(candidateRows);
                if (insertCandidateMapError) throw insertCandidateMapError;
            }

            const { error: deletePositionMapError } = await supabaseAdmin
                .from('election_positions')
                .delete()
                .eq('election_id', selectedElectionId);
            if (deletePositionMapError) throw deletePositionMapError;

            if (positionIds.length) {
                const positionRows = positionIds.map(positionId => ({ election_id: selectedElectionId, position_id: positionId }));
                const { error: insertPositionMapError } = await supabaseAdmin
                    .from('election_positions')
                    .insert(positionRows);
                if (insertPositionMapError) throw insertPositionMapError;
            }

            await logAdminAction('save_election_candidates', 'election', selectedElectionId, { candidateCount: candidateIds.length });
            await logAdminAction('lock_election_candidates', 'election', selectedElectionId, { lockedAt: new Date().toISOString() });
            selectedElectionLocks.candidatesLocked = true;
            showToast('Candidates saved and locked for this election.', 'success');
            await loadElectionCandidates();
            applyElectionEditLock(selectedElectionStatus);
        } catch (error) {
            console.error('Error saving election candidates:', error);
            showAlertModal('Error saving election candidates: ' + error.message + '\nRun migration SQL if table is missing.', 'Error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Election Candidates';
            }
        }
    }

    async function loadEligibilityStudents() {
        const list = document.getElementById('eligible-students-list');
        if (!list || !selectedElectionId) return;

        if (isLegacyElectionId(selectedElectionId)) {
            list.innerHTML = '<tr><td colspan="4">Eligibility per election requires multi-election tables. <button type="button" class="migrate-legacy-election-btn">Migrate This Election</button></td></tr>';
            return;
        }

        try {
            const [{ data: students, error: studentsError }, { data: eligibleRows, error: eligibleError }] = await Promise.all([
                supabaseAdmin.from('students').select('id,name,student_id,email').order('name', { ascending: true }),
                supabaseAdmin.from('election_eligible_students').select('student_id').eq('election_id', selectedElectionId)
            ]);

            if (studentsError) throw studentsError;
            if (eligibleError) throw eligibleError;

            const eligibleSet = new Set((eligibleRows || []).map(r => r.student_id));
            list.innerHTML = (students || []).map(s => `
                <tr>
                    <td><input type="checkbox" class="eligibility-checkbox" data-student-id="${s.id}" ${eligibleSet.has(s.id) ? 'checked' : ''}></td>
                    <td>${s.name}</td>
                    <td>${s.student_id}</td>
                    <td>${s.email}</td>
                </tr>
            `).join('');
            applyElectionEditLock(selectedElectionStatus);
        } catch (error) {
            console.error('Error loading eligibility students:', error);
            list.innerHTML = `<tr><td colspan="4">${error.message}</td></tr>`;
        }
    }

    async function saveElectionEligibility() {
        if (!selectedElectionId) return;

        if (selectedElectionLocks.eligibilityLocked) {
            showToast('Student eligibility for this election is locked after save.', 'error');
            return;
        }

        if (selectedElectionStatus === 'active') {
            showToast('Cannot edit eligibility while election is active. End election first from Election Control.', 'error');
            return;
        }

        if (isLegacyElectionId(selectedElectionId)) {
            showAlertModal('Eligibility mapping is unavailable for legacy elections. Run migration and use new elections table.', 'Migration Required');
            return;
        }

        const checked = Array.from(document.querySelectorAll('.eligibility-checkbox:checked'))
            .map(cb => cb.getAttribute('data-student-id'));

        const baseMessage = 'Are you sure you want to save eligibility for this election? This will replace the current eligibility list.';
        const confirmed = await showConfirmModal(baseMessage, 'Save Eligibility', 'Save', 'primary');
        if (!confirmed) return;

        const saveBtn = document.getElementById('save-eligibility');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
        }

        try {
            const { error: deleteError } = await supabaseAdmin
                .from('election_eligible_students')
                .delete()
                .eq('election_id', selectedElectionId);
            if (deleteError) throw deleteError;

            if (checked.length) {
                const rows = checked.map(studentId => ({ election_id: selectedElectionId, student_id: studentId }));
                const { error: insertError } = await supabaseAdmin
                    .from('election_eligible_students')
                    .insert(rows);
                if (insertError) throw insertError;
            }

            await logAdminAction('save_election_eligibility', 'election', selectedElectionId, { eligibleStudentCount: checked.length });
            await logAdminAction('lock_election_eligibility', 'election', selectedElectionId, { lockedAt: new Date().toISOString() });
            selectedElectionLocks.eligibilityLocked = true;
            showToast('Eligibility saved and locked for this election.', 'success');
            await loadEligibilityStudents();
            applyElectionEditLock(selectedElectionStatus);
        } catch (error) {
            console.error('Error saving eligibility:', error);
            showAlertModal('Error saving eligibility: ' + error.message + '\nRun migration SQL if table is missing.', 'Error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Eligibility';
            }
        }
    }

    async function setupResultsPage() {
        await populateElectionSelect('results-election-select');
        const select = document.getElementById('results-election-select');
        if (!select) return;

        let pendingVoteCount = 0;
        let refreshTimeout = null;

        const scheduleRefresh = () => {
            // Batch updates: wait 2 seconds in case more votes arrive, then refresh once
            if (refreshTimeout) clearTimeout(refreshTimeout);
            refreshTimeout = setTimeout(async () => {
                console.log(`✓ Refreshing results (${pendingVoteCount} new votes)`);
                pendingVoteCount = 0;
                await loadResultsByElection();
                await loadWinnersByElection();
            }, 2000);
        };

        const handleNewVote = () => {
            pendingVoteCount++;
            showToast(`${pendingVoteCount} new vote(s) received. Results updating...`, 'info');
            scheduleRefresh();
        };

        select.addEventListener('change', async () => {
            selectedElectionId = select.value || null;
            // Unsubscribe from previous election
            RealtimeManager.unsubscribe(`election-votes-${selectedElectionId}`);
            pendingVoteCount = 0;
            if (refreshTimeout) clearTimeout(refreshTimeout);
            await loadResultsByElection();
            await loadWinnersByElection();
            await loadEligibleStudentsForResults();
            // Subscribe to new election
            if (selectedElectionId) {
                RealtimeManager.subscribeToElectionVotes(selectedElectionId, handleNewVote);
            }
        });

        selectedElectionId = select.value || selectedElectionId;
        await loadResultsByElection();
        await loadWinnersByElection();
        await loadEligibleStudentsForResults();

        // Subscribe to election votes for live updates
        if (selectedElectionId) {
            RealtimeManager.subscribeToElectionVotes(selectedElectionId, handleNewVote);
        }

        // Clean up subscriptions when leaving results page
        window.addEventListener('beforeunload', () => {
            if (refreshTimeout) clearTimeout(refreshTimeout);
            RealtimeManager.unsubscribeAll();
        });
    }

    async function setupAdminToolsPage() {
        const activeName = document.getElementById('tools-active-election-name');
        const activeStatus = document.getElementById('tools-active-election-status');
        const readinessList = document.getElementById('tools-readiness-list');
        const auditList = document.getElementById('tools-audit-list');
        const runReadinessBtn = document.getElementById('tools-run-readiness');

        const render = async () => {
            try {
                const active = await getActiveElection();
                if (activeName) activeName.textContent = active?.name || active?.election_name || 'No active election';
                if (activeStatus) activeStatus.innerHTML = active ? getStatusBadgeHtml('active') : getStatusBadgeHtml('draft');

                if (readinessList) {
                    if (!active?.id) {
                        readinessList.innerHTML = '<li>No active election selected. Pick one in Election pages and run readiness check there.</li>';
                    } else {
                        const readiness = await getElectionReadiness(active.id);
                        readinessList.innerHTML = readiness.ready
                            ? '<li>Election readiness: OK</li>'
                            : readiness.issues.map(i => `<li>${i}</li>`).join('');
                    }
                }

                if (auditList) {
                    const { data: logs, error } = await supabaseAdmin
                        .from('admin_audit_logs')
                        .select('action,target_type,target_id,created_at')
                        .order('created_at', { ascending: false })
                        .limit(20);

                    if (error) throw error;

                    if (!(logs || []).length) {
                        auditList.innerHTML = '<tr><td colspan="4">No audit logs yet.</td></tr>';
                    } else {
                        auditList.innerHTML = logs.map(log => `
                            <tr>
                                <td>${new Date(log.created_at).toLocaleString()}</td>
                                <td>${log.action}</td>
                                <td>${log.target_type || '-'}</td>
                                <td>${log.target_id || '-'}</td>
                            </tr>
                        `).join('');
                    }
                }
            } catch (error) {
                console.error('Error loading admin tools:', error);
                if (isPermissionDeniedError(error)) {
                    showToast('Admin tools blocked by database permissions. Run security-hardening.sql.', 'error');
                }
            }
        };

        if (runReadinessBtn) {
            runReadinessBtn.addEventListener('click', render);
        }

        await render();
    }

    async function loadResultsByElection() {
        const container = document.getElementById('results-container');
        if (!container) return;

        if (!selectedElectionId) {
            container.innerHTML = '<p class="subtitle">Select an election to view results.</p>';
            return;
        }

        try {
            let query = supabaseAdmin
                .from('votes')
                .select(`
                    id,
                    vote_time,
                    election_id,
                    candidates!fk_candidate (id,name,position_id),
                    positions!fk_position (id,position_name)
                `);

            if (!isLegacyElectionId(selectedElectionId)) {
                query = query.eq('election_id', selectedElectionId);
            }

            const { data: votes, error: votesError } = await query;
            if (votesError) throw votesError;

            const results = {};
            (votes || []).forEach(vote => {
                const positionName = vote.positions?.position_name || 'Unknown Position';
                const candidateName = vote.candidates?.name || 'Unknown Candidate';
                if (!results[positionName]) results[positionName] = {};
                if (!results[positionName][candidateName]) results[positionName][candidateName] = 0;
                results[positionName][candidateName]++;
            });

            renderResultsCharts(container, results);
        } catch (error) {
            console.error('Error loading results:', error);
            container.innerHTML = `<p class="subtitle">${error.message}</p>`;
        }
    }

    function renderResultsCharts(container, results) {
        container.innerHTML = '';
        const chartColors = ['#2E7D5B','#D9A441','#4C6A8A','#7B5E57','#6FAE95','#C97A52','#8C7A64','#5C8E7E','#A36A8C','#B8A34A'];

        const positions = Object.keys(results);
        if (!positions.length) {
            container.innerHTML = '<p class="subtitle">No votes yet for this election.</p>';
            return;
        }

        positions.forEach(position => {
            const chartCard = document.createElement('div');
            chartCard.className = 'result-chart-card';

            const title = document.createElement('h3');
            title.textContent = position;
            chartCard.appendChild(title);

            const canvas = document.createElement('canvas');
            chartCard.appendChild(canvas);
            container.appendChild(chartCard);

            const labels = Object.keys(results[position]);
            const values = Object.values(results[position]);
            const totalVotes = values.reduce((sum, val) => sum + Number(val || 0), 0);

            new Chart(canvas, {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{
                        data: values,
                        backgroundColor: labels.map((_, idx) => chartColors[idx % chartColors.length]),
                        borderColor: '#f8f7f2',
                        borderWidth: 2,
                        hoverOffset: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    cutout: '52%',
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 10, font: { size: 11 } } },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const value = Number(context.raw || 0);
                                    const pct = totalVotes > 0 ? ((value / totalVotes) * 100).toFixed(1) : '0.0';
                                    return `${context.label}: ${value} vote(s) (${pct}%)`;
                                }
                            }
                        }
                    }
                }
            });
        });
    }

    async function loadWinnersByElection() {
        const list = document.getElementById('winners-list');
        if (!list) return;
        if (!selectedElectionId) {
            list.innerHTML = '<tr><td colspan="3">Select an election.</td></tr>';
            return;
        }

        try {
            let query = supabaseAdmin
                .from('votes')
                .select(`
                    candidate_id,
                    position_id,
                    election_id,
                    candidates!fk_candidate (id,name),
                    positions!fk_position (id,position_name)
                `);

            if (!isLegacyElectionId(selectedElectionId)) {
                query = query.eq('election_id', selectedElectionId);
            }

            const { data: votes, error } = await query;
            if (error) throw error;

            const grouped = {};
            (votes || []).forEach(v => {
                const position = v.positions?.position_name || 'Unknown Position';
                const candidate = v.candidates?.name || 'Unknown Candidate';
                if (!grouped[position]) grouped[position] = {};
                grouped[position][candidate] = (grouped[position][candidate] || 0) + 1;
            });

            const rows = Object.keys(grouped).map(position => {
                const entries = Object.entries(grouped[position]).sort((a, b) => b[1] - a[1]);
                const [winnerName, winnerVotes] = entries[0] || ['-', 0];
                return `<tr><td>${position}</td><td>${winnerName}</td><td>${winnerVotes}</td></tr>`;
            });

            list.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="3">No winners yet.</td></tr>';
        } catch (error) {
            console.error('Error loading winners:', error);
            list.innerHTML = `<tr><td colspan="3">${error.message}</td></tr>`;
        }
    }

    async function loadEligibleStudentsForResults() {
        const list = document.getElementById('results-eligible-students');
        if (!list) return;
        if (!selectedElectionId) {
            list.innerHTML = '<tr><td colspan="3">Select an election.</td></tr>';
            return;
        }

        if (isLegacyElectionId(selectedElectionId)) {
            const { data: students, error } = await supabaseAdmin
                .from('students')
                .select('name,student_id,email')
                .order('name', { ascending: true });
            if (error) {
                list.innerHTML = `<tr><td colspan="3">${error.message}</td></tr>`;
                return;
            }
            list.innerHTML = (students || []).map(s => `<tr><td>${s.name}</td><td>${s.student_id}</td><td>${s.email}</td></tr>`).join('');
            return;
        }

        try {
            const { data, error } = await supabaseAdmin
                .from('election_eligible_students')
                .select(`
                    student_id,
                    students (id,name,student_id,email)
                `)
                .eq('election_id', selectedElectionId);

            if (error) throw error;

            const rows = (data || []).map(row => {
                const s = row.students;
                return `<tr><td>${s?.name || '-'}</td><td>${s?.student_id || '-'}</td><td>${s?.email || '-'}</td></tr>`;
            });

            list.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="3">No eligible students assigned.</td></tr>';
        } catch (error) {
            console.error('Error loading eligible students for results:', error);
            list.innerHTML = `<tr><td colspan="3">${error.message}</td></tr>`;
        }
    }

    async function loadDashboardStats() {
        try {
            const [studentsData, positionsData, candidatesData, electionsData] = await Promise.all([
                supabaseAdmin.from('students').select('id'),
                supabaseAdmin.from('positions').select('id'),
                supabaseAdmin.from('candidates').select('id'),
                supabaseAdmin.from('elections').select('id,name,status,created_at').order('created_at', { ascending: false })
            ]);

            const totalStudents = studentsData.data?.length || 0;
            const totalPositions = positionsData.data?.length || 0;
            const totalCandidates = candidatesData.data?.length || 0;

            const elections = electionsData.data || [];
            const activeElection = elections.find(e => e.status === 'active') || null;
            const contextElection = activeElection || elections[0] || null;

            let studentsVoted = 0;
            let studentsNotVoted = totalStudents;
            let voterTurnout = '0%';
            let totalVotes = 0;
            let electionStatus = 'No Election';

            if (contextElection) {
                const [{ data: eligibleRows, error: eligibleError }, { data: voteRows, error: voteError }] = await Promise.all([
                    supabaseAdmin
                        .from('election_eligible_students')
                        .select('student_id')
                        .eq('election_id', contextElection.id),
                    supabaseAdmin
                        .from('votes')
                        .select('id,student_id')
                        .eq('election_id', contextElection.id)
                ]);

                if (eligibleError) throw eligibleError;
                if (voteError) throw voteError;

                const eligibleSet = new Set((eligibleRows || []).map(r => r.student_id).filter(Boolean));
                const votedSet = new Set((voteRows || []).map(r => r.student_id).filter(Boolean));

                const eligibleCount = eligibleSet.size;
                studentsVoted = [...eligibleSet].filter(studentId => votedSet.has(studentId)).length;
                studentsNotVoted = Math.max(eligibleCount - studentsVoted, 0);
                voterTurnout = eligibleCount > 0 ? ((studentsVoted / eligibleCount) * 100).toFixed(1) + '%' : '0%';
                totalVotes = voteRows?.length || 0;

                const statusText = contextElection.status ? contextElection.status.charAt(0).toUpperCase() + contextElection.status.slice(1) : 'Unknown';
                electionStatus = `${statusText}: ${contextElection.name}`;
            } else {
                // Legacy fallback for projects that still use election_settings only
                const { data: legacyElection } = await supabaseAdmin
                    .from('election_settings')
                    .select('*')
                    .order('id', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                const { data: votesData } = await supabaseAdmin.from('votes').select('id');
                totalVotes = votesData?.length || 0;

                if (legacyElection) {
                    electionStatus = `${['Draft', 'Active', 'Ended'][legacyElection.status] || 'Unknown'}: ${legacyElection.election_name || 'Legacy Election'}`;
                }
            }

            // Update UI
            document.getElementById('total-students').textContent = totalStudents;
            document.getElementById('students-voted').textContent = studentsVoted;
            document.getElementById('students-not-voted').textContent = studentsNotVoted;
            document.getElementById('voter-turnout').textContent = voterTurnout;
            document.getElementById('total-positions').textContent = totalPositions;
            document.getElementById('total-candidates').textContent = totalCandidates;
            document.getElementById('total-votes').textContent = totalVotes;
            document.getElementById('election-status-display').textContent = electionStatus;

        } catch (error) {
            if (isPermissionDeniedError(error)) {
                showToast('Dashboard data blocked by database permissions. Run security-hardening.sql.', 'error');
                document.getElementById('election-status-display').textContent = 'Permission denied';
                return;
            }
            console.error('Error loading dashboard stats:', error);
        }
    }

    async function loadRecentVotingActivity() {
        try {
            const { data: activeElection } = await supabaseAdmin
                .from('elections')
                .select('id')
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            let query = supabaseAdmin
                .from('votes')
                .select(`
                    id,
                    vote_time,
                    student_id,
                    students!fk_student (name),
                    candidates!fk_candidate (name),
                    positions!fk_position (position_name)
                `)
                .order('vote_time', { ascending: false })
                .limit(10);

            if (activeElection?.id) {
                query = query.eq('election_id', activeElection.id);
            }

            const { data: votes, error } = await query;

            if (error) throw error;

            const recentVotesTable = document.getElementById('recent-votes');
            if (recentVotesTable && votes) {
                if (!votes.length) {
                    recentVotesTable.innerHTML = '<tr><td colspan="4">No recent votes for the active election.</td></tr>';
                    return;
                }

                recentVotesTable.innerHTML = votes.map(vote => {
                    const voteTime = new Date(vote.vote_time).toLocaleString();
                    const studentName = vote.students?.name || 'Unknown Student';
                    const candidateName = vote.candidates?.name || 'Unknown Candidate';
                    const positionName = vote.positions?.position_name || 'Unknown Position';

                    return `
                        <tr>
                            <td>${voteTime}</td>
                            <td>${studentName}</td>
                            <td>${candidateName}</td>
                            <td>${positionName}</td>
                        </tr>
                    `;
                }).join('');
            }
        } catch (error) {
            if (isPermissionDeniedError(error)) {
                const recentVotesTable = document.getElementById('recent-votes');
                if (recentVotesTable) {
                    recentVotesTable.innerHTML = '<tr><td colspan="4">Permission denied. Run security-hardening.sql in Supabase.</td></tr>';
                }
                showToast('Recent activity blocked by database permissions.', 'error');
                return;
            }
            console.error('Error loading recent voting activity:', error);
        }
    }

    // Election creation function - exposed globally for election-create.html
    window.handleCreateElection = async function(event) {
        event.preventDefault();

        const electionName = document.getElementById('electionName').value.trim();
        const startTime = document.getElementById('startTime').value;
        const endTime = document.getElementById('endTime').value;

        // Validation
        if (!electionName) {
            showError('Election name is required');
            return;
        }

        if (!startTime || !endTime) {
            showError('Both start and end times are required');
            return;
        }

        const startDate = new Date(startTime);
        const endDate = new Date(endTime);

        if (startDate >= endDate) {
            showError('End time must be after start time');
            return;
        }

        // Show loading state
        const submitBtn = document.getElementById('submitBtn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';

        try {
            // Create election using authenticated admin session
            const { data: electionData, error: electionError } = await supabaseAdmin
                .from('elections')
                .insert({
                    name: electionName,
                    start_time: startTime,
                    end_time: endTime,
                    status: 'draft'
                })
                .select()
                .single();

            if (electionError) {
                throw new Error(`Failed to create election: ${electionError.message}`);
            }

            await logAdminAction('create_election', 'election', electionData.id, {
                name: electionName,
                start_time: startTime,
                end_time: endTime
            });

            localStorage.setItem('admin-selected-election-id', electionData.id);
            localStorage.setItem('selectedElectionId', electionData.id);

            showSuccess(`✓ Election "${electionName}" created successfully! Redirecting...`);
            
            // Redirect to candidates page after 2 seconds
            setTimeout(() => {
                window.location.href = 'election-candidates.html';
            }, 2000);

        } catch (error) {
            console.error('Error creating election:', error);
            showError(error.message || 'Failed to create election. Please try again.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Election';
        }
    };

    window.cloneLastElectionSetup = async function() {
        const cloneBtn = document.getElementById('clone-last-election-btn');
        const electionName = document.getElementById('electionName')?.value.trim();
        const startTime = document.getElementById('startTime')?.value;
        const endTime = document.getElementById('endTime')?.value;

        if (!electionName || !startTime || !endTime) {
            showError('Provide election name, start time, and end time before cloning setup.');
            return;
        }

        if (new Date(startTime) >= new Date(endTime)) {
            showError('End time must be after start time.');
            return;
        }

        if (cloneBtn) {
            cloneBtn.disabled = true;
            cloneBtn.textContent = 'Cloning...';
        }

        try {
            const { data: sourceElection, error: sourceError } = await supabaseAdmin
                .from('elections')
                .select('id,name')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (sourceError) throw sourceError;
            if (!sourceElection?.id) throw new Error('No existing election found to clone from.');

            const { data: createdElection, error: createError } = await supabaseAdmin
                .from('elections')
                .insert([{ name: electionName, start_time: startTime, end_time: endTime, status: 'draft' }])
                .select('id')
                .single();

            if (createError) throw createError;

            const newElectionId = createdElection.id;

            const [{ data: sourceCandidates, error: candidatesError }, { data: sourceEligible, error: eligibleError }, { data: sourcePositions, error: positionsError }] = await Promise.all([
                supabaseAdmin.from('election_candidates').select('candidate_id').eq('election_id', sourceElection.id),
                supabaseAdmin.from('election_eligible_students').select('student_id').eq('election_id', sourceElection.id),
                supabaseAdmin.from('election_positions').select('position_id').eq('election_id', sourceElection.id)
            ]);

            if (candidatesError) throw candidatesError;
            if (eligibleError) throw eligibleError;
            if (positionsError) throw positionsError;

            if ((sourceCandidates || []).length) {
                const rows = sourceCandidates.map(r => ({ election_id: newElectionId, candidate_id: r.candidate_id }));
                const { error } = await supabaseAdmin.from('election_candidates').insert(rows);
                if (error) throw error;
            }

            if ((sourceEligible || []).length) {
                const rows = sourceEligible.map(r => ({ election_id: newElectionId, student_id: r.student_id }));
                const { error } = await supabaseAdmin.from('election_eligible_students').insert(rows);
                if (error) throw error;
            }

            if ((sourcePositions || []).length) {
                const rows = sourcePositions.map(r => ({ election_id: newElectionId, position_id: r.position_id }));
                const { error } = await supabaseAdmin.from('election_positions').insert(rows);
                if (error) throw error;
            }

            await logAdminAction('clone_election_setup', 'election', newElectionId, {
                sourceElectionId: sourceElection.id,
                sourceElectionName: sourceElection.name
            });

            localStorage.setItem('admin-selected-election-id', newElectionId);
            showSuccess('✓ Election created and setup cloned. Redirecting to eligibility for final review...');
            setTimeout(() => {
                window.location.href = 'election-eligibility.html';
            }, 1500);
        } catch (error) {
            console.error('Error cloning election setup:', error);
            showError('Clone failed: ' + error.message);
            if (cloneBtn) {
                cloneBtn.disabled = false;
                cloneBtn.innerHTML = '<i class="fas fa-copy"></i> Clone Last Setup';
            }
        }
    };

    window.showSuccess = function(message) {
        const msgDiv = document.getElementById('successMessage');
        if (!msgDiv) return;
        msgDiv.textContent = message;
        msgDiv.style.display = 'block';
        const errorDiv = document.getElementById('errorMessage');
        const infoDiv = document.getElementById('infoMessage');
        if (errorDiv) errorDiv.style.display = 'none';
        if (infoDiv) infoDiv.style.display = 'none';
        msgDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    window.showError = function(message) {
        const msgDiv = document.getElementById('errorMessage');
        if (!msgDiv) return;
        msgDiv.textContent = '✕ ' + message;
        msgDiv.style.display = 'block';
        const successDiv = document.getElementById('successMessage');
        const infoDiv = document.getElementById('infoMessage');
        if (successDiv) successDiv.style.display = 'none';
        if (infoDiv) infoDiv.style.display = 'none';
        msgDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    window.setMinDateTime = function() {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        const minDateTime = now.toISOString().slice(0, 16);
        const startInput = document.getElementById('startTime');
        const endInput = document.getElementById('endTime');
        if (startInput) startInput.min = minDateTime;
        if (endInput) endInput.min = minDateTime;

        const cloneBtn = document.getElementById('clone-last-election-btn');
        if (cloneBtn && !cloneBtn.dataset.bound) {
            cloneBtn.addEventListener('click', window.cloneLastElectionSetup);
            cloneBtn.dataset.bound = '1';
        }
    };
});

