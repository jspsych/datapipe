import fetch from "node-fetch";
import parsePath from "./subfolder.js";

export default async function putFileOSF(
  osfComponent: string,
  osfToken: string,
  filedata: string | Buffer,
  filename: string
) {

  //if a filepath is detected in the filename, we need to create the subfolder or find the subfolder.
  let path;

  if (filename.includes('/')) {
    // Split filename argument into subfolder name and datafile name.
    const components = filename.split('/');

    // Waterbutler API requires folders to be referenced with trailing slashes.

    const queryParams = new URLSearchParams({
      kind: "file",
      name: components[1],
    });

    path = `${(await parsePath(osfComponent, osfToken, components[0]))}?${queryParams.toString()}`;
    
    }
  else {
    // If no subfolder is detected, we just upload the file to the default storage component root.

    const queryParams = new URLSearchParams({
      kind: "file",
      name: filename,
    });

    path = `${osfComponent}?${queryParams.toString()}`;
  }

  const osfResult = await fetch(`${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${osfToken}`,
    },
    body: filedata,
  });

  if (osfResult.status !== 201) {
    return { success: false, errorCode: osfResult.status, errorText: osfResult.statusText };
  }

  return { success: true, errorCode: null, errorText: null };
}
