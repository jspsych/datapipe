# Google Drive Integration Setup

## Overview

Google Drive integration allows users to export experiment data to their own Google Drive folders as a backup or alternative to OSF. This provides:

- **Reliability**: Google Drive is more reliable than OSF
- **Backups**: Users can export to both OSF and Google Drive simultaneously
- **Convenience**: Users may not already have OSF in their workflow
- **Cost**: No additional storage costs for users

## Setup Requirements

### 1. Google Cloud Project Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Drive API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Drive API"
   - Click "Enable"

### 2. OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth 2.0 Client IDs"
3. Choose "Web application"
4. Add authorized redirect URIs:
   - `https://pipe.jspsych.org/api/google-drive-callback` (production)
   - `http://localhost:3000/api/google-drive-callback` (development)
5. Note your Client ID and Client Secret

### 3. Environment Variables

Add these to your environment configuration:

```bash
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=https://pipe.jspsych.org/api/google-drive-callback
```

## User Experience

### 1. Account Setup

Users can enable Google Drive export in their account settings:

1. Go to Account Settings
2. Click "Configure Google Drive"
3. Click "Connect Google Drive" to start OAuth flow
4. Grant permissions to access Google Drive
5. Configure a folder ID for data storage

### 2. Folder ID Configuration

Users need to provide a Google Drive folder ID:

1. Go to Google Drive
2. Navigate to or create a folder for experiment data
3. Copy the folder ID from the URL:
   - URL format: `https://drive.google.com/drive/folders/FOLDER_ID_HERE`
   - Copy the long string after `/folders/`

### 3. Data Export

Once configured, data is automatically exported to both:
- **OSF** (required, for backward compatibility)
- **Google Drive** (optional, if enabled)

## Technical Implementation

### Architecture

- **OAuth Flow**: Standard OAuth 2.0 with refresh tokens
- **Token Management**: Automatic token refresh using stored refresh tokens
- **Dual Export**: OSF (required) + Google Drive (optional)
- **Fallback**: If OSF fails, Google Drive success still counts as success

### Key Components

1. **`put-file-google-drive.js`**: Handles file uploads to Google Drive
2. **`google-drive-auth.js`**: Manages OAuth authentication and token refresh
3. **`GoogleDrive.js`**: React component for user configuration
4. **API endpoints**: Handle OAuth flow and data export

### Data Flow

1. User enables Google Drive export and configures folder
2. OAuth flow stores refresh token in user document
3. Data export attempts OSF first (required)
4. If Google Drive enabled, also exports to Google Drive
5. Success if either export succeeds

## Security Considerations

- **Minimal Scope**: Only requests `drive.file` and `drive.metadata.readonly` permissions
- **Token Storage**: Refresh tokens stored securely in Firestore
- **User Control**: Users control their own Google Drive access
- **No Data Access**: datapipe never reads from Google Drive, only writes

## Troubleshooting

### Common Issues

1. **"Invalid Credentials"**: Check environment variables and OAuth setup
2. **"Permission Denied"**: Ensure Google Drive API is enabled
3. **"Redirect URI Mismatch"**: Verify redirect URI in OAuth credentials
4. **"Token Expired"**: Refresh tokens should auto-refresh, check implementation

### Testing

Run the test suite to verify integration:

```bash
npm test __tests__/google-drive.test.js
```

## Future Enhancements

- **Multiple Folders**: Support for experiment-specific folders
- **File Types**: Better MIME type detection and handling
- **Batch Uploads**: Support for multiple file uploads
- **Export History**: Track export success/failure to both destinations
- **User Notifications**: Alert users when exports fail to either destination
