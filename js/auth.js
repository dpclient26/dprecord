// Check if the user is logged in
const token = sessionStorage.getItem('ops_portal_token');

if (!token) {
    // If no token, redirect to login page
    window.location.href = '/login';
}

// Logout function
function logout() {
    // Clear all session storage credentials and cache
    sessionStorage.removeItem('ops_portal_token');
    sessionStorage.removeItem('ops_portal_user');
    sessionStorage.removeItem('ops_portal_records_cache');
    // Redirect to login page
    window.location.href = '/login';
}