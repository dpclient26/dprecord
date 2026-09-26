export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  try {
    const { username, password } = await request.json();
    const validUsername = env.ADMIN_USER;
    const validPassword = env.ADMIN_PASS;

    if (!validUsername || !validPassword || !env.AUTH_SECRET) {
      return Response.json({ error: 'Server configuration error.' }, { status: 500 });
    }

    // Constant-time string comparison to prevent timing attacks
    const isUserValid = timingSafeEqualStr(username, validUsername);
    const isPassValid = timingSafeEqualStr(password, validPassword);

    if (isUserValid && isPassValid) {
      // Generate HMAC-signed token (cryptographically secure, non-reversible)
      const payload = JSON.stringify({
        user: username,
        iat: Date.now(),
        exp: Date.now() + 24 * 60 * 60 * 1000
      });
      const payloadB64 = btoa(unescape(encodeURIComponent(payload)));

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
      let binary = '';
      for (let i = 0; i < sigArray.length; i++) {
        binary += String.fromCharCode(sigArray[i]);
      }
      const sigB64 = btoa(binary);
      const token = payloadB64 + '.' + sigB64;

      return Response.json({
        success: true,
        username: username,
        token: token
      });
    } else {
      // Small artificial delay to mitigate automated brute-force attacks
      await new Promise(r => setTimeout(r, 200));
      return Response.json({ success: false, error: 'Invalid credentials' }, { status: 401 });
    }
  } catch (error) {
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < aBuf.byteLength; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}