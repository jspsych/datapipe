import fetch from "node-fetch";
import resolveFolder from "./subfolder.js";

export default async function putFileOSF(
  osfComponent: string,
  osfToken: string,
  filedata: string | Buffer,
  filename: string,
  // Optional pre-resolved link for the folder `filename`'s remaining segments
  // are relative to (e.g. already resolved "data/" for a caller uploading many
  // files under data/). Skips re-walking that portion of the path. Defaults to
  // osfComponent (the component root) when omitted.
  startUrl?: string,
) {

  // A filename may carry a path prefix (e.g. "data/raw/abc123.json"). Split it
  // into folder segments and the file name; each folder level is found-or-created
  // in turn (WaterButler has no atomic deep-path create), walking down to the
  // folder that will hold the file. A bare "abc123.json" has no segments and
  // uploads straight to the storage root (or to startUrl, if given).
  const segments = filename.split('/');
  const requestedFileName = segments.pop() as string;

  let targetUrl = startUrl ?? osfComponent;
  for (const folder of segments) {
    targetUrl = await resolveFolder(targetUrl, osfToken, folder);
  }

  const queryParams = new URLSearchParams({
    kind: "file",
    name: requestedFileName,
  });

  const osfResult = await fetch(`${targetUrl}?${queryParams.toString()}`, {
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
