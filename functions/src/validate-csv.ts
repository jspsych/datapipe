import * as CSV from "csv-string";

export default function validateCSV(csv: string, requiredFields: string[]) {
  try {
    let parsedCSV: string[][]| null = null;
    try {
      parsedCSV = CSV.parse(csv);
    } catch (error) {
      return false;
    }
    if (requiredFields.every((field: string) => parsedCSV[0].includes(field))) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    return false;
  }
}
