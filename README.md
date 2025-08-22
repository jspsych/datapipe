# DataPipe

Send your experiment data directly to the OSF, for free.

https://pipe.jspsych.org

## Citation

If you use this for academic work, please cite:

de Leeuw, J. R. (2024). DataPipe: Born-open data collection for online experiments. *Behavior Research Methods, 56*(3), 2499-2506.

## Development

### Running Tests

```bash
npm test
```

### Firebase Emulators

```bash
npm run emulators
```

### Google Cloud OAuth Setup

#### Project Setup

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
