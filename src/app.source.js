// ==========================================
// DeG - Data Purity Operations Portal
// Core Application Logic
// ==========================================

const scriptURL = '/api/cfdb';

// Global Application State
let allRecords = [];
let filteredRecords = [];
let currentPage = 1;
const recordsPerPage = 10;
let currentFilter = 'all';
let searchQuery = '';

// Cache Configuration
const CACHE_KEY = 'ops_portal_records_cache';
const CACHE_TTL = 60 * 1000; // 60 seconds

// ==========================================
// Toast Notification Utility (Non-blocking)
// ==========================================
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

// ==========================================
// Theme (Dark / Light Mode) Management
// ==========================================
function initTheme() {
    const currentTheme = localStorage.getItem('dp_theme') || 'light';
    applyTheme(currentTheme);

    const themeToggleBtn = document.getElementById('themeToggle');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const activeTheme = document.documentElement.getAttribute('data-bs-theme') || 'light';
            const newTheme = activeTheme === 'dark' ? 'light' : 'dark';
            applyTheme(newTheme);
        });
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dp_theme', theme);

    const icon = document.getElementById('themeIcon');
    if (icon) {
        if (theme === 'dark') {
            icon.className = 'bi bi-sun-fill text-warning';
        } else {
            icon.className = 'bi bi-moon-fill';
        }
    }

    // Redraw pie chart if present on page to adapt colors/contrast
    if (document.getElementById('statusPieChart')) {
        drawStatusPieChart();
    }
}

// ==========================================
// Lifecycle Entry Point
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();

    // Attach global logout button listeners (replaces inline onclick for CSP)
    document.querySelectorAll('.logout-btn, #logoutBtn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    });

    const tableBody = document.getElementById('tableBody');
    if (tableBody) {
        loadFromCacheOrFetch();
        setupFilters();
        setupBadgeFilters();
        setupSearch();
        setupDownloadButton();
        setupTableDelegation();
    }

    const form = document.getElementById('requestForm');
    if (form) {
        setupFormLogic(form);
    }

    // Display logged-in user name
    const user = sessionStorage.getItem('ops_portal_user');
    const userDisplay = document.getElementById('currentUserDisplay');
    if (user && userDisplay) {
        userDisplay.innerText = user;
    }
});

// ==========================================
// Cache Helpers (Stale-While-Revalidate)
// ==========================================
function saveToCache(data) {
    try {
        const payload = { data: data, timestamp: Date.now() };
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (e) {
        console.warn('SessionStorage cache quota exceeded:', e);
    }
}

function getFromCache() {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const payload = JSON.parse(raw);
        if (Date.now() - payload.timestamp > CACHE_TTL) return null;
        return payload.data;
    } catch (e) {
        return null;
    }
}

function clearCache() {
    sessionStorage.removeItem(CACHE_KEY);
}

// ==========================================
// Smart Fetch with Token & Retry
// ==========================================
async function fetchWithRetry(url, options = {}, retries = 3, delay = 500) {
    const token = sessionStorage.getItem('ops_portal_token') || '';
    const headers = {
        ...(options.headers || {}),
        'Authorization': 'Bearer ' + token
    };

    const mergedOptions = { ...options, headers };

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, mergedOptions);

            if (response.status === 401) {
                sessionStorage.removeItem('ops_portal_token');
                sessionStorage.removeItem('ops_portal_user');
                sessionStorage.removeItem(CACHE_KEY);
                window.location.replace('/login?timeout=true');
                return null;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            if (attempt === retries) throw error;
            await new Promise(r => setTimeout(r, delay * attempt));
        }
    }
}

