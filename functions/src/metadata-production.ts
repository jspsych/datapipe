import jsPsychMetadata from '@jspsych/metadata';
import { Metadata } from './interfaces';

export default async function produceMetadata(data: string, options: object | null = null) {
  
    // Initializes the metadata object.
    var metadata = new jsPsychMetadata(); // eslint-disable-line no-var

    // Checks if the data is in CSV format.
    const isCsv = (str: string) => { try { JSON.parse(str); return false; } catch (e) { return true; } };

    const csvFlag: boolean = isCsv(data);

    // Parses the data if it is JSON object in string format.
    if(!csvFlag) data = JSON.parse(data);

    // Generates the metadata, using the options if they are provided.
    // The vendored @jspsych/metadata (see functions/metadata/) changed generate()'s
    // signature to generate(data, metadata={}, ext='json'|'csv', options={}) — the 3rd
    // arg is now a string extension, not the boolean csv flag the old fork used.
    const ext: 'json' | 'csv' = csvFlag ? 'csv' : 'json';
    options ? await metadata.generate(data, options, ext) : await metadata.generate(data, {}, ext);

    const incomingMetadata: Metadata = metadata.getMetadata() as Metadata;

    if (!incomingMetadata.variableMeasured || !incomingMetadata.variableMeasured[0].name) {
      throw new Error('Invalid metadata generated');
    }
    
    return incomingMetadata;
  }
 