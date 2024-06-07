import fetch from "node-fetch";

export default async function updateFileOSF(
  osfComponent,
  osfToken,
  filedata,
  fileId
) {

  const osfResult = await fetch(`${osfComponent}${fileId}?kind=file`, {
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
  return { success: true, errorCode: null, errorText: null, file: filedata};
}
