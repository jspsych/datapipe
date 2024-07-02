export default function validateJSON(json: string, requiredFields: string[] | undefined) {
  try {
    let parsedJSON: object | null = null;
    try {
      parsedJSON = JSON.parse(json);
    } catch (error) {
      return false;
    }

    if (!requiredFields) return true; // If JSON is in valid format, and there is nothing more to check return true.

    if (Array.isArray(parsedJSON)) {
      const keys = new Set();

      // Iterate over the array of objects
      for (const object of parsedJSON) {
        // Get the keys for each object and add them to the Set
        const k: string[] = Object.keys(object);
        for (const key of k) {
          keys.add(key);
        }
      }

      const uniqueKeys = Array.from(keys);

      // Check if all required fields are present in the Set
      return requiredFields.every((field: string) => uniqueKeys.includes(field));
    } else {
      const keys: string[] = Object.keys(parsedJSON as object);
      return requiredFields.every((field: string) => keys.includes(field));
    }
  } catch (error) {
    return false;
  }
}
