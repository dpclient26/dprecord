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
    if (entry.count > RATE_LIMIT_MAX) {
        return true;
    }
    return false;
}

// Constant-time string comparison to prevent timing attacks
function constantTimeEquals(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const encoder = new TextEncoder();
    const aBuf = encoder.encode(a);
    const bBuf = encoder.encode(b);

    if (aBuf.length !== bBuf.length) return false;

    let result = 0;
    for (let i = 0; i < aBuf.length; i++) {
        result |= aBuf[i] ^ bBuf[i];
    }
    return result === 0;
}

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method !== 'POST') {
        return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    }

    // Rate limit by IP
    const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    if (isRateLimited(clientIP)) {
        return Response.json(
            { error: 'Too many login attempts. Please try again later.' },
            { status: 429 }
        );
    }

    try {
        const body = await request.json();
        const username = typeof body.username === 'string' ? body.username : '';
        const password = typeof body.password === 'string' ? body.password : '';

        const validUsername = env.ADMIN_USER;
        const validPassword = env.ADMIN_PASS;

        // Constant-time comparison to prevent timing-based credential enumeration
        const userMatch = constantTimeEquals(username, validUsername);
        const passMatch = constantTimeEquals(password, validPassword);

        if (userMatch && passMatch) {
            // Generate HMAC-signed token (cryptographically secure, non-reversible)
            const payload = JSON.stringify({ user: username, iat: Date.now() });
            const payloadB64 = btoa(payload);

            const key = await crypto.subtle.importKey(
                'raw',
                new TextEncoder().encode(env.AUTH_SECRET),
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['sign']
            );

            const sigBuffer = await crypto.subtle.sign(
                'HMAC', key, new TextEncoder().encode(payloadB64)
            );
            const sigArray = new Uint8Array(sigBuffer);
            const sigB64 = btoa(String.fromCharCode(...sigArray));
            const token = payloadB64 + '.' + sigB64;

            return Response.json({
                success: true,
                username: username,
                token: token
            });
        } else {
            return Response.json({ success: false, error: 'Invalid credentials' }, { status: 401 });
        }
    } catch (error) {
        return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}