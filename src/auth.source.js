// Check if the user is logged in
const token = sessionStorage.getItem('ops_portal_token');

if (!token) {
    // If no token, redirect to login page
    window.location.href = '/login';
}

// Logout function
function logout() {
    // Remove the token from sessionStorage
    sessionStorage.removeItem('ops_portal_token');
    // Redirect to login page
    window.location.href = '/login';
}
