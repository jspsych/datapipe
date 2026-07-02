import { deriveFallbackBase, deriveArrayFilename, disambiguateArrayFilename, objectsToCSV } from '@jspsych/metadata';

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
 * by the join keys only). Naming reuses the library's own Psych-DS helpers
 * (deriveFallbackBase + deriveArrayFilename) so DataPipe's sidecar names
 * match the CLI's for the same data.
 *
 * Sidecars are placed in the same one-level subfolder as the data file,
 * matching how putFileOSF resolves "folder/name" filenames.
 */
export default function buildSidecars(
  dataFilename: string,
  extraction: ExtractionResult,
): SidecarFile[] {
  const { extractedArrays, extractedObjects, joinKeys } = extraction;

  if (extractedArrays.size === 0 && extractedObjects.size === 0) return [];

  const slashIndex = dataFilename.indexOf('/');
  const folder = slashIndex === -1 ? '' : dataFilename.slice(0, slashIndex + 1);
  const name = slashIndex === -1 ? dataFilename : dataFilename.slice(slashIndex + 1);

  const dotIndex = name.lastIndexOf('.');
  const stem = dotIndex <= 0 ? name : name.slice(0, dotIndex);

  const base = deriveFallbackBase(stem);

  //Distinct columns can normalize to the same Psych-DS name; the library's
  //disambiguation appends a counter, exactly as the CLI does.
  const usedFilenames = new Set<string>();
  const reserve = (filename: string): string => {
    const resolved = disambiguateArrayFilename(filename, usedFilenames);
    usedFilenames.add(resolved);
    return resolved;
  };

  const sidecars: SidecarFile[] = [];

  for (const [column, rows] of extractedArrays) {
    sidecars.push({
      filename: folder + reserve(deriveArrayFilename(base, column)),
      content: objectsToCSV(rows, [...joinKeys, 'element_index']),
    });
  }

  for (const [column, rows] of extractedObjects) {
    sidecars.push({
      filename: folder + reserve(deriveArrayFilename(base, column)),
      content: objectsToCSV(rows, joinKeys),
    });
  }

  return sidecars;
}
