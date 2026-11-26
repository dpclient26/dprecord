// ==========================================
// Shared Security, Crypto & Audit Utilities
// for Cloudflare Pages Functions
// ==========================================

const PBKDF2_ITERATIONS = 100000; // Cloudflare Workers max supported PBKDF2 iterations
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const ENC_PREFIX = 'enc:v1:';

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

// Derive a 256-bit purpose-specific key from AUTH_SECRET using SHA-256 domain separation
async function derivePurposeKey(secret, purpose, usage) {
    const data = new TextEncoder().encode(`${purpose}:${secret}`);
    const hash = await crypto.subtle.digest('SHA-256', data);
    if (usage === 'aes') {
        return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }
    return crypto.subtle.importKey('raw', hash, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// Apply server-side pepper to password using HMAC-SHA256(AUTH_SECRET, password)
async function applyPepper(password, secret) {
    if (!secret) return password;
    const key = await derivePurposeKey(secret, 'dp-password-pepper-v1', 'hmac');
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(password));
    return bytesToBase64(new Uint8Array(sig));
}

// Deterministic blind-index hash for searching encrypted usernames without exposing plaintext
export async function hashIdentifier(value, secret) {
    const normalized = String(value || '').trim().toLowerCase();
    const key = await derivePurposeKey(secret, 'dp-blind-index-v1', 'hmac');
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(normalized));
    return bytesToBase64(new Uint8Array(sig));
}

// Encrypt sensitive text (username, display_name, IP, log details) with AES-256-GCM
export async function encryptText(plaintext, secret) {
    if (plaintext === null || plaintext === undefined || plaintext === '') return '';
    const str = String(plaintext);
    if (str.startsWith(ENC_PREFIX)) return str;
    if (!secret) return str;

    const key = await derivePurposeKey(secret, 'dp-field-enc-v1', 'aes');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipherBuf = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(str)
    );
    return `${ENC_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipherBuf))}`;
}

// Decrypt AES-256-GCM encrypted text (backward-compatible with legacy plaintext rows)
export async function decryptText(storedValue, secret) {
    if (storedValue === null || storedValue === undefined || storedValue === '') return '';
    const str = String(storedValue);
    if (!str.startsWith(ENC_PREFIX)) return str;
    if (!secret) return '';

    try {
        const rest = str.substring(ENC_PREFIX.length);
        const parts = rest.split(':');
        if (parts.length !== 2) return '';
        const iv = base64ToBytes(parts[0]);
        const cipherBytes = base64ToBytes(parts[1]);
        const key = await derivePurposeKey(secret, 'dp-field-enc-v1', 'aes');
        const plainBuf = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            cipherBytes
        );
        return new TextDecoder().decode(plainBuf);
    } catch {
        return '[encrypted]';
    }
}

// Hash password using PBKDF2-SHA256 with pepper + random 16-byte salt
// Format: "pbkdf2:v2:<saltB64>:<hashB64>"
export async function hashPassword(password, secret = '') {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const peppered = await applyPepper(password, secret);
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(peppered),
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
    return `pbkdf2:v2:${bytesToBase64(salt)}:${bytesToBase64(new Uint8Array(derivedBits))}`;
}

