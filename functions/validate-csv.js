import * as CSV from 'csv-string';


export default function validateCSV(csv) {
  let parsedCSV = null;
  try {
    parsedCSV = CSV.parse(csv);
    console.log(parsedCSV)
  } catch (error) {
    console.log(error);
    return false;
  }
  if(parsedCSV[0].includes('trial_type')){
    return true;
  } else {
    return false;
  }

  return true;
}