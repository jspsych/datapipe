export default function validateJSON(json: string, requiredFields: string[] | undefined) {
  try {
    let parsedJSON: object | null = null;
    try {
      parsedJSON = JSON.parse(json);
    } catch (error) {
      return false;
    }

    // Legacy experiment docs can carry [""] -- the dashboard used to store an
    // empty "required fields" textbox that way before it started filtering
    // empties on input (components/dashboard/ExperimentValidation.js). An
    // empty/whitespace-only entry can never be a real field name, and
    // `.every` demanding one meant every submission failed validation. Drop
    // those here so legacy docs behave the same as a genuinely empty list.
    const fields = (requiredFields ?? []).filter(
      (field) => typeof field === "string" && field.trim() !== ""
    );

    if (fields.length === 0) return true; // If JSON is in valid format, and there is nothing more to check return true.

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
      return fields.every((field: string) => uniqueKeys.includes(field));
    } else {
      const keys: string[] = Object.keys(parsedJSON as object);
      return fields.every((field: string) => keys.includes(field));
    }
  } catch (error) {
    return false;
  }
}
