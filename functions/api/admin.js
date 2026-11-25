import {
    verifyToken,
    hashPassword,
    nowIST,
    getClientIP,
    logAudit
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
            return Response.json({ error: 'Forbidden.' }, { status: 403 });
        }
    }

    // Verify token & enforce admin role
    const authHeader = request.headers.get('Authorization');
    const tokenPayload = await verifyToken(authHeader, env);

    if (!tokenPayload || !tokenPayload.user) {
        return Response.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    if (tokenPayload.role !== 'admin') {
        return Response.json({ error: 'Forbidden. Administrator access required.' }, { status: 403 });
    }

    if (!env.DB) {
        return Response.json({ error: 'Database binding (DB) is not configured.' }, { status: 500 });
    }

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
                return Response.json({ users: results || [] });
            }

            if (action === 'logs') {
                const usernameFilter = (url.searchParams.get('username') || '').trim();
                const actionFilter = (url.searchParams.get('action_filter') || '').trim();
                const limitParam = parseInt(url.searchParams.get('limit') || '200', 10);
                const limit = isNaN(limitParam) ? 200 : Math.min(Math.max(limitParam, 1), 500);

                const conditions = [];
                const bindings = [];

                if (usernameFilter) {
                    conditions.push('LOWER(username) LIKE LOWER(?)');
                    bindings.push(`%${usernameFilter}%`);
                }
                if (actionFilter) {
                    conditions.push('action = ?');
                    bindings.push(actionFilter);
                }

                const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
                const query = `SELECT id, user_id, username, action, target_type, target_id, details, ip_address, timestamp FROM audit_logs ${whereClause} ORDER BY id DESC LIMIT ?`;
                bindings.push(limit);

                const { results } = await env.DB.prepare(query).bind(...bindings).all();
                return Response.json({ logs: results || [] });
            }

            return Response.json({ error: 'Invalid GET action.' }, { status: 400 });
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
                    return Response.json(
                        { error: 'Username must be 3-50 characters (letters, numbers, ., _, - only).' },
                        { status: 400 }
                    );
                }
                if (!password || password.length < 6) {
                    return Response.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
                }
                if (!displayName || displayName.length < 2 || displayName.length > 100) {
                    return Response.json({ error: 'Display Name (Action Taken By) is required.' }, { status: 400 });
                }

                const existing = await env.DB.prepare(
                    'SELECT id FROM users WHERE LOWER(username) = LOWER(?)'
                ).bind(username).first();

                if (existing) {
                    return Response.json({ error: 'Username already exists.' }, { status: 409 });
                }

                const passwordHash = await hashPassword(password);
                const result = await env.DB.prepare(
                    `INSERT INTO users (username, password, display_name, role, status, created_at, updated_at)
                     VALUES (?, ?, ?, ?, 'active', ?, ?)`
                ).bind(username, passwordHash, displayName, role, timestamp, timestamp).run();

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

                return Response.json({ success: true, message: `User "${username}" created.`, id: newId });
            }

            // ----- UPDATE USER -----
            if (action === 'update_user') {
                const id = parseInt(body.id, 10);
                if (isNaN(id) || id <= 0) {
                    return Response.json({ error: 'Valid user id is required.' }, { status: 400 });
                }

                const target = await env.DB.prepare(
                    'SELECT id, username, display_name, role, status FROM users WHERE id = ?'
                ).bind(id).first();

                if (!target) {
                    return Response.json({ error: 'User not found.' }, { status: 404 });
                }

                const displayName = typeof body.displayName === 'string' && body.displayName.trim()
                    ? body.displayName.trim()
                    : target.display_name;
                const role = VALID_ROLES.includes(body.role) ? body.role : target.role;
                const status = VALID_STATUSES.includes(body.status) ? body.status : target.status;
                const newPassword = typeof body.password === 'string' ? body.password : '';

                // Prevent logged-in admin from locking themselves out
                if (tokenPayload.userId && id === tokenPayload.userId) {
                    if (status !== 'active' || role !== 'admin') {
                        return Response.json(
                            { error: 'You cannot deactivate or demote your own admin account.' },
                            { status: 400 }
                        );
                    }
                }

                if (newPassword) {
                    if (newPassword.length < 6) {
                        return Response.json({ error: 'New password must be at least 6 characters.' }, { status: 400 });
                    }
                    const passwordHash = await hashPassword(newPassword);
                    await env.DB.prepare(
                        'UPDATE users SET display_name = ?, role = ?, status = ?, password = ?, updated_at = ? WHERE id = ?'
                    ).bind(displayName, role, status, passwordHash, timestamp, id).run();
                } else {
                    await env.DB.prepare(
                        'UPDATE users SET display_name = ?, role = ?, status = ?, updated_at = ? WHERE id = ?'
                    ).bind(displayName, role, status, timestamp, id).run();
                }

                await logAudit(env, {
                    userId: tokenPayload.userId || 0,
                    username: tokenPayload.user,
                    action: 'update_user',
                    targetType: 'user',
                    targetId: String(id),
                    details: {
                        target_username: target.username,
                        display_name: displayName,
                        role,
                        status,
                        password_reset: Boolean(newPassword)
                    },
                    ipAddress: clientIP
                });

                return Response.json({ success: true, message: `User "${target.username}" updated.` });
            }

            // ----- DELETE / DEACTIVATE USER -----
            if (action === 'delete_user') {
                const id = parseInt(body.id, 10);
                if (isNaN(id) || id <= 0) {
                    return Response.json({ error: 'Valid user id is required.' }, { status: 400 });
                }

                if (tokenPayload.userId && id === tokenPayload.userId) {
                    return Response.json(
                        { error: 'You cannot delete or deactivate your own account.' },
                        { status: 400 }
                    );
                }

                const target = await env.DB.prepare(
                    'SELECT id, username, display_name, status FROM users WHERE id = ?'
                ).bind(id).first();

                if (!target) {
                    return Response.json({ error: 'User not found.' }, { status: 404 });
                }

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
                        target_username: target.username,
                        mode: permanent ? 'permanent' : 'soft_deactivate'
                    },
                    ipAddress: clientIP
                });

                return Response.json({
                    success: true,
                    message: permanent
                        ? `User "${target.username}" permanently deleted.`
                        : `User "${target.username}" deactivated.`
                });
            }

            return Response.json({ error: 'Invalid POST action.' }, { status: 400 });
        }

        return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    } catch (error) {
        console.error('Admin API error:', error);
        return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
    }
}

