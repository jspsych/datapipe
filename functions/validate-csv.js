import * as CSV from "csv-string";

export default function validateCSV(csv, requiredFields) {
  let parsedCSV = null;
  try {
    parsedCSV = CSV.parse(csv);
  } catch (error) {
    return false;
  }
  if (requiredFields.every((field) => parsedCSV[0].includes(field))) {
    return true;
  } else {
    return false;
  }
}
