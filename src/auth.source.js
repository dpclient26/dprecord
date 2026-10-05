// ==========================================
// Auth Guard — runs in <head> before page renders
// ==========================================

// Initialize theme early (prevents flash of unstyled content)
(function () {
    const saved = localStorage.getItem('dp_theme') || 'light';
    document.documentElement.setAttribute('data-bs-theme', saved);
    document.documentElement.setAttribute('data-theme', saved);
})();

// Check if the user is logged in
const token = sessionStorage.getItem('ops_portal_token');

if (!token) {
    // If no token, redirect to login page
    window.location.replace('/login');
}

// Logout function — clears all session data
function logout() {
    sessionStorage.removeItem('ops_portal_token');
    sessionStorage.removeItem('ops_portal_user');
    sessionStorage.removeItem('ops_portal_records_cache');
    window.location.replace('/login');
}
