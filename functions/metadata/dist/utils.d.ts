export declare const PSYCHDS_IGNORE_FILENAME = ".psychds-ignore";
export declare const PSYCHDS_IGNORE_CONTENT = "**/raw/\n.psychds-ignore\n";
export declare function saveTextToFile(textstr: string, filename: string): void;
export declare function JSON2CSV(objArray: any): string;
export declare function tryParseJSON(value: string): any | null;
/**
 * Some jsPsych exports (e.g. from OSF) wrap the trials array as { "trials": [...] }
 * instead of a bare array. Accepts the raw JSON string (or an already-parsed value)
 * and returns the unwrapped trials array ONLY when the input is exactly that wrapper —
 * an object whose single key is `trials` and whose value is an array. Otherwise returns
 * the parsed value unchanged so the caller's existing Array.isArray gate keeps its
 * current behavior (the library throws on a non-array; the CLI/frontend skip non-array JSON).
 *
 * The single-key check is deliberate: this supports the known wrapper shape, it does not
 * treat `trials` as a magic key. A future export like { trials: [...], meta: {...} } is
 * left untouched rather than silently discarding its top-level metadata.
 *
 * Folded into parseJsonData's whole-document fast path so every data parse site (generate(),
 * the CLI pipeline, the frontend uploader) gets wrapper support through the one shared parser;
 * also exported for direct use and testing.
 */
export declare function unwrapTrials(data: string | unknown): unknown;
/**
 * Parses experiment data that is either a single JSON document (the standard jsPsych
 * export — one array of trials, possibly pretty-printed) or JSON-Lines: one JSON value
 * per line, as JATOS and several labs export it (typically one participant's trial
 * array per line). Returns a flat array of observations in both cases.
 *
 * A well-formed single document is returned as-is (arrays untouched, so existing
 * single-array callers see no change), except an exact { "trials": [...] } wrapper is
 * unwrapped to its array via {@link unwrapTrials}. Only when whole-string parsing fails do
 * we fall back to line-by-line parsing, flattening any per-line arrays into one observation
 * stream. Throws a descriptive error when the input is neither valid JSON nor valid JSONL.
 *
 * When `tagSourceRecordId` is set, `stats.synthesizedSourceRecordId` is set to true iff a
 * source_record_id was actually stamped onto at least one row (i.e. the data did not already
 * carry a source_record_id or a real participant_id). Callers use this to describe the column
 * honestly — a synthesized id marks the source record/line, not a real subject identifier, and
 * must not be presented as one.
 */
export declare function parseJsonData(content: string, options?: {
    tagSourceRecordId?: boolean;
}, stats?: {
    synthesizedSourceRecordId?: boolean;
}): any;
/** System columns excluded from join-key candidate detection; also used to initialise ignored_variables in JsPsychMetadata. */
export declare const SYSTEM_COLUMNS: Set<string>;
export interface JoinKeyAnalysis {
    isUnique: boolean;
    duplicateCount: number;
    /** Up to 5 example key-value maps for rows that share a composite key. */
    duplicateValues: Array<Record<string, any>>;
    /** All non-system, non-selected columns, categorised by whether adding them alone achieves uniqueness. */
    candidates: Array<{
        column: string;
        makesUnique: boolean;
    }>;
    /**
     * null  — data is already unique, no action needed.
     * []    — at least one single candidate column is sufficient; the user should pick from candidates.
     * [...] — no single column is sufficient; greedy result of columns to add together.
     */
    suggestedAdditionalKeys: string[] | null;
}
export declare function analyzeJoinKeys(parsedData: Array<Record<string, any>>, keys: string[]): JoinKeyAnalysis;
/** True if `name` is a fully Psych-DS-compliant data filename. */
export declare function isValidPsychDSDataFilename(name: string): boolean;
/**
 * Coerces an arbitrary string into a Psych-DS *value* segment ([a-zA-Z0-9]+).
 * Runs of non-alphanumeric characters are treated as word boundaries: removed
 * and the next word capitalised, yielding camelCase so meaning is preserved
 * (e.g. "mouse_tracking" → "mouseTracking", "RT (ms)" → "RTMs").
 * Returns `fallback` when the input has no alphanumeric characters.
 */
export declare function toPsychDSValue(name: string, fallback?: string): string;
/**
 * Builds a Psych-DS-compliant filename *base* (the keyword-value sequence before
 * `_data.csv`) from an arbitrary file stem, with no interactive input. Used by
 * callers that lack a user-supplied/normalized base (e.g. the browser flow): the
 * stem becomes the value of the official `subject` keyword, coerced to a valid
 * value segment via {@link toPsychDSValue} (e.g. "sub01" → "subject-sub01",
 * "subject 1.json".replace stem "subject 1" → "subject-subject1"). `subject` is an
 * official Psych-DS keyword, so the resulting main datafile avoids the validator's
 * unofficial-keyword warning. The result always satisfies
 * {@link isValidPsychDSDataFilename} once `_data.csv` is appended.
 */
export declare function deriveFallbackBase(stem: string): string;
/**
 * Derives the Psych-DS filename for an extracted-array CSV from its parent
 * file's already-normalized base plus the column name:
 *   base "subject-subject1" + column "mouse_tracking"
 *     → "subject-subject1_measure-mouseTracking_data.csv"
 */
