// ==========================================
// DeG - Data Purity Operations Portal
// Admin Panel Logic (Users & Audit Logs)
// ==========================================

const ADMIN_API = '/api/admin';
let allUsers = [];
let allLogs = [];

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showToast(message, type = 'info', duration = 3500) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'true');
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;

    let iconClass = 'bi-info-circle-fill';
    if (type === 'success') iconClass = 'bi-check-circle-fill';
    else if (type === 'error') iconClass = 'bi-exclamation-triangle-fill';
    else if (type === 'warning') iconClass = 'bi-exclamation-circle-fill';

    toast.innerHTML = `<i class="bi ${iconClass} me-2"></i><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function initTheme() {
    const saved = localStorage.getItem('dp_theme') || 'light';
    applyTheme(saved);
    const toggleBtn = document.getElementById('themeToggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-bs-theme') || 'light';
            applyTheme(current === 'dark' ? 'light' : 'dark');
        });
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dp_theme', theme);
    const icon = document.getElementById('themeIcon');
    if (icon) {
        icon.className = theme === 'dark' ? 'bi bi-sun-fill text-warning' : 'bi bi-moon-fill';
    }
}

function startISTClock() {
    const clockEl = document.getElementById('istClock');
    if (!clockEl) return;
    const update = () => {
        const now = new Date();
        const dayDate = now.toLocaleDateString('en-IN', {
            timeZone: 'Asia/Kolkata',
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
        const timeStr = now.toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        clockEl.innerHTML = `<i class="bi bi-clock-fill text-primary"></i> <span>${dayDate}</span> <span class="text-body-tertiary">|</span> <span>${timeStr} IST</span>`;
    };
    update();
    setInterval(update, 1000);
}

async function adminFetch(url, options = {}) {
    const token = sessionStorage.getItem('ops_portal_token') || '';
    const headers = {
        ...(options.headers || {}),
        'Authorization': 'Bearer ' + token
    };
    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
        logout();
        return null;
    }
    if (response.status === 403) {
        window.location.replace('/form');
        return null;
    }

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
}

// ==========================================
// Users Management
// ==========================================
async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Loading users...</td></tr>`;
    try {
        const data = await adminFetch(`${ADMIN_API}?action=list_users`);
        if (!data) return;
        allUsers = data.users || [];
        renderUsersTable();
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-danger">${escapeHtml(err.message)}</td></tr>`;
    }
}

