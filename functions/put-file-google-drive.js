import fetch from "node-fetch";

export default async function putFileGoogleDrive(
  folderId,
  filename,
  fileData,
  accessToken
) {
  try {
    // First, check if the file already exists
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(filename)}' and '${folderId}' in parents and trashed=false`;
    
    const searchResponse = await fetch(searchUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (searchResponse.status !== 200) {
      return {
        success: false,
        errorCode: searchResponse.status,
        errorText: `Failed to search for existing file: ${searchResponse.statusText}`,
      };
    }

    const searchResult = await searchResponse.json();
    
    // If file exists, return conflict error (similar to OSF behavior)
    if (searchResult.files && searchResult.files.length > 0) {
      return {
        success: false,
        errorCode: 409,
        errorText: "Conflict - File already exists",
      };
    }

    // Create file metadata
    const metadata = {
      name: filename,
      parents: [folderId],
      mimeType: "text/plain", // Default to text, can be customized based on file type
    };

    // Create multipart request for file upload
    const boundary = "----WebKitFormBoundary" + Math.random().toString(16).substr(2, 9);
    
    let body = "";
    
    // Add metadata part
    body += `--${boundary}\r\n`;
    body += `Content-Type: application/json\r\n\r\n`;
    body += JSON.stringify(metadata) + "\r\n";
    
    // Add file data part
    body += `--${boundary}\r\n`;
    body += `Content-Type: text/plain\r\n\r\n`;
    body += fileData + "\r\n";
    body += `--${boundary}--\r\n`;

    const uploadResponse = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: body,
    });

    if (uploadResponse.status !== 200) {
      const errorText = await uploadResponse.text();
      return {
        success: false,
        errorCode: uploadResponse.status,
        errorText: `Upload failed: ${errorText}`,
      };
    }

    return { success: true, errorCode: null, errorText: null };
  } catch (error) {
    return {
      success: false,
      errorCode: 500,
      errorText: `Internal error: ${error.message}`,
    };
  }
}
