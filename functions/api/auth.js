import {
    constantTimeEquals,
    verifyPassword,
    signToken,
    getClientIP,
    logAudit
} from '../_lib/security.js';

// Rate limiter: Map<ip, { count, resetTime }>
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 5; // max attempts per window

function isRateLimited(ip) {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);

    if (!entry || now > entry.resetTime) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return false;
    }

    entry.count++;
    return entry.count > RATE_LIMIT_MAX;
}

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method !== 'POST') {
        return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    }

    const clientIP = getClientIP(request);
    if (isRateLimited(clientIP)) {
        return Response.json(
            { error: 'Too many login attempts. Please try again later.' },
            { status: 429 }
        );
    }

    try {
        const body = await request.json();
        const username = typeof body.username === 'string' ? body.username.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';

        if (!username || !password) {
            return Response.json({ success: false, error: 'Username and password are required.' }, { status: 400 });
        }

        if (!env.AUTH_SECRET) {
            return Response.json({ error: 'Server auth configuration error.' }, { status: 500 });
        }

        // 1. Check D1 users table first
        let dbUser = null;
        try {
            if (env.DB) {
                dbUser = await env.DB.prepare(
                    'SELECT id, username, password, display_name, role, status FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1'
                ).bind(username).first();
            }
        } catch (dbErr) {
            // If users table doesn't exist yet, fall back to env vars seamlessly
            console.warn('D1 users lookup skipped:', dbErr.message);
        }

        if (dbUser) {
            if (dbUser.status !== 'active') {
                await logAudit(env, {
                    userId: dbUser.id,
                    username: dbUser.username,
                    action: 'login_failed',
                    targetType: 'user',
                    targetId: dbUser.id,
                    details: { reason: 'inactive_account' },
                    ipAddress: clientIP
                });
                return Response.json(
                    { success: false, error: 'Account is inactive. Please contact the administrator.' },
                    { status: 403 }
                );
            }

            const passValid = await verifyPassword(password, dbUser.password);
            if (!passValid) {
                await logAudit(env, {
                    userId: dbUser.id,
                    username: dbUser.username,
                    action: 'login_failed',
                    targetType: 'user',
                    targetId: dbUser.id,
                    details: { reason: 'invalid_password' },
                    ipAddress: clientIP
                });
                return Response.json({ success: false, error: 'Invalid credentials' }, { status: 401 });
            }

            const payload = {
                userId: dbUser.id,
                user: dbUser.username,
                role: dbUser.role,
                displayName: dbUser.display_name,
                iat: Date.now()
            };
            const token = await signToken(payload, env.AUTH_SECRET);

            await logAudit(env, {
                userId: dbUser.id,
                username: dbUser.username,
                action: 'login',
                targetType: 'user',
                targetId: dbUser.id,
                details: { role: dbUser.role, displayName: dbUser.display_name },
                ipAddress: clientIP
            });

            return Response.json({
                success: true,
                username: dbUser.username,
                displayName: dbUser.display_name,
                role: dbUser.role,
                token
            });
        }

        // 2. Fallback superadmin via Cloudflare environment variables
        const validUsername = env.ADMIN_USER;
        const validPassword = env.ADMIN_PASS;

        if (validUsername && validPassword) {
            const userMatch = constantTimeEquals(username, validUsername);
            const passMatch = constantTimeEquals(password, validPassword);

            if (userMatch && passMatch) {
                const payload = {
                    userId: 0,
                    user: username,
                    role: 'admin',
                    displayName: 'Administrator',
                    iat: Date.now()
                };
                const token = await signToken(payload, env.AUTH_SECRET);

                await logAudit(env, {
                    userId: 0,
                    username,
                    action: 'login',
                    targetType: 'user',
                    targetId: '0',
                    details: { role: 'admin', method: 'env_fallback' },
                    ipAddress: clientIP
                });

                return Response.json({
                    success: true,
                    username,
                    displayName: 'Administrator',
                    role: 'admin',
                    token
                });
            }
        }

        // 3. Invalid credentials
        await logAudit(env, {
            userId: 0,
            username,
            action: 'login_failed',
            targetType: 'user',
            details: { reason: 'unknown_user_or_bad_credentials' },
            ipAddress: clientIP
        });

        return Response.json({ success: false, error: 'Invalid credentials' }, { status: 401 });
    } catch (error) {
        return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
