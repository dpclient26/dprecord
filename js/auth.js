// ==========================================
// Auth Guard & Early Theme Initialization
// Runs synchronously in <head> before page renders
// ==========================================

(function () {
    const saved = localStorage.getItem('dp_theme') || 'light';
    document.documentElement.setAttribute('data-bs-theme', saved);
    document.documentElement.setAttribute('data-theme', saved);
})();

const token = sessionStorage.getItem('ops_portal_token');
if (!token) {
    window.location.replace('/login');
}

function logout() {
    sessionStorage.removeItem('ops_portal_token');
    sessionStorage.removeItem('ops_portal_user');
    sessionStorage.removeItem('ops_portal_records_cache');
    window.location.replace('/login');
}