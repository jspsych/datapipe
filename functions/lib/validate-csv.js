import * as CSV from "csv-string";
export default function validateCSV(csv, requiredFields) {
    try {
        let parsedCSV = null;
        try {
            parsedCSV = CSV.parse(csv);
        }
        catch (error) {
            return false;
        }
        if (requiredFields.every((field) => parsedCSV[0].includes(field))) {
            return true;
        }
        else {
            return false;
        }
    }
    catch (error) {
        return false;
    }
}
//# sourceMappingURL=validate-csv.js.map