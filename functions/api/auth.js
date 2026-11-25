import {
    constantTimeEquals,
    verifyPassword,
    hashIdentifier,
    decryptText,
    signToken,
    getClientIP,
    logAudit,
    secureJson
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
        return secureJson({ error: 'Method Not Allowed' }, 405);
    }

    const clientIP = getClientIP(request);
    if (isRateLimited(clientIP)) {
        return secureJson(
            { error: 'Too many login attempts. Please try again later.' },
            429
        );
    }

    try {
        const body = await request.json();
        const username = typeof body.username === 'string' ? body.username.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';

        if (!username || !password) {
            return secureJson({ success: false, error: 'Username and password are required.' }, 400);
        }

        if (!env.AUTH_SECRET) {
            return secureJson({ error: 'Server auth configuration error.' }, 500);
        }

        // 1. Check D1 users table first (using blind index hash, with fallback for legacy plaintext rows)
        let dbUser = null;
        try {
            if (env.DB) {
                const unameHash = await hashIdentifier(username, env.AUTH_SECRET);
                dbUser = await env.DB.prepare(
                    'SELECT id, username, password, display_name, role, status FROM users WHERE username_hash = ? OR LOWER(username) = LOWER(?) LIMIT 1'
                ).bind(unameHash, username).first();
            }
        } catch (dbErr) {
            console.warn('D1 users lookup skipped:', dbErr.message);
        }

        if (dbUser) {
            const plainUsername = await decryptText(dbUser.username, env.AUTH_SECRET) || username;
            const plainDisplayName = await decryptText(dbUser.display_name, env.AUTH_SECRET);

            if (dbUser.status !== 'active') {
                await logAudit(env, {
                    userId: dbUser.id,
                    username: plainUsername,
                    action: 'login_failed',
                    targetType: 'user',
                    targetId: dbUser.id,
                    details: { reason: 'inactive_account' },
                    ipAddress: clientIP
                });
                return secureJson(
                    { success: false, error: 'Account is inactive. Please contact the administrator.' },
                    403
                );
            }

            const passValid = await verifyPassword(password, dbUser.password, env.AUTH_SECRET);
            if (!passValid) {
                await logAudit(env, {
                    userId: dbUser.id,
                    username: plainUsername,
                    action: 'login_failed',
                    targetType: 'user',
                    targetId: dbUser.id,
                    details: { reason: 'invalid_password' },
                    ipAddress: clientIP
                });
                return secureJson({ success: false, error: 'Invalid credentials' }, 401);
            }

            const payload = {
                userId: dbUser.id,
                user: plainUsername,
                role: dbUser.role,
                displayName: plainDisplayName,
                iat: Date.now()
            };
            const token = await signToken(payload, env.AUTH_SECRET);

            await logAudit(env, {
                userId: dbUser.id,
                username: plainUsername,
                action: 'login',
                targetType: 'user',
                targetId: dbUser.id,
                details: { role: dbUser.role },
                ipAddress: clientIP
            });

            return secureJson({
                success: true,
                username: plainUsername,
                displayName: plainDisplayName,
                role: dbUser.role,
                token
            });
        }

        // 2. Fallback superadmin via Cloudflare environment variables (supports plaintext or hashed ADMIN_PASS)
        const validUsername = env.ADMIN_USER;
        const validPassword = env.ADMIN_PASS;

        if (validUsername && validPassword) {
            const userMatch = constantTimeEquals(username, validUsername);
            const passMatch = (validPassword.startsWith('pbkdf2:') || validPassword.includes(':'))
                ? await verifyPassword(password, validPassword, env.AUTH_SECRET)
                : constantTimeEquals(password, validPassword);

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

                return secureJson({
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

        return secureJson({ success: false, error: 'Invalid credentials' }, 401);
    } catch (error) {
        return secureJson({ error: 'Internal Server Error' }, 500);
    }
}
