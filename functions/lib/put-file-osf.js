import fetch from "node-fetch";
export default async function putFileOSF(osfComponent, osfToken, filedata, filename) {
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
        throw Error(`Error putting file in OSF with code: ${osfResult.status}, and message: ${osfResult.statusText}`);
    }
    return { success: true, errorCode: null, errorText: null };
}
//# sourceMappingURL=put-file-osf.js.map