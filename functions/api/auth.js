export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  try {
    const { username, password } = await request.json();
    const validUsername = env.ADMIN_USER;
    const validPassword = env.ADMIN_PASS;

    if (username === validUsername && password === validPassword) {
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