// ==========================================
// Data Fetching & Caching
// ==========================================
async function loadFromCacheOrFetch() {
    const tableBody = document.getElementById('tableBody');
    const cached = getFromCache();

    if (cached && Array.isArray(cached) && cached.length >= 0) {
        allRecords = [...cached];
        updateStats();
        applyFiltersAndRender();
        // Background silent refresh
        fetchAndRenderRecords(true);
    } else {
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="10" class="text-center py-4"><div class="spinner-border text-primary" role="status"></div><br><span class="text-muted small mt-2 d-inline-block">Loading records...</span></td></tr>`;
        }
        fetchAndRenderRecords(false);
    }
}

async function fetchAndRenderRecords(isBackgroundRefresh = false) {
    try {
        const data = await fetchWithRetry(scriptURL + '?action=get', {}, 3, 500);
        if (!data) return;

        saveToCache(data);

        // Avoid re-rendering if background refresh data hasn't changed
        if (isBackgroundRefresh && JSON.stringify(data) === JSON.stringify(allRecords)) {
            return;
        }

        allRecords = [...data];
        updateStats();
        applyFiltersAndRender();
    } catch (error) {
        console.error('Error fetching records:', error);
        if (!isBackgroundRefresh || allRecords.length === 0) {
            const tableBody = document.getElementById('tableBody');
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr><td colspan="10" class="text-center py-4 text-danger">
                        <i class="bi bi-exclamation-triangle me-2"></i>Unable to load records. Please check your connection.
                        <br><button type="button" class="btn btn-sm btn-outline-primary mt-2 retry-fetch-btn">
                            <i class="bi bi-arrow-clockwise me-1"></i> Retry
                        </button>
                    </td></tr>
                `;
            }
        }
    }
}

// ==========================================
// Dynamic Stats & Canvas Pie Chart
// ==========================================
function updateStats() {
    const counts = { Completed: 0, 'In Progress': 0, Pending: 0 };
    allRecords.forEach(r => {
        if (r['Status'] in counts) counts[r['Status']]++;
    });

    const totalEl = document.getElementById('totalCount');
    const compEl = document.getElementById('completedCount');
    const progEl = document.getElementById('inProgressCount');
    const pendEl = document.getElementById('pendingCount');

    if (totalEl) totalEl.innerText = allRecords.length;
    if (compEl) compEl.innerText = counts.Completed;
    if (progEl) progEl.innerText = counts['In Progress'];
    if (pendEl) pendEl.innerText = counts.Pending;

    drawStatusPieChart();
}

function drawStatusPieChart() {
    const canvas = document.getElementById('statusPieChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displaySize = 130;

    if (canvas.width !== displaySize * dpr || canvas.height !== displaySize * dpr) {
        canvas.width = displaySize * dpr;
        canvas.height = displaySize * dpr;
        canvas.style.width = displaySize + 'px';
        canvas.style.height = displaySize + 'px';
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, displaySize, displaySize);

    const counts = { Completed: 0, 'In Progress': 0, Pending: 0 };
    allRecords.forEach(r => {
        if (r['Status'] in counts) counts[r['Status']]++;
    });

    const total = allRecords.length;
    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';

    const centerX = displaySize / 2;
    const centerY = displaySize / 2;
    const radius = 54;
    const innerRadius = 38;

    if (total === 0) {
        // Draw subtle ring for empty state
        ctx.beginPath();
        ctx.arc(centerX, centerY, (radius + innerRadius) / 2, 0, 2 * Math.PI);
        ctx.strokeStyle = isDark ? '#30363d' : '#e9ecef';
        ctx.lineWidth = radius - innerRadius;
        ctx.stroke();

        ctx.fillStyle = isDark ? '#8b949e' : '#adb5bd';
        ctx.font = '600 11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No Data', centerX, centerY);
        ctx.restore();
        return;
    }

    const segments = [
        { label: 'Completed', count: counts.Completed, color: isDark ? '#20c997' : '#198754' },
        { label: 'In Progress', count: counts['In Progress'], color: isDark ? '#38bdf8' : '#0d6efd' },
        { label: 'Pending', count: counts.Pending, color: isDark ? '#f87171' : '#dc3545' }
    ];

    let startAngle = -Math.PI / 2;

    segments.forEach(segment => {
        if (segment.count <= 0) return;
        const sliceAngle = (segment.count / total) * 2 * Math.PI;
        const endAngle = startAngle + sliceAngle;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.arc(centerX, centerY, innerRadius, endAngle, startAngle, true);
        ctx.closePath();

        ctx.fillStyle = segment.color;
        ctx.fill();

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = isDark ? '#212529' : '#ffffff';
        ctx.stroke();

        startAngle = endAngle;
    });

    // Donut Center Text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = isDark ? '#f0f6fc' : '#212529';
    ctx.font = 'bold 18px Inter, system-ui, sans-serif';
    ctx.fillText(total.toString(), centerX, centerY - 6);

    ctx.fillStyle = isDark ? '#8b949e' : '#6c757d';
    ctx.font = '600 9px Inter, system-ui, sans-serif';
    ctx.fillText('TOTAL', centerX, centerY + 11);

    ctx.restore();
}

