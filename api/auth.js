// api/auth.js
export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Vercel automatically parses the JSON body
    const { username, password } = req.body;

    // Get the secret credentials from Vercel Environment Variables
    const validUsername = process.env.ADMIN_USER;
    const validPassword = process.env.ADMIN_PASS;

    // Check if credentials match
    if (username === validUsername && password === validPassword) {
      // In a real app, you would return a JWT here. 
      // For this simple app, we return a success token.
      return res.status(200).json({ success: true, token: 'secure-auth-token-2026' });
    } else {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }
  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}