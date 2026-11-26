import {
    constantTimeEquals,
    hashPassword,
    verifyPassword,
    hashIdentifier,
    decryptText,
    validatePasswordStrength,
    signToken,
    verifyToken,
    nowIST,
    getClientIP,
    logAudit,
    secureJson,
    ensureRbacSchema
} from '../_lib/security.js';

// Rate limiter: Map<ip:username, { count, resetTime }>
// Tracks ONLY failed login attempts per (IP + username) so users on the same
// office/home Wi-Fi do not block each other, and valid logins never count.
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 10; // max failed attempts per (IP + username) per window

function getRateKey(ip, username) {
    return `${ip}:${String(username || '').trim().toLowerCase()}`;
}

function isRateLimited(key) {
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || now > entry.resetTime) {
        return false;
    }
    return entry.count >= RATE_LIMIT_MAX;
}

function recordFailedAttempt(key) {
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || now > entry.resetTime) {
        rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    } else {
        entry.count++;
    }
}

function clearRateLimit(key) {
    rateLimitMap.delete(key);
}

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method !== 'POST') {
        return secureJson({ error: 'Method Not Allowed' }, 405);
    }

    const clientIP = getClientIP(request);

    try {
        const body = await request.json();

        // ================================
        // Self-service Password Change
        // ================================
        if (body.action === 'change_password') {
            const authHeader = request.headers.get('Authorization');
            const tokenPayload = await verifyToken(authHeader, env);
            if (!tokenPayload || !tokenPayload.user) {
                return secureJson({ error: 'Unauthorized. Please log in.' }, 401);
            }
            if (!tokenPayload.userId || tokenPayload.userId === 0) {
                return secureJson(
                    { error: 'Environment superadmin password must be changed in Cloudflare Environment Variables.' },
                    400
                );
            }

            const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
            const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

            const strengthErr = validatePasswordStrength(newPassword);
            if (strengthErr) {
                return secureJson({ error: strengthErr }, 400);
            }

            const dbUser = await env.DB.prepare(
                'SELECT id, username, password FROM users WHERE id = ?'
            ).bind(tokenPayload.userId).first();

            if (!dbUser) {
                return secureJson({ error: 'User not found.' }, 404);
            }

            const validCurrent = await verifyPassword(currentPassword, dbUser.password, env.AUTH_SECRET);
            if (!validCurrent) {
                return secureJson({ error: 'Current password is incorrect.' }, 401);
            }

            const newHash = await hashPassword(newPassword, env.AUTH_SECRET);
            await env.DB.prepare(
                'UPDATE users SET password = ?, updated_at = ? WHERE id = ?'
            ).bind(newHash, nowIST(), dbUser.id).run();

            await logAudit(env, {
                userId: dbUser.id,
                username: tokenPayload.user,
                action: 'change_password',
                targetType: 'user',
                targetId: String(dbUser.id),
                details: { self_service: true },
                ipAddress: clientIP
            });

            return secureJson({ success: true, message: 'Password updated successfully.' });
        }

        // ================================
        // Login
        // ================================
        const username = typeof body.username === 'string' ? body.username.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';

        if (!username || !password) {
            return secureJson({ success: false, error: 'Username and password are required.' }, 400);
        }

        if (!env.AUTH_SECRET) {
            return secureJson({ error: 'Server auth configuration error.' }, 500);
        }

        const rateKey = getRateKey(clientIP, username);
        if (isRateLimited(rateKey)) {
            return secureJson(
                { error: 'Too many failed login attempts for this user. Please try again in 15 minutes.' },
                429
            );
        }

        // 1. Check D1 users table first
        let dbUser = null;
        try {
            if (env.DB) {
                await ensureRbacSchema(env.DB);
                const unameHash = await hashIdentifier(username, env.AUTH_SECRET);
                dbUser = await env.DB.prepare(
                    'SELECT id, username_hash, username, password, display_name, role, status FROM users WHERE username_hash = ? OR LOWER(username) = LOWER(?) LIMIT 1'
                ).bind(unameHash, username).first();

                // Auto-backfill username_hash for legacy rows
                if (dbUser && !dbUser.username_hash) {
                    await env.DB.prepare('UPDATE users SET username_hash = ? WHERE id = ?')
                        .bind(unameHash, dbUser.id).run().catch(() => {});
                }
            }
        } catch (dbErr) {
            console.warn('D1 users lookup skipped:', dbErr.message);
        }

        if (dbUser) {
            const plainUsername = await decryptText(dbUser.username, env.AUTH_SECRET) || username;
            const plainDisplayName = await decryptText(dbUser.display_name, env.AUTH_SECRET);

            if (dbUser.status !== 'active') {
                recordFailedAttempt(rateKey);
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
                recordFailedAttempt(rateKey);
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

            clearRateLimit(rateKey);
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

        // 2. Fallback superadmin via Cloudflare environment variables
        const validUsername = env.ADMIN_USER;
        const validPassword = env.ADMIN_PASS;

        if (validUsername && validPassword) {
            const userMatch = constantTimeEquals(username, validUsername);
            const passMatch = validPassword.startsWith('pbkdf2:')
                ? await verifyPassword(password, validPassword, env.AUTH_SECRET)
                : constantTimeEquals(password, validPassword);

            if (userMatch && passMatch) {
                clearRateLimit(rateKey);
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
        recordFailedAttempt(rateKey);
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
