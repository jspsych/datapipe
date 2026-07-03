import jsPsychMetadata, { parseCSV } from '@jspsych/metadata';
import { Metadata } from './interfaces';
import { ExtractionResult } from './metadata-sidecars.js';

export interface ProducedMetadata extends ExtractionResult {
  metadata: Metadata;
  // Parsed rows of the main data table, used as buildPsychDSDataFiles' mainRows
  // (and, for CSV, for unnamed-column detection). generate() does NOT flatten
  // nested columns here: the rows keep their nested object/array values, which
  // objectsToCSV then serialises as JSON strings in the main CSV (lossless) —
  // the dotted expansion (response.Q0, mouse_tracking_data.x) lives only in
  // variableMeasured and the sidecars. For JSON this is the parsed trial array;
  // for CSV it is parsed from the original text via the library's parseCSV.
  mainRows: Array<Record<string, unknown>>;
}

export default async function produceMetadata(data: string, options: object | null = null): Promise<ProducedMetadata> {

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

    // Main data rows for the Psych-DS main CSV. For JSON, `data` is the parsed
    // array (nested columns left intact — see mainRows doc above); for CSV,
    // parse the original text (the string `data` is untouched — generate()
    // parses its own copy internally).
    const mainRows: Array<Record<string, unknown>> = csvFlag
      ? (await parseCSV(data)) as Array<Record<string, unknown>>
      : (data as unknown as Array<Record<string, unknown>>);

    // Nested array/object columns that generate() expanded into dotted
    // sub-variables; their per-row data is returned so callers can write
    // sidecar CSVs (see metadata-sidecars.ts).
    return {
      metadata: incomingMetadata,
      extractedArrays: metadata.getExtractedArrays(),
      extractedObjects: metadata.getExtractedObjects(),
      joinKeys: metadata.getArrayJoinKeys(),
      mainRows,
    };
  }
