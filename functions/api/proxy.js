// api/proxy.js (Cloudflare Pages Function)
export async function onRequest(context) {
  const { request, env } = context;
  const scriptURL = env.GOOGLE_SCRIPT_URL;

  if (!scriptURL) {
    return new Response(JSON.stringify({ error: 'Server config error: GOOGLE_SCRIPT_URL is not set.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const url = new URL(request.url);
    let googleResponse;

    if (request.method === 'GET') {
      const queryString = url.searchParams.toString();
      googleResponse = await fetch(`${scriptURL}?${queryString}`, { method: 'GET' });

      const data = await googleResponse.text();
      return new Response(data, {
        status: googleResponse.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 's-maxage=30, stale-while-revalidate=60'
        }
      });

    } else if (request.method === 'POST') {
      const bodyText = await request.text();

      googleResponse = await fetch(scriptURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: bodyText,
      });

      const data = await googleResponse.text();
      return new Response(data, {
        status: googleResponse.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        }
      });

    } else {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error("Proxy Error:", error);
    return new Response(JSON.stringify({ error: 'An unexpected error occurred.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}