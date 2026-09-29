// js/theme.js
// Handles dark/light mode toggle across all pages

(function () {
    const STORAGE_KEY = 'ops_portal_theme';
    const htmlElement = document.documentElement;

    // ==========================================
    // 1. Apply saved theme immediately (before page renders)
    // ==========================================
    function applyTheme(theme) {
        if (theme === 'dark') {
            htmlElement.setAttribute('data-bs-theme', 'dark');
        } else {
            htmlElement.setAttribute('data-bs-theme', 'light');
        }
        updateIcon(theme);
    }

    // ==========================================
    // 2. Update the moon/sun icon
    // ==========================================
    function updateIcon(theme) {
        const icon = document.getElementById('themeIcon');
        if (!icon) return;
        if (theme === 'dark') {
            icon.className = 'bi bi-sun-fill';
        } else {
            icon.className = 'bi bi-moon-fill';
        }
    }

    // ==========================================
    // 3. Get the current theme
    // ==========================================
    function getCurrentTheme() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return saved;
        // Fall back to system preference
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    // ==========================================
    // 4. Toggle theme
    // ==========================================
    function toggleTheme() {
        const current = getCurrentTheme();
        const next = current === 'dark' ? 'light' : 'dark';
        localStorage.setItem(STORAGE_KEY, next);
        applyTheme(next);
    }

    // ==========================================
    // 5. Initialize on page load
    // ==========================================
    function init() {
        // Apply theme immediately
        applyTheme(getCurrentTheme());

        // Wire up the button
        const btn = document.getElementById('themeToggle');
        if (btn) {
            btn.addEventListener('click', toggleTheme);
        }
    }

    // Run once DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();