import { onRequest } from "firebase-functions/v2/https";
import { db, auth } from "./app.js";

const clientId = process.env.CLIENT_ID as string;
const clientSecret = process.env.CLIENT_SECRET as string; // Remove NEXT_PUBLIC_ prefix for security
const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI as string;


// Use Map to track processed codes with timestamp for cleanup
const processedCodes = new Map(); 

// Clean up old processed codes (older than 10 minutes)
const cleanupProcessedCodes = () => {
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [code, timestamp] of processedCodes.entries()) {
    if (timestamp < tenMinutesAgo) {
      processedCodes.delete(code);
    }
  }
};

export const oauth2Callback = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { code, uid, isSignup, state, osfEntryComponentId, osfEntryUserId } = req.body;
    
    // Clean up old processed codes
    cleanupProcessedCodes();
    
    // Prevent duplicate processing of the same authorization code
    if (processedCodes.has(code)) {
      res.status(400).json({ error: 'Authorization code already processed' });
      return;
    }
    processedCodes.set(code, Date.now());
    

    if (!code) {
      res.status(400).json({ error: 'Authorization code is required' });
      return;
    }

    if (!state) {
      res.status(400).json({ error: 'State parameter is required for CSRF protection' });
      return;
    }

    // For existing users linking their OSF account
    if (!isSignup && !uid) {
      res.status(400).json({ error: 'User ID is required for account linking' });
      return;
    }

    const params = new URLSearchParams({
      code: code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });


    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://accounts.osf.io/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    });

    if (!tokenResponse.ok) {
      let errorText = await tokenResponse.text();
      let errorData = { error: errorText, body: params.toString(), client_id: clientId };
      res.status(400).json({ 
        error: 'Token exchange failed',
        details: errorData,
        status: tokenResponse.status
      });
      return;
    }

    const tokenData = await tokenResponse.json();

    // Fetch user profile from OSF OAuth endpoint
    const profileResponse = await fetch('https://accounts.osf.io/oauth2/profile', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/json'
      }
    });

    if (!profileResponse.ok) {
      const errorData = await profileResponse.text();
      res.status(400).json({ 
        error: 'Failed to fetch OSF profile',
        details: errorData,
        status: profileResponse.status
      });
      return;
    }

    const profileData = await profileResponse.json();
    const osfUserId = profileData.id;
    
    if (!osfUserId) {
      res.status(400).json({ error: 'Failed to get OSF user ID from profile' });
      return;
    }
    
    // For OSF entry flow, validate that the authenticated user matches the expected user
    if (osfEntryUserId && osfUserId !== osfEntryUserId) {
      res.status(400).json({ 
        error: 'OSF user mismatch. The authenticated user does not match the expected user for this entry point.' 
      });
      return;
    }
    
    // OAuth profile doesn't include email, so we'll use the full API
    const userApiResponse = await fetch(`https://api.osf.io/v2/users/${osfUserId}/`, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/vnd.api+json'
      }
    });
    
    let osfEmail = `user-${osfUserId}@osf.io`; // Default fallback
    let osfFullName = 'OSF User';
    
    if (userApiResponse.ok) {
      const userApiData = await userApiResponse.json();
      const userAttributes = userApiData.data?.attributes;
      osfFullName = userAttributes?.full_name || 
                   `${userAttributes?.given_name || ''} ${userAttributes?.family_name || ''}`.trim() || 
                   'OSF User';

      // Try to fetch email from the emails endpoint
      const emailsResponse = await fetch(`https://api.osf.io/v2/users/${osfUserId}/settings/emails/`, {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Accept': 'application/vnd.api+json'
        }
      });

      if (emailsResponse.ok) {
        const emailsData = await emailsResponse.json();
        // Look for primary email or first email in the list
        const emails = emailsData.data;
        if (emails && emails.length > 0) {
          const primaryEmail = emails.find((email: any) => email.attributes?.primary) || emails[0];
          osfEmail = primaryEmail?.attributes?.email_address || `user-${osfUserId}@osf.io`;
        }
      }
    }

    if (isSignup) {
      // Check if user already exists by OSF ID
      const existingOsfUserQuery = await db.collection('users').where('osfUserId', '==', osfUserId).get();
      
      if (!existingOsfUserQuery.empty) {
        // User already exists with this OSF account - this is a sign-in attempt, not signup
        const existingUser = existingOsfUserQuery.docs[0];
        const userData = existingUser.data();
        
        // Update their OAuth tokens and sign them in
        await db.doc(`users/${existingUser.id}`).update({
          authToken: tokenData.access_token,
          authTokenExpires: Date.now() + tokenData.expires_in * 1000,
          refreshToken: tokenData.refresh_token,
          refreshTokenExpires: Date.now() + 2_629_746_000, // 1 month
        });

        // Create a custom token for sign-in
        const customToken = await auth.createCustomToken(existingUser.id, {
          osfId: osfUserId,
          email: userData.email,
          authMethod: 'osf'
        });

        res.status(200).json({
          success: true,
          customToken: customToken,
          isNewUser: false,
          user: {
            uid: existingUser.id,
            email: userData.email,
            displayName: userData.displayName || osfFullName
          }
        });
        return;
      }

      // Check if this email is already used by an email user (no authMethod field)
      const existingEmailUserQuery = await db.collection('users')
        .where('email', '==', osfEmail)
        .get();
      
      const emailConflictUsers = existingEmailUserQuery.docs.filter(doc => {
        const userData = doc.data();
        return !userData.authMethod; // Email users don't have authMethod field
      });

      if (emailConflictUsers.length > 0) {
        res.status(400).json({ 
          error: 'An account with this email already exists using email/password authentication. Please sign in with your email and password, then link your OSF account from the account settings.' 
        });
        return;
      }

      // Generate app-specific UUID for OAuth user (consistent with email users)
      const appUserId = crypto.randomUUID();

      // Create Firebase custom token for new user
      const customToken = await auth.createCustomToken(appUserId, {
        osfId: osfUserId,
        email: osfEmail,
        authMethod: 'osf'
      });

      // Create user document with OAuth tokens for automatic API access
      await db.doc(`users/${appUserId}`).set({
        email: osfEmail,
        uid: appUserId,
        osfUserId: osfUserId,
        displayName: osfFullName,
        authMethod: 'osf',
        // Personal token fields (not used for OAuth users)
        osfToken: '', 
        osfTokenValid: false,
        // OAuth token management
        usingPersonalToken: false, // OAuth users don't need personal tokens
        refreshToken: tokenData.refresh_token,
        refreshTokenExpires: Date.now() + 2_629_746_000, // 1 month in milliseconds
        authToken: tokenData.access_token, // OAuth access token - auto-refreshed
        authTokenExpires: Date.now() + tokenData.expires_in * 1000,
        experiments: [],
        createdAt: Date.now()
      });


      res.status(200).json({
        success: true,
        customToken: customToken,
        isNewUser: true,
        user: {
          uid: appUserId,
          email: osfEmail,
          displayName: osfFullName
        }
      });
    } else {
      // Existing user linking OSF account
      // First check if this OSF account is already linked to another user
      const existingOsfLinkQuery = await db.collection('users').where('osfUserId', '==', osfUserId).get();
      
      if (!existingOsfLinkQuery.empty) {
        const conflictingUser = existingOsfLinkQuery.docs[0];
        if (conflictingUser.id !== uid) {
          res.status(400).json({ 
            error: 'This OSF account is already linked to another DataPipe account. Each OSF account can only be linked to one DataPipe account.' 
          });
          return;
        }
      }

      // Update existing user with OAuth tokens for automatic API access
      await db.doc(`users/${uid}`).update({
        osfUserId: osfUserId,
        authMethod: 'osf',
        usingPersonalToken: false, // Switch to OAuth token management
        refreshToken: tokenData.refresh_token,
        authToken: tokenData.access_token, // OAuth access token - auto-refreshed
        refreshTokenExpires: Date.now() + 2_629_746_000, // 1 month in milliseconds
        authTokenExpires: Date.now() + tokenData.expires_in * 1000
      });


      res.status(200).json({
        success: true,
        refreshToken: tokenData.refresh_token,
        accessToken: tokenData.access_token,
        expiresIn: tokenData.expires_in,
        isNewUser: false
      });
    }

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});