# DataPipe

Send your experiment data directly to the OSF, for free.

https://pipe.jspsych.org

## Features

- **OSF Integration**: Primary data export to Open Science Framework
- **Google Drive Integration**: Optional backup export to Google Drive
- **Data Validation**: Built-in JSON and CSV validation
- **Secure Storage**: Firebase-powered backend with user authentication

## Citation

If you use this for academic work, please cite:

de Leeuw, J. R. (2024). DataPipe: Born-open data collection for online experiments. *Behavior Research Methods, 56*(3), 2499-2506.

## Setup

### Google Drive Integration (Optional)

Google Drive integration allows users to export experiment data to their own Google Drive folders as a backup or alternative to OSF. This provides:

- **Reliability**: Google Drive is more reliable than OSF
- **Backups**: Users can export to both OSF and Google Drive simultaneously
- **Convenience**: Users may not already have OSF in their workflow
- **Cost**: No additional storage costs for users

#### Google Cloud Project Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Drive API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Drive API"
   - Click "Enable"

#### OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth 2.0 Client IDs"
3. Choose "Web application"
4. Add authorized redirect URIs:
   - `https://pipe.jspsych.org/api/google-drive-callback` (production)
   - `http://localhost:3000/api/google-drive-callback` (development)
5. Note your Client ID and Client Secret

#### Environment Variables

Add these to your environment configuration:

```bash
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=https://pipe.jspsych.org/api/google-drive-callback
```

#### User Configuration

Users can enable Google Drive export in their account settings:

1. Go to Account Settings
2. Click "Configure Google Drive"
3. Click "Connect Google Drive" to start OAuth flow
4. Grant permissions to access Google Drive
5. Configure a folder ID for data storage

#### Folder ID Configuration

Users need to provide a Google Drive folder ID:

1. Go to Google Drive
2. Navigate to or create a folder for experiment data
3. Copy the folder ID from the URL:
   - URL format: `https://drive.google.com/drive/folders/FOLDER_ID_HERE`
   - Copy the long string after `/folders/`

## Development

### Running Tests

```bash
npm test
```

### Firebase Emulators

```bash
npm run emulators
```

## Security

- **Minimal Scope**: Google Drive integration only requests `drive.file` and `drive.metadata.readonly` permissions
- **Token Storage**: Refresh tokens stored securely in Firestore
- **User Control**: Users control their own Google Drive access
- **No Data Access**: DataPipe never reads from Google Drive, only writes

