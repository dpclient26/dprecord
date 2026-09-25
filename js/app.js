// ==========================================
// 1. DB Integration Setup
// ==========================================
const scriptURL = '/api/cfdb';

// Global State
let allRecords = [];
let filteredRecords = [];
let currentPage = 1;
const recordsPerPage = 10;
let currentFilter = 'all';
let searchQuery = '';

// Cache Settings
const CACHE_KEY = 'ops_portal_records_cache';
const CACHE_TTL = 60 * 1000; // 60 seconds

document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('tableBody');
    if (tableBody) {
        loadFromCacheOrFetch(); // <-- New smart loader
        setupFilters();
        setupSearch();
        setupDownloadButton();
    }

    const form = document.getElementById('requestForm');
    if (form) setupFormLogic(form);

    // Display the logged-in user's name
    const user = sessionStorage.getItem('ops_portal_user');
    if (user && document.getElementById('currentUserDisplay')) {
        document.getElementById('currentUserDisplay').innerText = user;
    }
});

// ==========================================
// CACHE HELPERS
// ==========================================
function saveToCache(data) {
    try {
        const payload = { data: data, timestamp: Date.now() };
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (e) {
        console.warn("Cache save failed (probably quota):", e);
    }
}

function getFromCache() {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const payload = JSON.parse(raw);
        if (Date.now() - payload.timestamp > CACHE_TTL) return null; // Expired
        return payload.data;
    } catch (e) {
        return null;
    }
}

function clearCache() {
    sessionStorage.removeItem(CACHE_KEY);
}

// ==========================================
// SMART FETCH WITH RETRY (with Bearer token)
// ==========================================
async function fetchWithRetry(url, options = {}, retries = 3, delay = 500) {
    // Get the auth token from session
    const token = sessionStorage.getItem('ops_portal_token') || '';

    // Merge auth header into existing headers
    const headers = {
        ...(options.headers || {}),
        'Authorization': 'Bearer ' + token
    };

    const mergedOptions = { ...options, headers };

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, mergedOptions);

            // If backend says we're unauthorized, redirect to login immediately
            if (response.status === 401) {
                sessionStorage.removeItem('ops_portal_token');
                sessionStorage.removeItem('ops_portal_user');
                window.location.href = '/login?timeout=true';
                return;
            }

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            if (attempt === retries) throw error;
            await new Promise(r => setTimeout(r, delay * attempt));
        }
    }
}

// ==========================================
// 2. Load Data (Stale-While-Revalidate)
// ==========================================
async function loadFromCacheOrFetch() {
    const tableBody = document.getElementById('tableBody');
    const cached = getFromCache();

    // STEP 1: If we have cache, show it INSTANTLY
    if (cached && cached.length >= 0) {
        allRecords = [...cached];
        updateStats();
        applyFiltersAndRender();
        // Quietly refresh in background
        fetchAndRenderRecords(true);
    } else {
        // No cache - show loading and fetch
        tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-4"><div class="spinner-border text-primary" role="status"></div><br>Loading records...</td></tr>`;
        fetchAndRenderRecords(false);
    }
}

async function fetchAndRenderRecords(isBackgroundRefresh = false) {
    try {
        const data = await fetchWithRetry(scriptURL + "?action=get", {}, 3, 500);

        // Save fresh data to cache
        saveToCache(data);

        // Skip re-render if data hasn't changed (avoids duplicate rendering)
        if (isBackgroundRefresh && JSON.stringify(data) === JSON.stringify(allRecords)) {
            return;
        }

        // Update UI with fresh data
        allRecords = [...data];
        updateStats();
        applyFiltersAndRender();
    } catch (error) {
        console.error('Error fetching data:', error);
        // Only show error if we have nothing to display
        if (!isBackgroundRefresh || allRecords.length === 0) {
            document.getElementById('tableBody').innerHTML =
                `<tr><td colspan="9" class="text-center py-4 text-danger">
                    <i class="bi bi-exclamation-triangle me-2"></i>Unable to load records. Please check your connection and try again.
                    <br><button class="btn btn-sm btn-outline-primary mt-2" onclick="loadFromCacheOrFetch()">
                        <i class="bi bi-arrow-clockwise me-1"></i> Retry
                    </button>
                </td></tr>`;
        }
    }
}

function updateStats() {
    const counts = { Completed: 0, 'In Progress': 0, Pending: 0 };
    allRecords.forEach(r => { if (r['Status'] in counts) counts[r['Status']]++; });

    document.getElementById('totalCount').innerText = allRecords.length;
    document.getElementById('completedCount').innerText = counts.Completed;
    document.getElementById('inProgressCount').innerText = counts['In Progress'];
    document.getElementById('pendingCount').innerText = counts.Pending;
}

