// // api/proxy.js
// module.exports = async (req, res) => {
//   const scriptURL = process.env.GOOGLE_SCRIPT_URL;

//   if (!scriptURL) {
//     return res.status(500).json({ error: "Server configuration error: GOOGLE_SCRIPT_URL is not set." });
//   }

//   try {
//     let response;

//     if (req.method === 'GET') {
//       const queryString = new URLSearchParams(req.query).toString();
//       response = await fetch(`${scriptURL}?${queryString}`, { method: 'GET' });

//       // ⚡ EDGE CACHE: Cache this GET response on Vercel for 30 seconds
//       // stale-while-revalidate: serve stale data for 60s while updating in background
//       res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

//     } 
//     else if (req.method === 'POST') {
//       const bodyData = new URLSearchParams(req.body).toString();

//       response = await fetch(scriptURL, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//         body: bodyData,
//       });

//       // Never cache POST requests (add/edit)
//       res.setHeader('Cache-Control', 'no-store');
//     } 
//     else {
//       return res.status(405).json({ error: "Method Not Allowed" });
//     }

//     const data = await response.json();
//     res.status(response.status).json(data);

//   } catch (error) {
//     console.error("Proxy Error:", error);
//     res.status(500).json({ error: "Internal Server Error" });
//   }
// }; 


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
    return new Response(JSON.stringify({ error: 'Internal Server Error: ' + error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}