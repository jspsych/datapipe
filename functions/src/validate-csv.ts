import * as CSV from "csv-string";

export default function validateCSV(csv: string, requiredFields: string[] | undefined) {
  try {
    let parsedCSV: string[][]| null = null;
    try {
      parsedCSV = CSV.parse(csv);
      console.log(parsedCSV);
    } catch (error) {
      return false;
    }

    if (parsedCSV.some((row) => row.length !== parsedCSV[0].length)) return false; // If any row has a different length than the first row, return false.

    if (!requiredFields) return true; // If CSV is in valid format, and there is nothing more to check return true.

    if (requiredFields.every((field: string) => parsedCSV[0].includes(field))) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    return false;
  }
}
