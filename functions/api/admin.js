import {
    verifyToken,
    hashPassword,
    hashIdentifier,
    encryptText,
    decryptText,
    validatePasswordStrength,
    nowIST,
    getClientIP,
    logAudit,
    secureJson,
    ensureRbacSchema
} from '../_lib/security.js';

const VALID_ROLES = ['admin', 'user'];
const VALID_STATUSES = ['active', 'inactive'];

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const clientIP = getClientIP(request);

    // CSRF check for POST
    if (request.method === 'POST') {
        const origin = request.headers.get('Origin');
        if (!origin || new URL(origin).host !== url.host) {
            return secureJson({ error: 'Forbidden.' }, 403);
        }
    }

    // Verify encrypted token & enforce admin role
    const authHeader = request.headers.get('Authorization');
    const tokenPayload = await verifyToken(authHeader, env);

    if (!tokenPayload || !tokenPayload.user) {
        return secureJson({ error: 'Unauthorized. Please log in.' }, 401);
    }

    if (tokenPayload.role !== 'admin') {
        return secureJson({ error: 'Forbidden. Administrator access required.' }, 403);
    }

    if (!env.DB) {
        return secureJson({ error: 'Database binding (DB) is not configured.' }, 500);
    }

    const secret = env.AUTH_SECRET || '';
    await ensureRbacSchema(env.DB);

    try {
        // ================================
        // GET Requests
        // ================================
        if (request.method === 'GET') {
            const action = url.searchParams.get('action');

            if (action === 'list_users') {
                const { results } = await env.DB.prepare(
                    'SELECT id, username, display_name, role, status, created_at, updated_at FROM users ORDER BY id ASC'
                ).all();

                const users = await Promise.all((results || []).map(async (u) => ({
                    id: u.id,
                    username: await decryptText(u.username, secret),
                    display_name: await decryptText(u.display_name, secret),
                    role: u.role,
                    status: u.status,
                    created_at: u.created_at,
                    updated_at: u.updated_at
                })));

                return secureJson({ users });
            }

            if (action === 'logs') {
                const usernameFilter = (url.searchParams.get('username') || '').trim().toLowerCase();
                const actionFilter = (url.searchParams.get('action_filter') || '').trim();
                const limitParam = parseInt(url.searchParams.get('limit') || '200', 10);
                const limit = isNaN(limitParam) ? 200 : Math.min(Math.max(limitParam, 1), 500);

                const conditions = [];
                const bindings = [];

                if (actionFilter) {
                    conditions.push('action = ?');
                    bindings.push(actionFilter);
                }

                const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
                const fetchLimit = usernameFilter ? 500 : limit;
                const query = `SELECT id, user_id, username, action, target_type, target_id, details, ip_address, timestamp FROM audit_logs ${whereClause} ORDER BY id DESC LIMIT ?`;
                bindings.push(fetchLimit);

                const { results } = await env.DB.prepare(query).bind(...bindings).all();

                let logs = await Promise.all((results || []).map(async (log) => ({
                    id: log.id,
                    user_id: log.user_id,
                    username: await decryptText(log.username, secret),
                    action: log.action,
                    target_type: log.target_type,
                    target_id: log.target_id,
                    details: log.details ? await decryptText(log.details, secret) : null,
                    ip_address: log.ip_address ? await decryptText(log.ip_address, secret) : null,
                    timestamp: log.timestamp
                })));

                if (usernameFilter) {
                    logs = logs.filter(l => (l.username || '').toLowerCase().includes(usernameFilter)).slice(0, limit);
                }

                return secureJson({ logs });
            }

            return secureJson({ error: 'Invalid GET action.' }, 400);
        }

        // ================================
        // POST Requests (JSON)
        // ================================
        if (request.method === 'POST') {
            const body = await request.json();
            const action = body.action;
            const timestamp = nowIST();

            // ----- CREATE USER -----
            if (action === 'create_user') {
                const username = typeof body.username === 'string' ? body.username.trim() : '';
                const password = typeof body.password === 'string' ? body.password : '';
                const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
                const role = VALID_ROLES.includes(body.role) ? body.role : 'user';

                if (!username || username.length < 3 || username.length > 50 || !/^[a-zA-Z0-9._-]+$/.test(username)) {
                    return secureJson(
                        { error: 'Username must be 3-50 characters (letters, numbers, ., _, - only).' },
                        400
                    );
                }

                const strengthErr = validatePasswordStrength(password);
                if (strengthErr) {
                    return secureJson({ error: strengthErr }, 400);
                }

                if (!displayName || displayName.length < 2 || displayName.length > 100) {
                    return secureJson({ error: 'Display Name (Action Taken By) is required.' }, 400);
                }

                const unameHash = await hashIdentifier(username, secret);
                const existing = await env.DB.prepare(
                    'SELECT id FROM users WHERE username_hash = ? OR LOWER(username) = LOWER(?)'
                ).bind(unameHash, username).first();

                if (existing) {
                    return secureJson({ error: 'Username already exists.' }, 409);
                }

                const encUsername = await encryptText(username, secret);
                const encDisplayName = await encryptText(displayName, secret);
                const passwordHash = await hashPassword(password, secret);

                const result = await env.DB.prepare(
                    `INSERT INTO users (username_hash, username, password, display_name, role, status, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
                ).bind(unameHash, encUsername, passwordHash, encDisplayName, role, timestamp, timestamp).run();

                const newId = result?.meta?.last_row_id || null;

                await logAudit(env, {
                    userId: tokenPayload.userId || 0,
                    username: tokenPayload.user,
                    action: 'create_user',
                    targetType: 'user',
                    targetId: newId ? String(newId) : username,
                    details: { created_username: username, display_name: displayName, role },
                    ipAddress: clientIP
                });

                return secureJson({ success: true, message: `User "${username}" created.`, id: newId });
            }

            // ----- UPDATE USER -----
            if (action === 'update_user') {
                const id = parseInt(body.id, 10);
                if (isNaN(id) || id <= 0) {
                    return secureJson({ error: 'Valid user id is required.' }, 400);
                }

                const target = await env.DB.prepare(
                    'SELECT id, username, display_name, role, status FROM users WHERE id = ?'
                ).bind(id).first();

                if (!target) {
                    return secureJson({ error: 'User not found.' }, 404);
                }

                const targetPlainUsername = await decryptText(target.username, secret);
                const targetPlainDisplay = await decryptText(target.display_name, secret);

                const displayName = typeof body.displayName === 'string' && body.displayName.trim()
                    ? body.displayName.trim()
                    : targetPlainDisplay;
                const role = VALID_ROLES.includes(body.role) ? body.role : target.role;
                const status = VALID_STATUSES.includes(body.status) ? body.status : target.status;
                const newPassword = typeof body.password === 'string' ? body.password : '';

                if (tokenPayload.userId && id === tokenPayload.userId) {
                    if (status !== 'active' || role !== 'admin') {
                        return secureJson(
                            { error: 'You cannot deactivate or demote your own admin account.' },
                            400
                        );
                    }
                }

                const encDisplayName = await encryptText(displayName, secret);

                if (newPassword) {
                    const strengthErr = validatePasswordStrength(newPassword);
                    if (strengthErr) {
                        return secureJson({ error: strengthErr }, 400);
                    }
                    const passwordHash = await hashPassword(newPassword, secret);
                    await env.DB.prepare(
                        'UPDATE users SET display_name = ?, role = ?, status = ?, password = ?, updated_at = ? WHERE id = ?'
                    ).bind(encDisplayName, role, status, passwordHash, timestamp, id).run();
                } else {
                    await env.DB.prepare(
                        'UPDATE users SET display_name = ?, role = ?, status = ?, updated_at = ? WHERE id = ?'
                    ).bind(encDisplayName, role, status, timestamp, id).run();
                }

                await logAudit(env, {
                    userId: tokenPayload.userId || 0,
                    username: tokenPayload.user,
                    action: 'update_user',
                    targetType: 'user',
                    targetId: String(id),
                    details: {
                        target_username: targetPlainUsername,
                        display_name: displayName,
                        role,
                        status,
                        password_reset: Boolean(newPassword)
                    },
                    ipAddress: clientIP
                });

                return secureJson({ success: true, message: `User "${targetPlainUsername}" updated.` });
            }

            // ----- DELETE / DEACTIVATE USER -----
            if (action === 'delete_user') {
                const id = parseInt(body.id, 10);
                if (isNaN(id) || id <= 0) {
                    return secureJson({ error: 'Valid user id is required.' }, 400);
                }

                if (tokenPayload.userId && id === tokenPayload.userId) {
                    return secureJson(
                        { error: 'You cannot delete or deactivate your own account.' },
                        400
                    );
                }

                const target = await env.DB.prepare(
                    'SELECT id, username, status FROM users WHERE id = ?'
                ).bind(id).first();

                if (!target) {
                    return secureJson({ error: 'User not found.' }, 404);
                }

                const targetPlainUsername = await decryptText(target.username, secret);
                const permanent = body.permanent === true;

                if (permanent) {
                    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
                } else {
                    await env.DB.prepare(
                        "UPDATE users SET status = 'inactive', updated_at = ? WHERE id = ?"
                    ).bind(timestamp, id).run();
                }

                await logAudit(env, {
                    userId: tokenPayload.userId || 0,
                    username: tokenPayload.user,
                    action: 'delete_user',
                    targetType: 'user',
                    targetId: String(id),
                    details: {
                        target_username: targetPlainUsername,
                        mode: permanent ? 'permanent' : 'soft_deactivate'
                    },
                    ipAddress: clientIP
                });

                return secureJson({
                    success: true,
                    message: permanent
                        ? `User "${targetPlainUsername}" permanently deleted.`
                        : `User "${targetPlainUsername}" deactivated.`
                });
            }

            return secureJson({ error: 'Invalid POST action.' }, 400);
        }

        return secureJson({ error: 'Method Not Allowed' }, 405);
    } catch (error) {
        console.error('Admin API error:', error);
        return secureJson({ error: 'An unexpected error occurred.' }, 500);
    }
}
