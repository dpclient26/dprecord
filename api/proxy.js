// api/proxy.js
module.exports = async (req, res) => {
  const scriptURL = process.env.GOOGLE_SCRIPT_URL;

  if (!scriptURL) {
    return res.status(500).json({ error: "Server configuration error: GOOGLE_SCRIPT_URL is not set." });
  }

  try {
    let response;

    if (req.method === 'GET') {
      const queryString = new URLSearchParams(req.query).toString();
      response = await fetch(`${scriptURL}?${queryString}`, { method: 'GET' });

      // ⚡ EDGE CACHE: Cache this GET response on Vercel for 30 seconds
      // stale-while-revalidate: serve stale data for 60s while updating in background
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      
    } 
    else if (req.method === 'POST') {
      const bodyData = new URLSearchParams(req.body).toString();
      
      response = await fetch(scriptURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: bodyData,
      });
      
      // Never cache POST requests (add/edit)
      res.setHeader('Cache-Control', 'no-store');
    } 
    else {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const data = await response.json();
    res.status(response.status).json(data);

  } catch (error) {
    console.error("Proxy Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};