// ==========================================
// Filtering, Searching, & Rendering
// ==========================================
function applyFiltersAndRender() {
    if (currentFilter === 'all') {
        filteredRecords = [...allRecords];
    } else {
        filteredRecords = allRecords.filter(r => r['Status'] === currentFilter);
    }

    if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filteredRecords = filteredRecords.filter(r => {
            const rowString = Object.values(r).join(' ').toLowerCase();
            return rowString.includes(query);
        });
    }

    const maxPage = Math.ceil(filteredRecords.length / recordsPerPage) || 1;
    if (currentPage > maxPage) {
        currentPage = 1;
    }

    renderTable();
    renderPagination();
}

// XSS Sanitizer: Encodes HTML entities
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function renderTable() {
    const tableBody = document.getElementById('tableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (filteredRecords.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-muted">No records found matching your criteria.</td></tr>`;
        return;
    }

    const startIndex = (currentPage - 1) * recordsPerPage;
    const endIndex = startIndex + recordsPerPage;
    const paginatedData = filteredRecords.slice(startIndex, endIndex);

    // High performance DOM batch insertion via DocumentFragment
    const fragment = document.createDocumentFragment();

    paginatedData.forEach((row, index) => {
        let reqDate = row['Request Date'] || 'N/A';
        if (reqDate && reqDate.includes('-')) {
            const dateObj = new Date(reqDate);
            if (!isNaN(dateObj.getTime())) {
                reqDate = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
            }
        }

        const rawActionBy = row['Action Taken By'] || 'Unknown';
        const actionBy = escapeHtml(rawActionBy);
        const initials = escapeHtml(rawActionBy.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase());

        const rawProblem = row['Problem Statement / Objective'] || 'N/A';
        const problem = escapeHtml(rawProblem);
        const shortProblem = escapeHtml(rawProblem.length > 30 ? rawProblem.substring(0, 30) + '...' : rawProblem);

        const rawId = row['Reference Number/Ticket Number'] || '';
        const displayId = escapeHtml(rawId ? rawId : 'N/A');

        const receivedCount = row['Received Count'] || '-';
        const formattedCount = escapeHtml(
            (receivedCount !== '-' && !isNaN(receivedCount) && String(receivedCount).trim() !== '')
                ? Number(receivedCount).toLocaleString()
                : String(receivedCount)
        );

        const status = row['Status'] || 'Pending';
        let statusBadge = '';
        if (status === 'Completed') {
            statusBadge = `<span class="badge bg-success-subtle text-success border border-success px-2 py-1">Completed</span>`;
        } else if (status === 'In Progress') {
            statusBadge = `<span class="badge bg-primary-subtle text-primary border border-primary px-2 py-1">In Progress</span>`;
        } else {
            statusBadge = `<span class="badge bg-danger-subtle text-danger border border-danger px-2 py-1">Pending</span>`;
        }

        const editAction = rawId
            ? `<a href="/index?edit=${encodeURIComponent(rawId)}" class="text-primary fw-semibold text-decoration-none action-btn">View/Edit</a>`
            : `<button type="button" class="btn btn-link p-0 text-muted fw-semibold text-decoration-none missing-id-btn">Edit</button>`;

        const department = escapeHtml(row['Requested Department'] || 'N/A');
        const letterRef = escapeHtml(row['Letter / Email Reference'] || '-');
        const sharedMode = escapeHtml(row['Result Shared Mode'] || '-');

        const tr = document.createElement('tr');
        tr.className = 'animate-row';
        tr.style.animationDelay = `${Math.min(index * 0.05, 0.4)}s`;

        tr.innerHTML = `
            <td class="px-4 ${rawId ? 'text-primary' : 'text-muted'} fw-semibold">${displayId}</td>
            <td class="fw-semibold">${department}</td>
            <td>${reqDate}</td>
            <td class="text-muted">${letterRef}</td>
            <td><span class="badge bg-body-secondary text-body border me-2">${initials}</span> ${actionBy}</td>
            <td class="text-truncate" style="max-width: 200px;" title="${problem}">${shortProblem}</td>
            <td class="text-muted">${formattedCount}</td>
            <td class="text-muted">${sharedMode}</td>
            <td>${statusBadge}</td>
            <td class="text-end px-4">${editAction}</td>
        `;
        fragment.appendChild(tr);
    });

    tableBody.appendChild(fragment);
}

