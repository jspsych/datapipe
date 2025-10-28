export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { code, state } = req.query;
  
  if (!code) {
    return res.status(400).json({ error: "Authorization code is required" });
  }

  try {
    // Exchange the authorization code for tokens directly
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code: code,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/google-drive-callback",
        grant_type: "authorization_code",
      }),
    });

    if (tokenResponse.status !== 200) {
      throw new Error(`Failed to exchange code for tokens: ${tokenResponse.statusText}`);
    }

    const tokens = await tokenResponse.json();
    
    // The state parameter should contain the user ID
    if (!state) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const userId = state;
    
    // Redirect with the tokens as URL parameters and handle the storage in the frontend
    const tokenParams = new URLSearchParams({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      userId: userId
    });

    // Redirect to a success page that will handle token storage
    res.redirect(`/admin/account?googleDriveSuccess=true&${tokenParams.toString()}`);
  } catch (error) {
    console.error("Google Drive OAuth error:", error);
    res.redirect("/admin/account?googleDriveError=true");
  }
}