// ==========================================
// 3. Filtering, Searching, and Table Rendering
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

    if (currentPage > Math.ceil(filteredRecords.length / recordsPerPage)) {
        currentPage = 1;
    }

    renderTable();
    renderPagination();
}

// XSS Protection: Escape user-controlled data before inserting into HTML
function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function renderTable() {
    const tableBody = document.getElementById('tableBody');
    tableBody.innerHTML = '';

    if (filteredRecords.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-muted">No records found matching your criteria.</td></tr>`;
        return;
    }

    const startIndex = (currentPage - 1) * recordsPerPage;
    const endIndex = startIndex + recordsPerPage;
    const paginatedData = filteredRecords.slice(startIndex, endIndex);

    paginatedData.forEach((row, index) => {
        let reqDate = row['Request Date'] || 'N/A';
        if (reqDate && reqDate.includes('-')) {
            const dateObj = new Date(reqDate);
            reqDate = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        }

        const actionBy = escapeHtml(row['Action Taken By'] || 'Unknown');
        const initials = escapeHtml((row['Action Taken By'] || 'Unknown').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase());
        const problem = escapeHtml(row['Problem Statement / Objective'] || 'N/A');
        const rawProblem = row['Problem Statement / Objective'] || 'N/A';
        const shortProblem = escapeHtml(rawProblem.length > 30 ? rawProblem.substring(0, 30) + '...' : rawProblem);

        const rawId = row['Reference Number/Ticket Number'] || '';
        const displayId = escapeHtml(rawId ? rawId : 'N/A');

        // Format the Received Count with commas (e.g., 25000 -> 25,000)
        const receivedCount = row['Received Count'] || '-';
        const formattedCount = escapeHtml(
            (receivedCount !== '-' && !isNaN(receivedCount))
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
            : `<a href="#" class="text-muted fw-semibold text-decoration-none" onclick="alert('Cannot edit: Missing Reference Number.'); return false;">Edit</a>`;

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
            <td><span class="badge bg-light text-dark border me-2">${initials}</span> ${actionBy}</td>
            <td class="text-truncate" style="max-width: 200px;" title="${problem}">${shortProblem}</td>
            <td class="text-muted">${formattedCount}</td> 
            <td class="text-muted">${sharedMode}</td>
            <td>${statusBadge}</td>
            <td class="text-end px-4">${editAction}</td>
        `;
        tableBody.appendChild(tr);
    });
}

// ==========================================
// 4. UI Controls (Filters, Search, Pagination)
// ==========================================
function setupFilters() {
    const filterGroup = document.getElementById('filterGroup');
    if (!filterGroup) return;

    filterGroup.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            filterGroup.querySelectorAll('button').forEach(btn => {
                btn.classList.remove('btn-white', 'active', 'fw-semibold');
                btn.classList.add('btn-light', 'text-muted');
            });
            e.target.classList.remove('btn-light', 'text-muted');
            e.target.classList.add('btn-white', 'active', 'fw-semibold');

            currentFilter = e.target.getAttribute('data-filter');
            currentPage = 1;
            applyFiltersAndRender();
        }
    });
}

function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            searchQuery = e.target.value;
            currentPage = 1;
            applyFiltersAndRender();
        }, 300);
    });
}

function renderPagination() {
    const paginationText = document.getElementById('paginationText');
    const paginationControls = document.getElementById('paginationControls');

    const totalFiltered = filteredRecords.length;
    const totalPages = Math.ceil(totalFiltered / recordsPerPage) || 1;

    const startIndex = (currentPage - 1) * recordsPerPage;
    const endIndex = Math.min(startIndex + recordsPerPage, totalFiltered);

    if (totalFiltered === 0) {
        paginationText.innerText = "Showing 0 to 0 of 0 requests";
        paginationControls.innerHTML = '';
        return;
    }

    paginationText.innerText = `Showing ${startIndex + 1} to ${endIndex} of ${totalFiltered} requests`;

    let html = '';
    html += `<li class="page-item ${currentPage === 1 ? 'disabled' : ''}"><a class="page-link" href="#" data-page="${currentPage - 1}">Previous</a></li>`;

    // Ellipsis-based pagination for many pages
    const getPageNumbers = (current, total) => {
        if (total <= 7) return Array.from({length: total}, (_, i) => i + 1);
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
            const page = parseInt(e.target.getAttribute('data-page'));
            if (page >= 1 && page <= totalPages && page !== currentPage) {
                currentPage = page;
                applyFiltersAndRender();
            }
        });
    });
}

// ==========================================
// 5. Form Logic (Handles both Add and Edit)
// ==========================================
function setupFormLogic(form) {
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    const submitBtn = document.getElementById('submitBtn');
    const refNumberInput = document.getElementById('refNumberInput');
    const overlay = document.getElementById('formLoadingOverlay');
    const cancelBtn = document.getElementById('cancelLoadBtn');

    if (editId && editId !== 'undefined' && editId !== 'N/A') {
        document.getElementById('formTitle').innerText = 'Edit Data Request';
        document.getElementById('formSubtitle').innerText = 'Update the fields below to modify the request in the registry.';
        submitBtn.innerHTML = '<i class="bi bi-save me-2"></i> Update Request';

        refNumberInput.value = editId;

        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = 'originalId';
        hiddenInput.value = editId;
        form.appendChild(hiddenInput);

        // ✨ SHOW THE LOADING OVERLAY
        overlay.classList.remove('d-none');

        // After 4 seconds, show the "Cancel" button in case of slow network
        const cancelTimer = setTimeout(() => {
            cancelBtn.classList.remove('d-none');
        }, 10000);

        // Cancel button action
        cancelBtn.addEventListener('click', () => {
            window.location.href = '/form';
        });

        // Helper: Hide overlay and populate form
        const finishLoading = (record) => {
            if (record) populateForm(form, record);
            clearTimeout(cancelTimer);
            // Smooth fade out
            overlay.style.transition = 'opacity 0.3s ease';
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.classList.add('d-none');
                overlay.style.opacity = '1'; // Reset for next time
            }, 300);
        };

        // STRATEGY 1: Check sessionStorage cache first (INSTANT!)
        const cached = getFromCache();
        if (cached) {
            const record = cached.find(r => String(r['Reference Number/Ticket Number']) === String(editId));
            if (record) {
                // Keep overlay up for at least 300ms for a smooth experience
                setTimeout(() => finishLoading(record), 300);
            }
        }

        // STRATEGY 2: Fetch single record from server (efficient — no full table download)
        fetchWithRetry(scriptURL + "?action=get_one&id=" + encodeURIComponent(editId), {}, 3, 500)
            .then(record => {
                if (record && !record.error) {
                    // Only finish if not already finished (cache may have hit first)
                    if (!overlay.classList.contains('d-none')) {
                        finishLoading(record);
                    }
                } else {
                    alert("Record not found in database!");
                    window.location.href = '/index';
                }
            })
            .catch(err => {
                console.error("Error fetching record for edit:", err);
                // If we already loaded from cache, don't show an error
                if (!overlay.classList.contains('d-none')) {
                    alert("Failed to load record. Please try again.");
                    window.location.href = '/index';
                }
            });
    } else {
        refNumberInput.value = "";
        refNumberInput.placeholder = "Auto-generated on save";
    }

    form.addEventListener('submit', e => {
        e.preventDefault();
        const originalBtnText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Saving...';
        submitBtn.disabled = true;

        const formData = new FormData(form);
        const urlEncodedData = new URLSearchParams(formData);
        const actionType = urlEncodedData.has('originalId') ? 'update' : 'add';
        urlEncodedData.append('action', actionType);
        urlEncodedData.append('Logged In User', sessionStorage.getItem('ops_portal_user') || 'Unknown');

        fetch(scriptURL, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + (sessionStorage.getItem('ops_portal_token') || '')
            },
            body: urlEncodedData
        })
            .then(response => response.json())
            .then(result => {
                if (result.result === 'success') {
                    clearCache(); // Invalidate cache so fresh data loads on index
                    const msg = actionType === 'add'
                        ? `Request submitted successfully! Generated ID: ${result.id}`
                        : `Request updated successfully!`;
                    alert(msg);
                    window.location.href = '/index';
                } else {
                    alert('Error: ' + result.error);
                }
            })
            .catch(error => alert('Network error. check your connection.'))
            .finally(() => {
                submitBtn.innerHTML = originalBtnText;
                submitBtn.disabled = false;
            });
    });

    document.getElementById('clearBtn')?.addEventListener('click', () => {
        form.reset();
        if (editId && editId !== 'undefined' && editId !== 'N/A') {
            refNumberInput.value = editId;
        }
    });
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

// Helper: Format any date string to YYYY-MM-DD for HTML date inputs
// Uses LOCAL time to correctly handle IST (UTC+5:30) and other timezones
function formatDateForInput(dateStr) {
    if (!dateStr) return '';

    const str = String(dateStr).trim();

    // 1. Already a plain date like "2026-09-10" -> return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        return str;
    }

    // 2. ISO format with timezone like "2026-09-09T18:30:00.000Z"
    //    Convert through Date object and use LOCAL time methods
    //    (This is the fix for the "one day earlier" bug)
    const d = new Date(str);
    if (isNaN(d.getTime())) return '';

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ==========================================
// 6. Download Sheet (CSV) Functionality
// ==========================================
function formatValueForCSV(key, value) {
    if (value === null || value === undefined) return '';
    let strValue = String(value);

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
            alert("No data available to download.");
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
                val = String(val).replace(/"/g, '""');
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
    });
}