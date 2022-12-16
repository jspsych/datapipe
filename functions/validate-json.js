export default function validateJSON(json, requiredFields) {
  let parsedJSON = null;
  try {
    parsedJSON = JSON.parse(json);
  } catch (error) {
    return false;
  }

  if (Array.isArray(parsedJSON)) {
    return parsedJSON.some((trial) => {
      const keys = Object.keys(trial);
      return requiredFields.every((field) => keys.includes(field));
    });
  } else {
    const keys = Object.keys(parsedJSON);
    return requiredFields.every((field) => keys.includes(field));
  }
}
