import * as CSV from "csv-string";

export default function validateCSV(csv: string, requiredFields: string[] | undefined) {
  try {
    let parsedCSV: string[][]| null = null;
    try {
      parsedCSV = CSV.parse(csv);
    } catch (error) {
      return false;
    }

    if (parsedCSV.some((row) => row.length !== parsedCSV[0].length)) return false; // If any row has a different length than the first row, return false.

    // Legacy experiment docs can carry [""] -- the dashboard used to store an
    // empty "required fields" textbox that way before it started filtering
    // empties on input (components/dashboard/ExperimentValidation.js). An
    // empty/whitespace-only entry can never be a real field name, and
    // `.every` demanding one meant every submission failed validation. Drop
    // those here so legacy docs behave the same as a genuinely empty list.
    const fields = (requiredFields ?? []).filter(
      (field) => typeof field === "string" && field.trim() !== ""
    );

    if (fields.length === 0) return true; // If CSV is in valid format, and there is nothing more to check return true.

    if (fields.every((field: string) => parsedCSV[0].includes(field))) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    return false;
  }
}
