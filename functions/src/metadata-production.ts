// Will likely change once in production.
import jsPsychMetadata from '../metadata/dist/index.js';
import { Metadata } from './interfaces';

export default async function produceMetadata(data: string, options: object | null = null) {
  
    // Initializes the metadata object.
    var metadata = new jsPsychMetadata();

    // Checks if the data is in CSV format.
    const isCsv = (str: string) => { try { JSON.parse(str); return false; } catch (e) { return true; } };

    const csvFlag: boolean = isCsv(data);

    // Parses the data if it is JSON object in string format.
    !csvFlag ? data = JSON.parse(data) : data = data;

    // Generates the metadata, using the options if they are provided.
    options ? await metadata.generate(data, options, csvFlag) : await metadata.generate(data, {}, csvFlag);

    const incomingMetadata: Metadata = metadata.getMetadata() as Metadata;

    if (!incomingMetadata.variableMeasured || !incomingMetadata.variableMeasured[0].name) {
      throw new Error('Invalid metadata generated');
    }
    
    return incomingMetadata;
  }
 