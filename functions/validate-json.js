export default function validateJSON(json, requiredFields) {
  try {
    let parsedJSON = null;
    try {
      parsedJSON = JSON.parse(json);
    } catch (error) {
      return false;
    }

    if (Array.isArray(parsedJSON)) {
      const keys = new Set();

      // Iterate over the array of objects
      for (const object of parsedJSON) {
        // Get the keys for each object and add them to the Set
        const k = Object.keys(object);
        for (const key of k) {
          keys.add(key);
        }
      }

      const uniqueKeys = Array.from(keys);

      // Check if all required fields are present in the Set
      return requiredFields.every((field) => uniqueKeys.includes(field));
    } else {
      const keys = Object.keys(parsedJSON);
      return requiredFields.every((field) => keys.includes(field));
    }
  } catch (error) {
    return false;
  }
}
