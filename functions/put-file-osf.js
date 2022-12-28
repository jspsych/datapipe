import fetch from "node-fetch";

export default async function putFileOSF(
  osfComponent,
  osfToken,
  filedata,
  filename
) {
  const queryParams = new URLSearchParams({
    type: "files",
    name: filename,
  });

  const osfResult = await fetch(`${osfComponent}?${queryParams.toString()}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${osfToken}`,
    },
    body: filedata,
  });

  if (osfResult.status !== 201) {
    return {
      success: false,
      errorCode: osfResult.status,
      errorText: osfResult.statusText,
    };
  }
  return { success: true, errorCode: null, errorText: null };
}
