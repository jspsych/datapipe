// Will likely change once in production.
import jsPsychMetadata from '@jspsych/metadata';

export default async function produceMetadata(data, options = null) {
  
    // Initializes the metadata object.
    var metadata = new jsPsychMetadata();

    // Checks if the data is in CSV format.
    const isCsv = str => { try { JSON.parse(str); return false; } catch (e) { return true; } };

    const csvFlag = isCsv(data);

    // Parses the data if it is JSON object in string format.
    !csvFlag ? data = JSON.parse(data) : data = data;

    // Generates the metadata, using the options if they are provided.
    options ? await metadata.generate(data, options, csvFlag) : await metadata.generate(data, {}, csvFlag);
    
    return metadata.getMetadata();
  }
 