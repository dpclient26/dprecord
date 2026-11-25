// ==========================================
// Shared Security, Crypto & Audit Utilities
// for Cloudflare Pages Functions
// ==========================================

const PBKDF2_ITERATIONS = 100000;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Constant-time string comparison to prevent timing attacks
export function constantTimeEquals(a, b) {
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

function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// Hash password using PBKDF2-SHA256 with random 16-byte salt
export async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256'
        },
        keyMaterial,
        256
    );
    const hashBytes = new Uint8Array(derivedBits);
    return `${bytesToBase64(salt)}:${bytesToBase64(hashBytes)}`;
}

// Verify password against stored "saltB64:hashB64"
export async function verifyPassword(password, storedHash) {
    if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;

    try {
        const salt = base64ToBytes(parts[0]);
        const expectedHashB64 = parts[1];

        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(password),
            'PBKDF2',
            false,
            ['deriveBits']
        );
        const derivedBits = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt,
                iterations: PBKDF2_ITERATIONS,
                hash: 'SHA-256'
            },
            keyMaterial,
            256
        );
        const derivedB64 = bytesToBase64(new Uint8Array(derivedBits));
        return constantTimeEquals(derivedB64, expectedHashB64);
    } catch {
        return false;
    }
}

// Sign an HMAC-SHA256 token
export async function signToken(payloadObj, secret) {
    const payloadB64 = btoa(unescape(encodeURIComponent(JSON.stringify(payloadObj))));
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sigBuffer = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(payloadB64)
    );
    const sigB64 = bytesToBase64(new Uint8Array(sigBuffer));
    return `${payloadB64}.${sigB64}`;
}

// Verify an HMAC-SHA256 Bearer token
export async function verifyToken(authHeader, env) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7);
    try {
        const parts = token.split('.');
        if (parts.length !== 2) return null;
        const [payloadB64, sigB64] = parts;
        if (!env.AUTH_SECRET) return null;

        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(env.AUTH_SECRET),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );

        const sigBuffer = base64ToBytes(sigB64);
        const valid = await crypto.subtle.verify(
            'HMAC',
            key,
            sigBuffer,
            new TextEncoder().encode(payloadB64)
        );
        if (!valid) return null;

        const payload = JSON.parse(decodeURIComponent(escape(atob(payloadB64))));
        if (!payload || typeof payload.iat !== 'number') return null;

        // Token expires after 24 hours
        if (Date.now() - payload.iat > TOKEN_TTL_MS) return null;

        // Backward-compatibility: if legacy token has no role, treat env.ADMIN_USER as admin
        if (!payload.role && env.ADMIN_USER && payload.user === env.ADMIN_USER) {
            payload.role = 'admin';
            payload.displayName = 'Administrator';
            payload.userId = 0;
        }

        return payload;
    } catch {
        return null;
    }
}

// Convert a UTC/ISO timestamp to IST (UTC+5:30) formatted string
export function toIST(isoString) {
    if (!isoString) return '';
    try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return isoString;
        return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    } catch {
        return isoString;
    }
}

// Get current IST timestamp as ISO-like string
export function nowIST() {
    const now = new Date();
    return now.toLocaleString('en-CA', { timeZone: 'Asia/Kolkata', hour12: false }).replace(', ', 'T') + '+05:30';
}

// Extract client IP
export function getClientIP(request) {
    return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

// Write an audit log entry (never throws to avoid breaking primary operations)
export async function logAudit(env, { userId = 0, username = 'unknown', action, targetType = null, targetId = null, details = null, ipAddress = 'unknown' }) {
    if (!env.DB) return;
    try {
        const detailsStr = details && typeof details !== 'string' ? JSON.stringify(details) : details;
        await env.DB.prepare(
            `INSERT INTO audit_logs (user_id, username, action, target_type, target_id, details, ip_address, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            userId,
            username,
            action,
            targetType,
            targetId ? String(targetId) : null,
            detailsStr || null,
            ipAddress,
            nowIST()
        ).run();
    } catch (err) {
        console.warn('Audit log insert skipped/failed:', err.message);
    }
}

