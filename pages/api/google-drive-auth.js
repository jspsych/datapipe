import { generateGoogleDriveAuthUrl } from "../../functions/google-drive-auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userId } = req.query;
  
  if (!userId) {
    return res.status(400).json({ error: "User ID is required" });
  }

  try {
    // Generate the OAuth URL with the user ID as state parameter
    const authUrl = generateGoogleDriveAuthUrl();
    const finalUrl = `${authUrl}&state=${userId}`;
    
    // Redirect to Google's OAuth page
    res.redirect(finalUrl);
  } catch (error) {
    console.error("Google Drive auth initiation error:", error);
    res.status(500).json({ error: "Failed to initiate Google Drive authentication" });
  }
}
