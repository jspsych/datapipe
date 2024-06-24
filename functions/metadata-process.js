//import fetch from "node-fetch";

export default async function processMetadata(
  osfComponent,
  osfToken,
) {
  //Gets the metadata of the data storage element in the OSF project.
  try {
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
  const listOfFiles = folder['data'];

  // Every file object has an 'attributes' property which contains an object of information about the file, 
  // including a name property. We use this to find the file object of the metadata file.
  const metadataFile = listOfFiles.filter((file) => file.attributes.name === `dataset_description.json`);

  // Return error if no file with the name 'dataset-description.json' is found.
  if (metadataFile.length === 0) {
    return { success: false, errorCode: 404, errorText: 'Metadata file not found', metadataString: null};
  }

  // Since filter returns a list, we access the first object and access the id property, which contains the 
  // unique id needed to access the file. The string comes with an osfstorage/ prefix that we remove.
  const metadataId = metadataFile[0].id.replace('osfstorage/', '');

  return { success: true, errorCode: null, errorText: null, metadataId: metadataId};
}
catch (error) {
  console.log({'ERROR': error.message})
  return { success: false, errorCode: 400, errorText: error.message, metadataString: null};
}
}

