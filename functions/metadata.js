import fetch from "node-fetch";
import putFileOSF from "./put-file-osf.js";
import * as https from 'https';

// 6Q7zKlJxKU3Dh9VaGHj9i1xmhYAkQTHVtYCrbGIhxGqirsWhm6eTixsd8HsjFZ9Ka34mlI

export default async function metadataProcess(
  osfComponent,
  osfToken,
  filename,
  metadata
) {

  const osfResult = await fetch(`${osfComponent}?meta=`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${osfToken}`,
    }
  });

  const folder = await osfResult.json();

  const listOfFiles = folder['data'];

  const metadataFile = listOfFiles.filter((file) => file.attributes.name === `dataset-description.json`);

  if (metadataFile.length === 0) {
    return { success: false, errorCode: 404, errorText: 'Metadata file not found', metadataString: null};
  }

  const metadataId = metadataFile[0].id.replace('osfstorage/', '');
  
  const metadataDownload = await fetch(`${osfComponent}${metadataId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${osfToken}`,
    }
  });

  if (metadataDownload.status === 404) {
    console.log(listOfFiles);
    return { success: false, errorCode: 404, errorText: 'Metadata file not found', metadataString: null};
  }

  var fileUrl = metadataDownload.url;

  let metadataAsString = '';

  async function fetchMetadata(fileUrl) {
    return new Promise((resolve, reject) => {
        https.get(fileUrl, (response) => {
            let data = '';

            // A chunk of data has been received.
            response.on('data', (chunk) => {
                data += chunk;
            });

            // The whole response has been received.
            response.on('end', () => {
                resolve(data);  // Resolve the Promise with the received data
            });

        }).on("error", (err) => {
            reject(err);  // Reject the Promise with the error
        });
    });
}

    metadataAsString = await fetchMetadata(fileUrl);
    
    return { success: true, errorCode: null, errorText: null, metadataString: metadataAsString, metaId: metadataId};

    
}