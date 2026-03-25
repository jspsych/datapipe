import { OSFFile } from './interfaces';

export default async function parsePath(osfComponent: string, osfToken: string, subName: string) {
    //Gets the metadata of the data storage element in the OSF project.
    const osfResult = await fetch(`${osfComponent}?meta=`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${osfToken}`,
      }
    });
    const folder = await osfResult.json(); //Gets the json portion of the response
    // The JSON portion has a property called 'data' that contains an array of objects, each of which
    // corresponds to a data file in the OSF project. We access this array.

    const listOfFiles: OSFFile[]= folder['data'];
    // Every file object has an 'attributes' property which contains an object of information about the file, 
    // including a name property. We use this to find the object of the subfolder if it exists.
    
    const metadataFile: OSFFile[] = listOfFiles.filter((file) => (file.attributes.name === subName));
  
    // Create a subfolder at the specified path if it does not exist, and return the upload link.
    if (metadataFile.length === 0) {

        const queryParams = new URLSearchParams({
            kind: "folder", //folder or folders?
            name: subName,
          });

        const subResponse = await fetch(`${osfComponent}?${queryParams.toString()}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${osfToken}`,
            }
          });

        return (await subResponse.json()).data.links.move;
    }

    return metadataFile[0].links.move;

}