// Table Event Delegation (CSP Safe: no inline onclick handlers)
function setupTableDelegation() {
    const tableBody = document.getElementById('tableBody');
    if (!tableBody) return;

    tableBody.addEventListener('click', (e) => {
        const retryBtn = e.target.closest('.retry-fetch-btn');
        if (retryBtn) {
            e.preventDefault();
            loadFromCacheOrFetch();
            return;
        }

        const missingIdBtn = e.target.closest('.missing-id-btn');
        if (missingIdBtn) {
            e.preventDefault();
            showToast('Cannot edit: Missing Reference Number.', 'warning');
            return;
        }
    });
}

// ==========================================
// UI Controls (Filters, Badges, Search, Pagination)
// ==========================================
function setupFilters() {
    const filterGroup = document.getElementById('filterGroup');
    if (!filterGroup) return;

    filterGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (btn) {
            filterGroup.querySelectorAll('button').forEach(b => {
                b.classList.remove('btn-white', 'active', 'fw-semibold');
                b.classList.add('btn-light', 'text-muted');
            });
            btn.classList.remove('btn-light', 'text-muted');
            btn.classList.add('btn-white', 'active', 'fw-semibold');

            currentFilter = btn.getAttribute('data-filter') || 'all';
            currentPage = 1;
            applyFiltersAndRender();
        }
    });
}

// Interactive Dynamic Stats Badges: Clicking a badge filters table
function setupBadgeFilters() {
    document.querySelectorAll('.stat-badge[data-filter]').forEach(badge => {
        badge.style.cursor = 'pointer';
        badge.addEventListener('click', () => {
            const filterValue = badge.getAttribute('data-filter');
            if (!filterValue) return;

            // Sync with filterGroup buttons
            const filterGroup = document.getElementById('filterGroup');
            if (filterGroup) {
                const targetBtn = filterGroup.querySelector(`button[data-filter="${filterValue}"]`);
                if (targetBtn) {
                    targetBtn.click();
                    return;
                }
            }

            currentFilter = filterValue;
            currentPage = 1;
            applyFiltersAndRender();
        });
    });
}

function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            searchQuery = e.target.value.trim();
            currentPage = 1;
            applyFiltersAndRender();
        }, 300);
    });
}

function renderPagination() {
    const paginationText = document.getElementById('paginationText');
    const paginationControls = document.getElementById('paginationControls');
    if (!paginationText || !paginationControls) return;

    const totalFiltered = filteredRecords.length;
    const totalPages = Math.ceil(totalFiltered / recordsPerPage) || 1;

    const startIndex = (currentPage - 1) * recordsPerPage;
    const endIndex = Math.min(startIndex + recordsPerPage, totalFiltered);

    if (totalFiltered === 0) {
        paginationText.innerText = 'Showing 0 to 0 of 0 requests';
        paginationControls.innerHTML = '';
        return;
    }

    paginationText.innerText = `Showing ${startIndex + 1} to ${endIndex} of ${totalFiltered} requests`;

    let html = '';
    html += `<li class="page-item ${currentPage === 1 ? 'disabled' : ''}"><a class="page-link" href="#" data-page="${currentPage - 1}">Previous</a></li>`;

    const getPageNumbers = (current, total) => {
        if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
        const pages = [1];
        let start = Math.max(2, current - 1);
        let end = Math.min(total - 1, current + 1);
        if (current <= 3) { start = 2; end = 4; }
        if (current >= total - 2) { start = total - 3; end = total - 1; }
        if (start > 2) pages.push('...');
        for (let i = start; i <= end; i++) pages.push(i);
        if (end < total - 1) pages.push('...');
        pages.push(total);
        return pages;
    };

    getPageNumbers(currentPage, totalPages).forEach(p => {
        if (p === '...') {
            html += `<li class="page-item disabled"><span class="page-link">&hellip;</span></li>`;
        } else {
            html += `<li class="page-item ${currentPage === p ? 'active' : ''}"><a class="page-link" href="#" data-page="${p}">${p}</a></li>`;
        }
    });

    html += `<li class="page-item ${currentPage === totalPages ? 'disabled' : ''}"><a class="page-link" href="#" data-page="${currentPage + 1}">Next</a></li>`;

    paginationControls.innerHTML = html;

    paginationControls.querySelectorAll('.page-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = parseInt(e.currentTarget.getAttribute('data-page'), 10);
            if (page >= 1 && page <= totalPages && page !== currentPage) {
                currentPage = page;
                applyFiltersAndRender();
            }
        });
    });
}

