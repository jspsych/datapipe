import fetch from "node-fetch";
import validateJSON from "./validate-json.js";
import { Metadata } from "./interfaces";

export default async function downloadMetadata(
  osfComponent: string,
  osfToken: string,
  metadataId: string,
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
    throw Error(`Error downloading metadata with code: ${downloadMetadata.status}, and message: ${downloadMetadata.statusText}`);
  }

  /**
 * Extracts the URL of the metadata file from the download object.
 * @type {string}
 */ 
  var fileUrl: string = downloadMetadata.url;

  /**
   * Uses the download link provided by OSF to get the metadata file as a string.
   * @param {string} fileUrl - The URL of the file to fetch.
   * @returns {Promise} A promise that resolves to the data from the file.
   */
  async function fetchMetadata(fileUrl: string) {
    try {
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw Error(`Error fetching metadata with code: ${response.status}, and message: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        throw Error(`Error fetching metadata with code: 400, and message: ${error instanceof Error ? error.message : 'An unknown error occurred'}`)
    }
}
  // Download the metadata file.
  const metadata: Metadata = await fetchMetadata(fileUrl) as Metadata;

  if (!metadata.variableMeasured || !metadata.variableMeasured[0].name) {
    throw Error(`Error downloading metadata with code: 400, and message: Invalid metadata downloaded`)
  } 

  // Checks if the existing metadata is in valid JSON format, and that it contains the Psych-DS proper fields.
  const success: boolean = validateJSON(JSON.stringify(metadata), ["name", "schemaVersion", "@context", "@type", "description", "author", "variableMeasured"]);
  
  return { success: success, errorCode: null, errorText: null, metadata: metadata};
}