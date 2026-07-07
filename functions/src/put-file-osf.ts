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
  const fileName = segments.pop() as string;

  let targetUrl = startUrl ?? osfComponent;
  for (const folder of segments) {
    targetUrl = await resolveFolder(targetUrl, osfToken, folder);
  }

  const queryParams = new URLSearchParams({
    kind: "file",
    name: fileName,
  });

  const osfResult = await fetch(`${targetUrl}?${queryParams.toString()}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${osfToken}`,
    },
    // Buffer is a valid fetch body at runtime; the cast sidesteps a @types/node
    // generic-Buffer vs BodyInit mismatch.
    body: filedata as BodyInit,
  });

  if (osfResult.status !== 201) {
    const retryAfterHeader = osfResult.headers.get('Retry-After');
    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;
    return { success: false, errorCode: osfResult.status, errorText: osfResult.statusText, retryAfter };
  }

  return { success: true, errorCode: null, errorText: null };
}
