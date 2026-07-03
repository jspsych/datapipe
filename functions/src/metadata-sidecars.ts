import { deriveFallbackBase, buildPsychDSDataFiles } from '@jspsych/metadata';

export interface SidecarFile {
  filename: string;
  content: string;
}

export interface ExtractionResult {
  extractedArrays: Map<string, Array<Record<string, unknown>>>;
  extractedObjects: Map<string, Array<Record<string, unknown>>>;
  joinKeys: string[];
}

/**
 * Builds the sidecar CSV files for one submission's extracted nested-data
 * columns, mirroring what the @jspsych/metadata CLI writes per data file:
 * one CSV per array-of-objects column (rows keyed by the join keys plus
 * element_index) and one per plain-object column (one row per trial, keyed
 * by the join keys only).
 *
 * The naming and CSV serialisation are delegated to the library's shared
 * buildPsychDSDataFiles (the same function the CLI and browser flows use), so
 * DataPipe's sidecar output stays byte-identical to theirs for the same data.
 * We keep only the sidecar files here (kind 'array'/'object'); the main data
 * CSV (kind 'main') is wired up when api-data adopts the Psych-DS data/ layout.
 *
 * Sidecars are placed in the same one-level subfolder as the data file,
 * matching how putFileOSF resolves "folder/name" filenames.
 */
export default function buildSidecars(
  dataFilename: string,
  extraction: ExtractionResult,
  mainRows: Array<Record<string, unknown>>,
): SidecarFile[] {
  const { extractedArrays, extractedObjects, joinKeys } = extraction;

  if (extractedArrays.size === 0 && extractedObjects.size === 0) return [];

  const slashIndex = dataFilename.indexOf('/');
  const folder = slashIndex === -1 ? '' : dataFilename.slice(0, slashIndex + 1);
  const name = slashIndex === -1 ? dataFilename : dataFilename.slice(slashIndex + 1);

  const dotIndex = name.lastIndexOf('.');
  const stem = dotIndex <= 0 ? name : name.slice(0, dotIndex);

  const base = deriveFallbackBase(stem);

  const files = buildPsychDSDataFiles({
    base,
    mainRows,
    extractedArrays,
    extractedObjects,
    joinKeys,
  });

  return files
    .filter((file) => file.kind !== 'main')
    .map((file) => ({ filename: folder + file.filename, content: file.content }));
}