export declare function deriveArrayFilename(parentBase: string, columnName: string): string;
/**
 * Serialises an array of objects to RFC 4180 CSV. Nested objects/arrays in a
 * cell are serialised as JSON strings so no data is lost. Priority columns
 * (trial_index, element_index by default) are placed first; remaining columns
 * follow in the order they first appear across all rows.
 */
export declare function objectsToCSV(rows: Array<Record<string, any>>, priorityCols?: string[]): string;
/**
 * Returns a filename not already present in `used`. If `base` is free it is
 * returned as-is; otherwise a counter is appended before the `_data.csv`
 * suffix (e.g. foo_measure-bar_data.csv → foo_measure-bar2_data.csv) until a
 * free name is found. The counter has no separator — a hyphen or underscore
 * would create an invalid Psych-DS keyword-value pair.
 *
 * KEEP IN SYNC: the CLI's resolveCollisions (packages/cli/src/rename.ts) applies
 * the same no-separator counter to its rename preview (this one writes, that one
 * previews — different input shapes keep them separate implementations). If the
 * counter convention ever changes, both must change together or previewed and
 * written names will diverge.
 */
export declare function disambiguateArrayFilename(base: string, used: Set<string>): string;
/**
 * True when any row carries an {@link isUnnamedHeader unnamed} column. Lets a caller decide,
 * *before* `generate()` mutates the rows in place, whether a CSV source can be written back
 * byte-for-byte (no unnamed columns) or must be re-serialised from the cleaned rows. Kept as a
 * shared predicate so the CLI and browser conversion paths share one definition of "unnamed"
 * with {@link stripUnnamedColumns}, rather than each re-implementing the header scan.
 */
export declare function hasUnnamedColumns(rows: Array<Record<string, any>>): boolean;
/**
 * Removes columns whose name is empty or whitespace-only from every row, in place,
 * and reports which names were dropped. R's `write.csv` (with the default
 * `row.names = TRUE`) prepends an unnamed row-index column, which surfaces as an
 * empty-string ("") header. Such a column can never be represented in a Psych-DS
 * `variableMeasured` entry (a name is required), so leaving it in produces a dataset
 * that fails validation with CSV_COLUMN_MISSING_FROM_METADATA. Dropping it up front —
 * once, rather than warning per row — keeps the generated metadata and the written
 * CSV consistent. Returns the same `rows` reference for convenient chaining.
 */
export declare function stripUnnamedColumns(rows: Array<Record<string, any>>): {
    rows: Array<Record<string, any>>;
    dropped: string[];
};
/** A single converted Psych-DS output file produced by {@link buildPsychDSDataFiles}. */
export interface PsychDSDataFile {
    /** Psych-DS-compliant filename, relative to the `data/` directory. */
    filename: string;
    /** RFC-4180 CSV contents. */
    content: string;
    /** Which source the rows came from: the main table, an array column, or an object column. */
    kind: 'main' | 'array' | 'object';
}
export interface BuildPsychDSDataFilesArgs {
    /** Compliant filename base (keyword-value sequence before `_data.csv`), e.g. "id-sub01". */
    base: string;
    /**
     * Parsed rows of the main data file. Serialised to CSV unless `mainContent` is given and
     * no unnamed columns are dropped. Always supply this (parse CSV inputs too) so unnamed
     * row-index columns can be detected and stripped.
     */
    mainRows: Array<Record<string, any>>;
    /**
     * Pre-rendered CSV for the main file, used verbatim instead of serialising `mainRows` —
     * but only when no unnamed columns are dropped. Pass this when the source is already CSV
     * so a clean file keeps its exact bytes (column order, quoting); a file with an unnamed
     * column is re-serialised from the cleaned `mainRows` instead.
     */
    mainContent?: string;
    /** Array-column rows keyed by column name (from `JsPsychMetadata.getExtractedArrays`). */
    extractedArrays?: Map<string, Array<Record<string, any>>>;
    /** Object-column rows keyed by column name (from `JsPsychMetadata.getExtractedObjects`). */
    extractedObjects?: Map<string, Array<Record<string, any>>>;
    /** Join keys used when extracting nested columns (from `JsPsychMetadata.getArrayJoinKeys`). */
    joinKeys?: string[];
    /**
     * Set of already-used output filenames, shared across all files in a dataset so names are
     * disambiguated against the whole `data/` directory. Mutated: every name returned is added.
     */
    usedArrayFilenames?: Set<string>;
}
/**
 * Turns one parsed data file (plus any nested array/object columns extracted during
 * `JsPsychMetadata.generate`) into its set of Psych-DS CSV outputs. Pure and
 * filesystem-agnostic: the caller decides where the returned contents go (the CLI writes
 * them to disk, the browser puts them in a file tree / zip). Mirrors the conversion the CLI
 * performs inline so both share one implementation.
 *
 * The main table becomes `${base}_data.csv`; each extracted array/object column becomes a
 * sidecar named via {@link deriveArrayFilename}, disambiguated against `usedArrayFilenames`.
 * Throws if a resolved name isn't Psych-DS-compliant (an invalid `base` reaching here is a
 * programming error — callers derive `base` with {@link deriveFallbackBase} or a validated plan).
 */
export declare function buildPsychDSDataFiles(args: BuildPsychDSDataFilesArgs): PsychDSDataFile[];
export declare function parseCSV(input: any): Promise<unknown>;
