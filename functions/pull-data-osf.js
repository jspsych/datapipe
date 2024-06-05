import fetch from "node-fetch";

// 6Q7zKlJxKU3Dh9VaGHj9i1xmhYAkQTHVtYCrbGIhxGqirsWhm6eTixsd8HsjFZ9Ka34mlI

export default async function pullFileOSF(
  osfComponent,
  osfToken,
  filename
) {
  const queryParams = new URLSearchParams({
    type: "files"
    //name: filename,
  });

  const osfResult = await fetch(`${osfComponent}?${queryParams.toString()}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${osfToken}`,
    }
  });

  if (osfResult.status !== 201) {
    return {
      success: false,
      errorCode: osfResult.status,
      errorText: osfResult.statusText,
    };
  }

  const data = await response.json();
  console.log(data);

  return data;
}
