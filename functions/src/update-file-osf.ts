import fetch from "node-fetch";

export default async function updateFileOSF(
  osfComponent: string,
  osfToken: string,
  filedata: string,
  fileId: string
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
    throw Error(`Error updating file in OSF with code: ${osfResult.status}, and message: ${osfResult.statusText}`);
  }
  return { success: true, errorCode: null, errorText: null, file: filedata};
}