// ==========================================
// Form Logic (Create & Edit Mode)
// ==========================================
function setupFormLogic(form) {
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    const submitBtn = document.getElementById('submitBtn');
    const refNumberInput = document.getElementById('refNumberInput');
    const overlay = document.getElementById('formLoadingOverlay');
    const cancelBtn = document.getElementById('cancelLoadBtn');

    if (editId && editId !== 'undefined' && editId !== 'N/A') {
        const titleEl = document.getElementById('formTitle');
        const subTitleEl = document.getElementById('formSubtitle');
        if (titleEl) titleEl.innerText = 'Edit Data Request';
        if (subTitleEl) subTitleEl.innerText = 'Update the fields below to modify the request in the registry.';
        if (submitBtn) submitBtn.innerHTML = '<i class="bi bi-save me-2"></i> Update Request';
        if (refNumberInput) refNumberInput.value = editId;

        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = 'originalId';
        hiddenInput.value = editId;
        form.appendChild(hiddenInput);

        if (overlay) {
            overlay.classList.remove('d-none');
            overlay.style.display = 'flex';
        }

        const cancelTimer = setTimeout(() => {
            if (cancelBtn) cancelBtn.classList.remove('d-none');
        }, 6000);

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                window.location.replace('/form');
            });
        }

        const finishLoading = (record) => {
            if (record) populateForm(form, record);
            clearTimeout(cancelTimer);
            if (overlay) {
                overlay.style.transition = 'opacity 0.3s ease';
                overlay.style.opacity = '0';
                setTimeout(() => {
                    overlay.classList.add('d-none');
                    overlay.style.display = 'none';
                    overlay.style.opacity = '1';
                }, 300);
            }
        };

        // Cache first
        const cached = getFromCache();
        if (cached) {
            const record = cached.find(r => String(r['Reference Number/Ticket Number']) === String(editId));
            if (record) {
                setTimeout(() => finishLoading(record), 200);
            }
        }

        // Fetch single record
        fetchWithRetry(scriptURL + '?action=get_one&id=' + encodeURIComponent(editId), {}, 3, 500)
            .then(record => {
                if (record && !record.error) {
                    if (overlay && !overlay.classList.contains('d-none')) {
                        finishLoading(record);
                    }
                } else {
                    showToast('Record not found in database!', 'error');
                    setTimeout(() => window.location.replace('/form'), 1500);
                }
            })
            .catch(err => {
                console.error('Error fetching record for edit:', err);
                if (overlay && !overlay.classList.contains('d-none')) {
                    showToast('Failed to load record. Please try again.', 'error');
                    setTimeout(() => window.location.replace('/form'), 1500);
                }
            });
    } else {
        if (refNumberInput) {
            refNumberInput.value = '';
            refNumberInput.placeholder = 'Auto-generated on save';
        }
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const originalBtnText = submitBtn ? submitBtn.innerHTML : 'Submit';
        if (submitBtn) {
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Saving...';
            submitBtn.disabled = true;
        }

        const formData = new FormData(form);
        const urlEncodedData = new URLSearchParams(formData);
        const actionType = urlEncodedData.has('originalId') ? 'update' : 'add';
        urlEncodedData.append('action', actionType);
        urlEncodedData.append('Logged In User', sessionStorage.getItem('ops_portal_user') || 'Unknown');

        try {
            const response = await fetch(scriptURL, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + (sessionStorage.getItem('ops_portal_token') || '')
                },
                body: urlEncodedData
            });

            if (response.status === 401) {
                sessionStorage.removeItem('ops_portal_token');
                sessionStorage.removeItem('ops_portal_user');
                sessionStorage.removeItem(CACHE_KEY);
                showToast('Session expired. Redirecting to login...', 'warning');
                setTimeout(() => window.location.replace('/login?timeout=true'), 1500);
                return;
            }

            const result = await response.json();

            if (result && result.result === 'success') {
                clearCache();
                const msg = actionType === 'add'
                    ? `Request submitted successfully! Generated ID: ${result.id}`
                    : 'Request updated successfully!';
                showToast(msg, 'success');
                setTimeout(() => window.location.replace('/form'), 1000);
            } else {
                showToast('Error: ' + (result?.error || 'Failed to save record.'), 'error');
            }
        } catch (error) {
            console.error('Submit error:', error);
            showToast('Network error. Please check your connection.', 'error');
        } finally {
            if (submitBtn) {
                submitBtn.innerHTML = originalBtnText;
                submitBtn.disabled = false;
            }
        }
    });

    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            form.reset();
            if (editId && editId !== 'undefined' && editId !== 'N/A' && refNumberInput) {
                refNumberInput.value = editId;
            }
        });
    }
}