// Verify password against stored hash (supports v2 peppered and v1 unpeppered formats)
export async function verifyPassword(password, storedHash, secret = '') {
    if (typeof password !== 'string' || typeof storedHash !== 'string') return false;

    try {
        let saltB64, expectedHashB64, inputPassword;

        if (storedHash.startsWith('pbkdf2:v2:')) {
            const parts = storedHash.split(':');
            if (parts.length !== 4) return false;
            saltB64 = parts[2];
            expectedHashB64 = parts[3];
            inputPassword = await applyPepper(password, secret);
        } else {
            // Backward-compatible with v1 "saltB64:hashB64"
            const parts = storedHash.split(':');
            if (parts.length !== 2) return false;
            saltB64 = parts[0];
            expectedHashB64 = parts[1];
            inputPassword = password;
        }

        const salt = base64ToBytes(saltB64);
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(inputPassword),
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

// Validate password strength
export function validatePasswordStrength(password) {
    if (typeof password !== 'string' || password.length < 8) {
        return 'Password must be at least 8 characters long.';
    }
    if (password.length > 128) {
        return 'Password must not exceed 128 characters.';
    }
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
        return 'Password must include uppercase, lowercase, and at least one number.';
    }
    return null;
}

// Create an AES-256-GCM encrypted & authenticated session token
// Format: "v2.<ivB64>.<cipherB64>" (opaque to clients, cannot be decoded or forged)
export async function signToken(payloadObj, secret) {
    const key = await derivePurposeKey(secret, 'dp-session-token-v2', 'aes');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const jsonBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
    const cipherBuf = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        jsonBytes
    );
    return `v2.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipherBuf))}`;
}

// Verify and decrypt session token (supports v2 AES-GCM and legacy v1 HMAC tokens)
export async function verifyToken(authHeader, env) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7);
    if (!env.AUTH_SECRET) return null;

    try {
        let payload = null;

        if (token.startsWith('v2.')) {
            const parts = token.split('.');
            if (parts.length !== 3) return null;
            const iv = base64ToBytes(parts[1]);
            const cipherBytes = base64ToBytes(parts[2]);
            const key = await derivePurposeKey(env.AUTH_SECRET, 'dp-session-token-v2', 'aes');
            const plainBuf = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                key,
                cipherBytes
            );
            payload = JSON.parse(new TextDecoder().decode(plainBuf));
        } else {
            // Legacy v1 HMAC-SHA256 token fallback
            const parts = token.split('.');
            if (parts.length !== 2) return null;
            const [payloadB64, sigB64] = parts;
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
            payload = JSON.parse(decodeURIComponent(escape(atob(payloadB64))));
        }

        if (!payload || typeof payload.iat !== 'number') return null;
        if (Date.now() - payload.iat > TOKEN_TTL_MS) return null;

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

// Standard no-cache JSON response helper for sensitive API endpoints
export function secureJson(data, status = 200) {
    return Response.json(data, {
        status,
        headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, private',
            'Pragma': 'no-cache'
        }
    });
}

// Self-healing schema check: ensures users.username_hash exists even if table was created with older schema.sql
let _schemaChecked = false;
export async function ensureRbacSchema(db) {
    if (!db || _schemaChecked) return;
    try {
        await db.prepare('SELECT username_hash FROM users LIMIT 1').first();
        _schemaChecked = true;
    } catch (err) {
        if (String(err.message || '').includes('no such column')) {
            try {
                await db.prepare('ALTER TABLE users ADD COLUMN username_hash TEXT').run();
                await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_hash ON users(username_hash)').run();
                _schemaChecked = true;
            } catch (alterErr) {
                console.warn('Auto-migration for username_hash failed:', alterErr.message);
            }
        }
    }
}

// Write an encrypted audit log entry (never throws to avoid breaking primary operations)
export async function logAudit(env, { userId = 0, username = 'unknown', action, targetType = null, targetId = null, details = null, ipAddress = 'unknown' }) {
    if (!env.DB) return;
    try {
        const secret = env.AUTH_SECRET || '';
        const detailsStr = details && typeof details !== 'string' ? JSON.stringify(details) : details;
        const encUser = await encryptText(username, secret);
        const encDetails = detailsStr ? await encryptText(detailsStr, secret) : null;
        const encIp = ipAddress ? await encryptText(ipAddress, secret) : null;

        await env.DB.prepare(
            `INSERT INTO audit_logs (user_id, username, action, target_type, target_id, details, ip_address, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            userId,
            encUser,
            action,
            targetType,
            targetId ? String(targetId) : null,
            encDetails,
            encIp,
            nowIST()
        ).run();
    } catch (err) {
        console.warn('Audit log insert skipped/failed:', err.message);
    }
}
