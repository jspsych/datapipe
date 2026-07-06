import jsPsychMetadata, { parseCSV, parseJsonData } from '@jspsych/metadata';
import { Metadata } from './interfaces';
import { ExtractionResult } from './metadata-derived-files.js';

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
  // The original CSV text, verbatim, when the submission was CSV — passed to
  // buildPsychDSDataFiles as mainContent so the main data CSV keeps its exact
  // bytes (column order, quoting) instead of being re-serialised from mainRows.
  // Undefined for JSON submissions.
  mainContent?: string;
}

export default async function produceMetadata(data: string, options: object | null = null): Promise<ProducedMetadata> {

    // Initializes the metadata object.
    var metadata = new jsPsychMetadata(); // eslint-disable-line no-var

    // Parse the payload exactly once. parseJsonData is the library's own
    // parser (the CLI and frontend run it too): a bare trial array — the
    // standard jsPsych/DataPipe payload — passes through unchanged, and the
    // nonstandard-but-possible { "trials": [...] } wrapper is unwrapped to its
    // array. If that parse fails, the payload is CSV text instead.
    let csvFlag: boolean;
    let jsonRows: Array<Record<string, unknown>> | undefined;
    try {
      const parsed = parseJsonData(data);
      if (!Array.isArray(parsed)) {
        throw new Error('Data must be an array of trials');
      }
      jsonRows = parsed as Array<Record<string, unknown>>;
      csvFlag = false;
    } catch (e) {
      if (e instanceof Error && e.message === 'Data must be an array of trials') throw e;
      csvFlag = true;
    }

    // For CSV, parse once up front too and hand generate() the same rows used
    // for mainRows below, instead of generate() re-parsing the text itself.
    const csvRows: Array<Record<string, unknown>> | undefined = csvFlag
      ? (await parseCSV(data)) as Array<Record<string, unknown>>
      : undefined;

    // Generates the metadata, using the options if they are provided.
    // The vendored @jspsych/metadata (see functions/metadata/) changed generate()'s
    // signature to generate(data, metadata={}, ext='json'|'csv', options={}) — the 3rd
    // arg is now a string extension, not the boolean csv flag the old fork used.
    // Passing a pre-parsed array (rather than the raw string) skips generate()'s
    // own internal parse for both formats; ext is still passed for its other
    // format-dependent behavior (e.g. id-column detection).
    const ext: 'json' | 'csv' = csvFlag ? 'csv' : 'json';
    const rows = (csvFlag ? csvRows : jsonRows) as Array<Record<string, unknown>>;
    options ? await metadata.generate(rows, options, ext) : await metadata.generate(rows, {}, ext);

    const incomingMetadata: Metadata = metadata.getMetadata() as Metadata;

    if (!incomingMetadata.variableMeasured?.length || !incomingMetadata.variableMeasured[0].name) {
      throw new Error('Invalid metadata generated');
    }

    // Nested array/object columns that generate() expanded into dotted
    // sub-variables; their per-row data is returned so callers can write
    // sidecar CSVs (see metadata-derived-files.ts).
    return {
      metadata: incomingMetadata,
      extractedArrays: metadata.getExtractedArrays(),
      extractedObjects: metadata.getExtractedObjects(),
      joinKeys: metadata.getArrayJoinKeys(),
      // Same rows array passed to generate() above — see the mainRows doc
      // comment for why sharing (rather than re-parsing) is intentional.
      mainRows: rows,
      mainContent: csvFlag ? data : undefined,
    };
  }
