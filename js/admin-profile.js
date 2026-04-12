import { supabase } from "../supabase-config.js";

document.addEventListener('DOMContentLoaded', async () => {
    const emailDisplay = document.getElementById('email-display');
    const changePasswordBtn = document.getElementById('change-password-btn');
    const passwordMessage = document.getElementById('password-message');
    const currentPasswordInput = document.getElementById('current-password');
    const newPasswordInput = document.getElementById('new-password');
    const confirmPasswordInput = document.getElementById('confirm-password');

    // Load current user email
    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user?.email) {
            console.error('Failed to load user:', error);
            return;
        }
        emailDisplay.value = user.email;
    } catch (error) {
        console.error('Error loading user email:', error);
    }

    // Handle password change
    changePasswordBtn.addEventListener('click', async () => {
        const currentPassword = currentPasswordInput.value.trim();
        const newPassword = newPasswordInput.value.trim();
        const confirmPassword = confirmPasswordInput.value.trim();

        // Validation
        if (!currentPassword) {
            showMessage('Please enter your current password', 'error');
            return;
        }

        if (!newPassword) {
            showMessage('Please enter a new password', 'error');
            return;
        }

        if (newPassword.length < 8) {
            showMessage('New password must be at least 8 characters long', 'error');
            return;
        }

        if (newPassword !== confirmPassword) {
            showMessage('Passwords do not match', 'error');
            return;
        }

        if (currentPassword === newPassword) {
            showMessage('New password must be different from your current password', 'error');
            return;
        }

        // Disable button during submission
        changePasswordBtn.disabled = true;
        changePasswordBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';

        try {
            // Verify current password by attempting to re-auth
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            if (userError || !user?.email) {
                showMessage('Failed to verify your account', 'error');
                return;
            }

            // Attempt sign in with current password to verify it's correct
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: user.email,
                password: currentPassword
            });

            if (signInError) {
                showMessage('Current password is incorrect', 'error');
                changePasswordBtn.disabled = false;
                changePasswordBtn.innerHTML = '<i class="fas fa-lock"></i> Update Password';
                return;
            }

            // Update password
            const { error: updateError } = await supabase.auth.updateUser({
                password: newPassword
            });

            if (updateError) {
                showMessage('Failed to update password: ' + updateError.message, 'error');
            } else {
                showMessage('Password updated successfully!', 'success');
                // Clear form
                currentPasswordInput.value = '';
                newPasswordInput.value = '';
                confirmPasswordInput.value = '';
                setTimeout(() => {
                    passwordMessage.style.display = 'none';
                }, 3000);
            }
        } catch (error) {
            showMessage('An error occurred: ' + error.message, 'error');
        } finally {
            changePasswordBtn.disabled = false;
            changePasswordBtn.innerHTML = '<i class="fas fa-lock"></i> Update Password';
        }
    });

    function showMessage(message, type) {
        passwordMessage.textContent = message;
        passwordMessage.style.display = 'block';
        passwordMessage.style.padding = '12px 16px';
        passwordMessage.style.borderRadius = '4px';
        passwordMessage.style.fontWeight = '500';

        if (type === 'success') {
            passwordMessage.style.backgroundColor = '#d4edda';
            passwordMessage.style.color = '#155724';
            passwordMessage.style.border = '1px solid #c3e6cb';
        } else {
            passwordMessage.style.backgroundColor = '#f8d7da';
            passwordMessage.style.color = '#721c24';
            passwordMessage.style.border = '1px solid #f5c6cb';
        }
    }

    // Allow Enter key to submit
    confirmPasswordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            changePasswordBtn.click();
        }
    });
});