function populateForm(form, record) {
    const fieldsToFill = [
        'Requested Department', 'Request Date', 'Letter / Email Reference',
        'Action Taken By', 'Problem Statement / Objective', 'Datasets Used',
        'Date for Data Dump', 'Received Count', 'Result Shared Mode', 'Analysis Outcome',
        'Status', 'Savings'
    ];

    fieldsToFill.forEach(field => {
        const input = form.elements[field];
        if (input && record[field] !== undefined && record[field] !== null) {
            if (input.type === 'date') {
                input.value = formatDateForInput(record[field]);
            } else {
                input.value = record[field];
            }
        }
    });
}

function formatDateForInput(dateStr) {
    if (!dateStr) return '';
    const str = String(dateStr).trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        return str;
    }

    const d = new Date(str);
    if (isNaN(d.getTime())) return '';

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ==========================================
// CSV Export with Formula Injection Guard
// ==========================================
function formatValueForCSV(key, value) {
    if (value === null || value === undefined) return '';
    let strValue = String(value);

    // Prevent CSV formula injection in spreadsheet applications
    if (/^[=+\-@\t\r]/.test(strValue)) {
        strValue = "'" + strValue;
    }

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(strValue)) {
        const d = new Date(strValue);
        if (isNaN(d.getTime())) return strValue;

        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();

        if (key === 'Timestamp') {
            let hours = d.getHours();
            const minutes = String(d.getMinutes()).padStart(2, '0');
            const seconds = String(d.getSeconds()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
            return `${day}-${month}-${year} ${String(hours).padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;
        }
        return `${day}-${month}-${year}`;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(strValue)) {
        const parts = strValue.split('-');
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }

    return strValue;
}

function setupDownloadButton() {
    const downloadBtn = document.getElementById('downloadBtn');
    if (!downloadBtn) return;

    downloadBtn.addEventListener('click', () => {
        if (allRecords.length === 0) {
            showToast('No data available to download.', 'warning');
            return;
        }

        const allHeaders = Object.keys(allRecords[0]);
        const headers = allHeaders.filter(h => h !== 'Timestamp');

        const csvRows = [];
        csvRows.push(headers.map(header => `"${header}"`).join(','));

        allRecords.forEach(record => {
            const values = headers.map(header => {
                let val = record[header] || '';
                val = formatValueForCSV(header, val);
                val = String(val).replaceAll('"', '""');
                return `"${val}"`;
            });
            csvRows.push(values.join(','));
        });

        const csvString = '\uFEFF' + csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        const date = new Date();
        const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

        link.setAttribute('href', url);
        link.setAttribute('download', `Data_Purity_Records_${dateString}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(url);
        showToast('Download started successfully!', 'success');
    });
}