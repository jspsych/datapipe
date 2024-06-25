import fetch from "node-fetch";
import validateJSON from "./validate-json.js";

export default async function downloadMetadata(
  osfComponent,
  osfToken,
  metadataId,
) {
  //Gets the metadata of the data storage element in the OSF project.
  const downloadMetadata = await fetch(`${osfComponent}${metadataId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${osfToken}`,
    }
  });
  /**
 * Checks the status of the metadata download.
 * If the status is 404, logs the list of files to the console and returns an error object.
 */ 
  if (downloadMetadata.status === 404) {
    console.log(listOfFiles);
    return { success: false, errorCode: 404, errorText: 'Metadata file not found', metadataString: null};
  }

  /**
 * Extracts the URL of the metadata file from the download object.
 * @type {string}
 */ 
  var fileUrl = downloadMetadata.url;

  /**
   * Uses the download link provided by OSF to get the metadata file as a string.
   * @param {string} fileUrl - The URL of the file to fetch.
   * @returns {Promise} A promise that resolves to the data from the file.
   */
  async function fetchMetadata(fileUrl) {
    try {
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        throw error;
    }
}
  // Download the metadata file and convert it to a string.
  const metadata = await fetchMetadata(fileUrl);

  console.log('DOWNLOADED:', metadata);

  // Checks if the existing metadata is in valid JSON format, and that it contains the Psych-DS proper fields.
  const success = validateJSON(JSON.stringify(metadata), ["name", "schemaVersion", "@context", "@type", "description", "author", "variableMeasured"]);

  //console.log('THE VALIDATION RESULT IS: ', success);
  
  return { success: success, errorCode: null, errorText: null, metaString: metadata};
}