function renderUsersTable() {
    const tbody = document.getElementById('usersTableBody');
    const countBadge = document.getElementById('userCountBadge');
    if (!tbody) return;

    if (countBadge) countBadge.innerText = `${allUsers.length} Users`;

    if (allUsers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No users created in D1 yet. Click "Add New User" to create your team accounts.</td></tr>`;
        return;
    }

    tbody.innerHTML = allUsers.map(u => {
        const roleBadge = u.role === 'admin'
            ? `<span class="badge bg-primary-subtle text-primary border border-primary-subtle">Admin</span>`
            : `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle">User</span>`;

        const statusBadge = u.status === 'active'
            ? `<span class="badge bg-success-subtle text-success border border-success-subtle">Active</span>`
            : `<span class="badge bg-danger-subtle text-danger border border-danger-subtle">Inactive</span>`;

        const toggleActionLabel = u.status === 'active' ? 'Deactivate' : 'Activate';
        const toggleBtnClass = u.status === 'active' ? 'btn-outline-warning' : 'btn-outline-success';

        return `
            <tr>
                <td class="px-4 fw-semibold">${escapeHtml(u.id)}</td>
                <td class="fw-semibold text-primary">${escapeHtml(u.username)}</td>
                <td>${escapeHtml(u.display_name)}</td>
                <td>${roleBadge}</td>
                <td>${statusBadge}</td>
                <td class="text-muted small">${escapeHtml(u.updated_at || u.created_at)}</td>
                <td class="text-end px-4">
                    <div class="d-inline-flex gap-1">
                        <button type="button" class="btn btn-sm btn-outline-primary edit-user-btn" data-id="${u.id}" title="Edit user">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button type="button" class="btn btn-sm ${toggleBtnClass} toggle-user-btn" data-id="${u.id}" title="${toggleActionLabel}">
                            <i class="bi ${u.status === 'active' ? 'bi-pause-circle' : 'bi-play-circle'}"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-danger delete-user-btn" data-id="${u.id}" title="Delete user permanently">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function openCreateUserModal() {
    document.getElementById('userModalTitle').innerText = 'Add New User';
    document.getElementById('userForm').reset();
    document.getElementById('editUserId').value = '';
    document.getElementById('modalUsername').disabled = false;
    document.getElementById('modalPassword').required = true;
    document.getElementById('passwordHelp').innerText = 'Min 8 chars with uppercase, lowercase, and a number.';
    document.getElementById('modalStatusGroup').classList.add('d-none');

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('userModal'));
    modal.show();
}

function openEditUserModal(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;

    document.getElementById('userModalTitle').innerText = `Edit User: ${user.username}`;
    document.getElementById('editUserId').value = user.id;
    document.getElementById('modalUsername').value = user.username;
    document.getElementById('modalUsername').disabled = true;
    document.getElementById('modalDisplayName').value = user.display_name;
    document.getElementById('modalRole').value = user.role;
    document.getElementById('modalStatus').value = user.status;
    document.getElementById('modalPassword').value = '';
    document.getElementById('modalPassword').required = false;
    document.getElementById('passwordHelp').innerText = 'Leave blank to keep existing password.';
    document.getElementById('modalStatusGroup').classList.remove('d-none');

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('userModal'));
    modal.show();
}

async function handleUserFormSubmit(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('saveUserBtn');
    const originalText = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';

    const editId = document.getElementById('editUserId').value;
    const username = document.getElementById('modalUsername').value.trim();
    const displayName = document.getElementById('modalDisplayName').value.trim();
    const role = document.getElementById('modalRole').value;
    const status = document.getElementById('modalStatus').value;
    const password = document.getElementById('modalPassword').value;

    try {
        const payload = editId
            ? { action: 'update_user', id: Number(editId), displayName, role, status, password }
            : { action: 'create_user', username, displayName, role, password };

        const data = await adminFetch(ADMIN_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!data) return;

        showToast(data.message || 'User saved successfully!', 'success');
        bootstrap.Modal.getOrCreateInstance(document.getElementById('userModal')).hide();
        await Promise.all([loadUsers(), loadLogs()]);
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalText;
    }
}

async function toggleUserStatus(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;
    const newStatus = user.status === 'active' ? 'inactive' : 'active';
    try {
        const data = await adminFetch(ADMIN_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'update_user',
                id: user.id,
                displayName: user.display_name,
                role: user.role,
                status: newStatus
            })
        });
        if (!data) return;
        showToast(`User "${user.username}" is now ${newStatus}.`, 'success');
        await Promise.all([loadUsers(), loadLogs()]);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteUser(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;
    if (!confirm(`Permanently delete user "${user.username}" (${user.display_name})? Their existing records and audit logs will remain.`)) {
        return;
    }
    try {
        const data = await adminFetch(ADMIN_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete_user', id: user.id, permanent: true })
        });
        if (!data) return;
        showToast(data.message, 'success');
        await Promise.all([loadUsers(), loadLogs()]);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ==========================================
// Audit Logs
// ==========================================
async function loadLogs() {
    const tbody = document.getElementById('logsTableBody');
    if (!tbody) return;

    const userFilter = (document.getElementById('logUserFilter')?.value || '').trim();
    const actionFilter = (document.getElementById('logActionFilter')?.value || '').trim();

    const params = new URLSearchParams({ action: 'logs', limit: '200' });
    if (userFilter) params.append('username', userFilter);
    if (actionFilter) params.append('action_filter', actionFilter);

    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Loading logs...</td></tr>`;
    try {
        const data = await adminFetch(`${ADMIN_API}?${params.toString()}`);
        if (!data) return;
        allLogs = data.logs || [];
        renderLogsTable();
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">${escapeHtml(err.message)}</td></tr>`;
    }
}

function renderLogsTable() {
    const tbody = document.getElementById('logsTableBody');
    const countBadge = document.getElementById('logCountBadge');
    if (!tbody) return;

    if (countBadge) countBadge.innerText = `${allLogs.length} Events`;

    if (allLogs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No activity logs match the current filter.</td></tr>`;
        return;
    }

    const actionBadgeClass = (act) => {
        if (act === 'login') return 'bg-success-subtle text-success border-success-subtle';
        if (act === 'login_failed' || act === 'delete_user') return 'bg-danger-subtle text-danger border-danger-subtle';
        if (act.includes('user')) return 'bg-primary-subtle text-primary border-primary-subtle';
        return 'bg-info-subtle text-info border-info-subtle';
    };

    tbody.innerHTML = allLogs.map(log => {
        const targetText = log.target_type
            ? `${log.target_type}${log.target_id ? ': ' + log.target_id : ''}`
            : '-';

        return `
            <tr>
                <td class="px-4 small text-muted text-nowrap">${escapeHtml(log.timestamp)}</td>
                <td class="fw-semibold">${escapeHtml(log.username)}</td>
                <td><span class="badge border ${actionBadgeClass(log.action)}">${escapeHtml(log.action)}</span></td>
                <td class="small">${escapeHtml(targetText)}</td>
                <td class="small text-muted text-truncate" style="max-width: 280px;" title="${escapeHtml(log.details || '')}">${escapeHtml(log.details || '-')}</td>
                <td class="px-4 small text-muted text-nowrap">${escapeHtml(log.ip_address || '-')}</td>
            </tr>
        `;
    }).join('');
}

// ==========================================
// Initialization
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    startISTClock();

    const displayName = sessionStorage.getItem('ops_portal_display_name') || sessionStorage.getItem('ops_portal_user') || 'Administrator';
    const userDisplay = document.getElementById('currentUserDisplay');
    if (userDisplay) {
        userDisplay.innerHTML = `${escapeHtml(displayName)} <span class="badge bg-primary-subtle text-primary border border-primary-subtle ms-1">Admin</span>`;
    }

    document.querySelectorAll('.logout-btn, #logoutBtn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    });

    document.getElementById('addUserBtn')?.addEventListener('click', openCreateUserModal);
    document.getElementById('userForm')?.addEventListener('submit', handleUserFormSubmit);

    document.getElementById('usersTableBody')?.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.edit-user-btn');
        if (editBtn) {
            openEditUserModal(Number(editBtn.getAttribute('data-id')));
            return;
        }
        const toggleBtn = e.target.closest('.toggle-user-btn');
        if (toggleBtn) {
            toggleUserStatus(Number(toggleBtn.getAttribute('data-id')));
            return;
        }
        const delBtn = e.target.closest('.delete-user-btn');
        if (delBtn) {
            deleteUser(Number(delBtn.getAttribute('data-id')));
        }
    });

    document.getElementById('refreshLogsBtn')?.addEventListener('click', loadLogs);
    document.getElementById('logActionFilter')?.addEventListener('change', loadLogs);

    let logSearchTimer;
    document.getElementById('logUserFilter')?.addEventListener('input', () => {
        clearTimeout(logSearchTimer);
        logSearchTimer = setTimeout(loadLogs, 300);
    });

    loadUsers();
    loadLogs();
});

