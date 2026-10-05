// ==========================================
// Login Page Logic (CSP-compliant, external script)
// ==========================================

// Initialize theme early (prevents flash of wrong theme)
(function () {
    const saved = localStorage.getItem('dp_theme') || 'light';
    document.documentElement.setAttribute('data-bs-theme', saved);
    document.documentElement.setAttribute('data-theme', saved);
})();

// ==========================================
// Session Check
// ==========================================
function checkExistingSession() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('timeout') === 'true') {
        sessionStorage.removeItem('ops_portal_token');
        sessionStorage.removeItem('ops_portal_user');
        sessionStorage.removeItem('ops_portal_records_cache');
        const errorAlert = document.getElementById('errorAlert');
        if (errorAlert) {
            errorAlert.innerText = "Your session has expired. Please sign in again.";
            errorAlert.classList.remove('d-none');
        }
        return;
    }

    // If already logged in, redirect to app
    if (sessionStorage.getItem('ops_portal_token')) {
        window.location.replace('/index');
    }
}

checkExistingSession();
window.addEventListener('pageshow', checkExistingSession);

// ==========================================
// Math CAPTCHA
// ==========================================
let correctAnswer = 0;

function generateCaptcha() {
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    correctAnswer = num1 + num2;
    const el = document.getElementById('captchaQuestion');
    if (el) el.textContent = `What is ${num1} + ${num2}?`;
}

// ==========================================
// Theme Toggle on Login Page
// ==========================================
function initLoginTheme() {
    const saved = localStorage.getItem('dp_theme') || 'light';
    const icon = document.getElementById('themeIcon');
    if (icon) {
        icon.className = saved === 'dark' ? 'bi bi-sun-fill text-warning' : 'bi bi-moon-fill';
    }
    const toggleBtn = document.getElementById('themeToggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-bs-theme') || 'light';
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-bs-theme', next);
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('dp_theme', next);
            if (icon) {
                icon.className = next === 'dark' ? 'bi bi-sun-fill text-warning' : 'bi bi-moon-fill';
            }
        });
    }
}

// ==========================================
// Initialization & Form Handler
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    generateCaptcha();
    initLoginTheme();

    const form = document.getElementById('loginForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const captchaInput = document.getElementById('captchaAnswer');
        const errorAlert = document.getElementById('errorAlert');
        const loginBtn = document.getElementById('loginBtn');

        const username = usernameInput ? usernameInput.value.trim() : '';
        const password = passwordInput ? passwordInput.value : '';
        const answer = parseInt(captchaInput ? captchaInput.value : '', 10);

        // Validate CAPTCHA
        if (answer !== correctAnswer) {
            errorAlert.innerText = "Incorrect CAPTCHA answer. Please try again.";
            errorAlert.classList.remove('d-none');
            generateCaptcha();
            if (captchaInput) captchaInput.value = '';
            return;
        }

        // Show loading state
        loginBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Signing in...';
        loginBtn.disabled = true;
        errorAlert.classList.add('d-none');

        try {
            const response = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (data.success) {
                sessionStorage.setItem('ops_portal_token', data.token);
                sessionStorage.setItem('ops_portal_user', data.username);
                window.location.replace('/index');
            } else {
                throw new Error(data.error || 'Login failed. Please check your credentials.');
            }
        } catch (error) {
            errorAlert.innerText = error.message;
            errorAlert.classList.remove('d-none');
            generateCaptcha();
            if (captchaInput) captchaInput.value = '';
        } finally {
            loginBtn.innerHTML = 'Sign In <i class="bi bi-box-arrow-in-right ms-2"></i>';
            loginBtn.disabled = false;
        }
    });
});
