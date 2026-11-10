// ==========================================
// Auth Guard & Early Theme Initialization
// Runs synchronously in <head> before page renders
// ==========================================

// 1. Initialize theme early to prevent flash of wrong theme (FOUC)
(function () {
    const saved = localStorage.getItem('dp_theme') || 'light';
    document.documentElement.setAttribute('data-bs-theme', saved);
    document.documentElement.setAttribute('data-theme', saved);
})();

// 2. Authentication Check — hide body immediately if not authenticated
//    This prevents any flash of protected content before redirect
const token = sessionStorage.getItem('ops_portal_token');
if (!token) {
    document.documentElement.style.visibility = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    window.location.replace('/login');
    // Halt all further script execution on this page
    throw new Error('AUTH_REDIRECT');
}

// 3. Centralized Logout Handler
function logout() {
    stopInactivityTimer();
    sessionStorage.removeItem('ops_portal_token');
    sessionStorage.removeItem('ops_portal_user');
    sessionStorage.removeItem('ops_portal_records_cache');
    window.location.replace('/login');
}

// ==========================================
// 4. Inactivity Auto-Logout Timer (3 Minutes)
// Automatically logs the user out after 3 minutes
// of no mouse, keyboard, scroll, or touch activity.
// ==========================================
const INACTIVITY_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
let _inactivityTimer = null;
let _lastActivityThrottle = 0;

function resetInactivityTimer() {
    if (_inactivityTimer) clearTimeout(_inactivityTimer);
    _inactivityTimer = setTimeout(() => {
        // Only logout if still authenticated
        if (sessionStorage.getItem('ops_portal_token')) {
            logout();
        }
    }, INACTIVITY_TIMEOUT_MS);
}

function stopInactivityTimer() {
    if (_inactivityTimer) {
        clearTimeout(_inactivityTimer);
        _inactivityTimer = null;
    }
}

// Throttled activity handler — resets timer at most once per second
// to avoid performance overhead from high-frequency events (mousemove, scroll)
function onUserActivity() {
    const now = Date.now();
    if (now - _lastActivityThrottle < 1000) return;
    _lastActivityThrottle = now;
    resetInactivityTimer();
}

// Start the inactivity timer only if the user is authenticated
if (token) {
    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    activityEvents.forEach(evt => {
        document.addEventListener(evt, onUserActivity, { passive: true });
    });
    resetInactivityTimer();
}
