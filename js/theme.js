const THEME_KEY = 'voting-theme';

function getPreferredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') {
        return saved;
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
}

function isLoginPage() {
    return !!document.getElementById('login-form') || !!document.getElementById('admin-login-form');
}

function ensureThemeSwitchHost() {
    let host = document.getElementById('theme-toggle-host');
    if (host) return host;

    host = document.createElement('div');
    host.id = 'theme-toggle-host';
    host.className = 'theme-switch-host';
    host.innerHTML = `
        <label class="theme-switch" for="theme-switch-input">
            <input id="theme-switch-input" class="theme-switch-input" type="checkbox" role="switch" aria-label="Enable dark mode">
            <span class="theme-switch-track" aria-hidden="true"><span class="theme-switch-thumb"></span></span>
            <span class="theme-switch-text">Dark Mode</span>
        </label>
    `;

    return host;
}

function mountThemeSwitch(host) {
    const adminNav = document.querySelector('.sidebar-nav ul');
    if (adminNav) {
        const item = document.createElement('li');
        item.className = 'theme-switch-nav-item';
        item.appendChild(host);
        adminNav.appendChild(item);
        return true;
    }

    const studentActions = document.querySelector('.student-header-actions') || document.querySelector('.student-header');
    if (studentActions) {
        studentActions.appendChild(host);
        return true;
    }

    return false;
}

function initThemeToggle() {
    const initialTheme = getPreferredTheme();
    applyTheme(initialTheme);

    if (isLoginPage()) {
        return;
    }

    const host = ensureThemeSwitchHost();
    if (!mountThemeSwitch(host)) {
        return;
    }

    const input = host.querySelector('#theme-switch-input');
    if (!input) return;

    input.checked = initialTheme === 'dark';
    input.addEventListener('change', () => {
        const next = input.checked ? 'dark' : 'light';
        localStorage.setItem(THEME_KEY, next);
        applyTheme(next);
    });
}

export { initThemeToggle };
