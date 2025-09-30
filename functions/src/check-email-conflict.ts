import { onRequest } from "firebase-functions/v2/https";
import { db } from "./app.js";

export const checkEmailConflict = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    // Check if this email is already used by an OAuth user (authMethod === 'osf')
    const oauthUserQuery = await db.collection('users')
      .where('email', '==', email)
      .where('authMethod', '==', 'osf')
      .get();

    const conflict = !oauthUserQuery.empty;

    res.status(200).json({ conflict });

  } catch (error) {
    console.error('Email conflict check error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});