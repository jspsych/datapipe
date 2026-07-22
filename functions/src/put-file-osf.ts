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
    const retryAfterHeader = osfResult.headers.get('Retry-After');
    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;
    return { success: false, errorCode: osfResult.status, errorText: osfResult.statusText, retryAfter };
  }

  // Parse the created-file reference out of the response body. Tolerate a
  // missing/unparseable body — the upload itself already succeeded (status
  // 201), so a body we can't read must never turn this into a failure.
  let fileId: string | undefined;
  let fileName: string | undefined;
  try {
    const body = (await osfResult.json()) as { data?: { id?: string; attributes?: { name?: string } } };
    fileId = body?.data?.id;
    fileName = body?.data?.attributes?.name;
  } catch {
    fileId = undefined;
    fileName = undefined;
  }

  return { success: true, errorCode: null, errorText: null, fileId, fileName };
}
