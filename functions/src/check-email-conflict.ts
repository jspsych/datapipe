import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { db } from "./app.js";

// Plain handler, not an onRequest export -- dispatched from dashboard-api.ts
// along with 14 other low-traffic dashboard endpoints, merged into ONE
// deployed function (dashboardapi) so they share warm instances.
export async function checkEmailConflictHandler(req: Request, res: Response): Promise<void> {
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
    console.error('Email conflict check error:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({
      error: 'Internal server error'
    });
  }
}