import { createHash } from 'crypto';
import {
  deriveFallbackBase,
  buildPsychDSDataFiles,
  PSYCHDS_IGNORE_FILENAME,
  PSYCHDS_IGNORE_CONTENT,
} from '@jspsych/metadata';

// A file derived from one submission's data, with its full path relative to
// the OSF component root (e.g. "data/subject-abc123_data.csv").
export interface DerivedFile {
  filename: string;
  content: string;
}

export interface ExtractionResult {
  extractedArrays: Map<string, Array<Record<string, unknown>>>;
  extractedObjects: Map<string, Array<Record<string, unknown>>>;
  joinKeys: string[];
}

// What buildDerivedFiles needs from produceMetadata's result.
export interface DerivedFileSource extends ExtractionResult {
  mainRows: Array<Record<string, unknown>>;
  mainContent?: string;
}

/**
 * Researcher-supplied folder prefixes (e.g. "condition-A/abc.json") are
 * flattened into the Psych-DS layout: the CLI converts whole directories into
 * a flat data/ folder, and DataPipe matches it, so the path is encoded into a
 * single filename rather than nested. Flattening is DataPipe's job rather
 * than the provider's because two of the four backends rewrite slashed names
 * themselves -- Zenodo's keyspace is flat and silently renames, Drive stores
 * by bare leaf -- and the collision cache matches names exactly, so a
 * server-side rename we did not predict becomes a duplicate or an overwrite.
 *
 * Separators collapse to "-" and a short digest of the ORIGINAL name is
 * appended before the extension: "condition-A/data.json" ->
 * "condition-A-data~a8c61a73.json". Names containing no "/", "\" or "~" --
 * effectively every real submission -- pass through byte-for-byte, so the
 * stored file keeps the name the researcher chose.
 *
 * WHY THE DIGEST. The raw path doubles as the collision-cache claim, so two
 * distinct submitted names reaching one path means a legitimate submission is
 * rejected as a duplicate. A bare "/" -> "-" collapse is not injective: it let
 * "condition-A/data.json" shadow "condition-A-data.json". The digest splits
 * the output into two provably disjoint sets -- a passed-through name can
 * never contain "~", a flattened one always does -- which closes that
 * shadowing case by construction rather than by chance. Within the flattened
 * set two names collide only if they collapse identically AND their digests
 * match; that is a 2^-32 tail on an input set of names differing only in
 * their separators, not a general birthday bound. A submitted name that
 * already contains "~" takes the flattened branch for the same reason, so it
 * cannot impersonate a flattened one.
 *
 * Derived CSV/sidecar stems built from this name additionally go through the
 * library's lossy toPsychDSValue sanitiser; the raw path and its
 * collision-cache claim are the duplicate guard, not the derived names.
 */
const NEEDS_FLATTENING = /[/\\~]/;
const DIGEST_LENGTH = 8;

function flattenName(dataFilename: string): string {
  if (!NEEDS_FLATTENING.test(dataFilename)) return dataFilename;

  const collapsed = dataFilename.replace(/[/\\]+/g, '-');
  const digest = createHash('sha256')
    .update(dataFilename, 'utf8')
    .digest('hex')
    .slice(0, DIGEST_LENGTH);

  // The extension is read off the ORIGINAL leaf, not the collapsed string: a
  // dotfile leaf ("dir/.hidden") has no extension, but collapsing moves its
  // dot away from index 0 where a naive lastIndexOf would mistake it for one.
  const leaf = dataFilename.split(/[/\\]/).pop() as string;
  const dotIndex = leaf.lastIndexOf('.');
  const extension = dotIndex <= 0 ? '' : leaf.slice(dotIndex);
  const stem = extension ? collapsed.slice(0, collapsed.length - extension.length) : collapsed;

  return `${stem}~${digest}${extension}`;
}

/**
 * The OSF path for the byte-verbatim original submission when metadata is on:
 * data/raw/<original name>. This is the critical upload — every other file is
 * derived from it — and .psychds-ignore excludes raw/ from Psych-DS validation.
 */
export function rawDataPath(dataFilename: string): string {
  return `data/raw/${flattenName(dataFilename)}`;
}

/**
 * The OSF path a raw submission should actually be uploaded to: `data/raw/`
 * when metadata is on, unchanged at the root otherwise. Callers that key
 * queue/dedup entries off the upload filename (api-data's request path and
 * scheduled-pending-recovery) must agree on this, so the rule lives here once.
 */
export function uploadPathFor(metadataActive: boolean | undefined, dataFilename: string): string {
  return metadataActive ? rawDataPath(dataFilename) : dataFilename;
}

/**
 * Builds the full set of Psych-DS files derived from one submission, mirroring
 * what the @jspsych/metadata CLI writes per data file: the main data table as
 * data/<base>_data.csv, one sidecar CSV per extracted array-of-objects or
 * plain-object column (data/<base>_measure-<col>_data.csv), and .psychds-ignore
 * at the component root so validators skip data/raw/.
 *
 * Naming and CSV serialisation are delegated to the library's shared
 * buildPsychDSDataFiles (the same function the CLI and browser flows use), so
 * DataPipe's output stays byte-identical to theirs for the same data. A CSV
 * submission passes mainContent so the main file keeps its exact original
 * bytes; JSON submissions get their main table serialised from mainRows.
 *
 * All of these are derivable from the raw file, so callers upload them
 * best-effort after the raw file itself lands (see rawDataPath above).
 */
export default function buildDerivedFiles(
  dataFilename: string,
  source: DerivedFileSource,
): DerivedFile[] {
  const name = flattenName(dataFilename);

  const dotIndex = name.lastIndexOf('.');
  const stem = dotIndex <= 0 ? name : name.slice(0, dotIndex);

  const files = buildPsychDSDataFiles({
    base: deriveFallbackBase(stem),
    mainRows: source.mainRows,
    mainContent: source.mainContent,
    extractedArrays: source.extractedArrays,
    extractedObjects: source.extractedObjects,
    joinKeys: source.joinKeys,
  });

  return [
    ...files.map((file) => ({ filename: `data/${file.filename}`, content: file.content })),
    { filename: PSYCHDS_IGNORE_FILENAME, content: PSYCHDS_IGNORE_CONTENT },
  ];
}
