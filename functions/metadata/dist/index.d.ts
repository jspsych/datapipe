import { AuthorFields } from "./AuthorsMap";
import { VariableFields } from "./VariablesMap";
/**
 * Class that handles the storage, update and retrieval of metadata according to Psych-DS
 * standards.
 *
 * @export
 * @class JsPsychMetadata
 * @typedef {JsPsychMetadata}
 */
export default class JsPsychMetadata {
    /**
     * Field that contains all metadata fields that aren't represented as a list.
     *
     * @private
     * @type {{}}
     */
    private metadata;
    /**
     * Custom class that stores and handles the storage, update and retrieval of author metadata.
     *
     * @private
     * @type {AuthorsMap}
     */
    private authors;
    /**
     * Custom class that stores and handles the storage, update and retrieval of variable metadata.
     *
     * @private
     * @type {VariablesMap}
     */
    private variables;
    /**
     * Custom class that handles the fetching and retrieval of the metadata information from the
     * default descriptions defined in the javadoc of the plugins and extensions. Caches the data
     * to save time and fetching.
     *
     * @private
     * @type {PluginCache}
     */
    private pluginCache;
    /**
     * Initializes a set that contains the variable fields that are to be ignored, so can help with later
     * logic when generating data.
     *
     * @private
     * @type {*}
     */
    private ignored_variables;
    /**
     * Verbose mode that is used in by the tools that call this to print fetching messages and
     * reading messages.
     *
     * @private
     * @type {boolean}
     */
    private verbose;
    private extractedArrays;
    private extractedObjects;
    private arrayJoinKeys;
    private mixedColumns;
    /**
     * Creates an instance of JsPsychMetadata while passing in JsPsych object to have access to context
     *  allowing it to access the screen printing information.
     *
     * @constructor
     * @param {JsPsych} JsPsych
     */
    constructor(verbose?: boolean);
    /**
     * Method that sets simple metadata fields. This method can also be used to update/overwrite existing fields.
     *
     * @param {string} key - Metadata field name
     * @param {*} value - Data associated with the field
     */
    setMetadataField(key: string, value: any): void;
    /**
     * Simple get that accesses the data associated with a field.
     *
     * @param {string} key - Field name
     * @returns {*} - Data associated with the field
     */
    getMetadataField(key: string): any;
    /**
     * Checks if the metadata field exists in the metadata.
     *
     * @param {string} key - Key of metadata being checked.
     * @returns {*} - Boolean
     */
    containsMetadataField(key: string): any;
    /**
     * Deletes a metadata from the metadata if it exists.
     *
     * @param {string} key - Name of field to be deleted
     */
    deleteMetadataField(key: string): void;
    /**
     * Returns the final Metadata in a single javascript object. Bundles together the author and variables
     * together in a list rather than object compliant with Psych-DS standards. Seems that javascript get
     * are implictly called.
     *
     * @returns {{}} - Final Metadata object
     */
    getMetadata(): {};
    getUserMetadataFields(): Record<string, any>;
    /**
     * Returns the variable fields while excluding the authors and variables.`
     *
     * @returns {{}} - Final Metadata object
     */
    getMetadataFields(): {};
    /**
     * Method that creates an author. This method can also be used to overwrite existing authors
     * with the same name in order to update fields.
     *
     * @param {AuthorFields | string} author - All the required or possible fields associated with listing an author according to Psych-DS standards. Option as a string to define an author according only to name.
     */
    setAuthor(fields: AuthorFields): void;
    /**
     * Method that fetches an author object allowing user to update (in existing workflow should not be necessary).
     *
     * @param {string} name - Name of author to be used as key.
     * @returns {(AuthorFields | string | {})} - Object with author information. Empty object if not found.
     */
    getAuthor(name: string): AuthorFields | string | {};
    /**
     * Returns a list of the authors defined in the metadata.
     *
     * @returns {(string | AuthorFields)[]} - Authors
     */
    getAuthorList(): (string | AuthorFields)[];
    /**
     * Deletes an author from the authorsField.
     *
     * @param {string} name - Name of author to be deleted.
     */
    deleteAuthor(name: string): void;
    /**
     * Method that creates a variable. This method can also be used to overwrite variables with the same name
     * as a way to update fields.
     *
     * @param {{
     *     @type?: string;
     *     name: string; // required
     *     description?: string | {};
     *     value?: string; // string, boolean, or number
     *     identifier?: string; // identifier that distinguish across dataset (URL), confusing should check description
     *     minValue?: number;
     *     maxValue?: number;
     *     levels?: string[] | []; // technically property values in the other one but not sure how to format it
     *     levelsOrdered?: boolean;
     *     na?: boolean;
     *     naValue?: string;
     *     alternateName?: string;
     *     privacy?: string;
     *   }} fields - Fields associated with the current Psych-DS standard.
     */
    setVariable(variable: VariableFields): void;
    /**
     * Allows you to access a variable's information by using the name of the variable. Can
     * be used to update fields within a variable, but suggest using updateVariable() to prevent errors.
     *
     * @param {string} name - Name of variable to be accessed
     * @returns {{}} - Returns object of fields
     */
    getVariable(name: string): {};
    /**
     * Returns a list of the variables defined in the metadata.
     *
     * @returns {{}[]} - Authors
     */
    getVariableList(): ({})[];
    /**
     * Allows you to check if the name of the variable exists in variablesMap.
     *
     * @param {string} name - Name of variable
     * @returns {boolean} - Does variable exist in variables
     */
    containsVariable(name: string): boolean;
    /**
     * Allows you to update a variable or add a value in the case of updating values. In other situations will
     * replace the existing value with the new value.
     *
     * @param {string} var_name - Name of variable to be updated.
     * @param {string} field_name - Name of field to be updated.
     * @param {(string | boolean | number | {})} added_value - Value to be used in the update.
     */
    updateVariable(var_name: string, field_name: string, added_value: string | boolean | number | {}): void;
    /**
     * Allows you to delete a variable by key/name.
     *
     * @param {string} var_name - Name of variable to be deleted.
     */
    deleteVariable(var_name: string): void;
    /**
     * Gets a list of all the variable names.
     *
     * @returns {string[]} - List of variable string names.
     */
    getVariableNames(): string[];
    /**
     * Returns accumulated array-column data keyed by column name.
     * Each entry is a list of rows with join key columns, element_index, and the element's own fields.
     * Used by the CLI to write Psych-DS compliant separate CSV files.
     */
    getExtractedArrays(): Map<string, Array<Record<string, any>>>;
    /**
     * Returns accumulated plain-object-column data keyed by the top-level column name.
     * Each entry is one row per trial: the join key columns plus a column for every dotted
     * descendant variable expanded from that object (matching the names in variableMeasured).
     * Used by the CLI to write a separate Psych-DS CSV per object column, so those dotted
     * sub-variables resolve to real columns. No element_index (one row per trial, not per element).
     */
    getExtractedObjects(): Map<string, Array<Record<string, any>>>;
    /**
     * Returns the join key columns used in the most recent generate() call.
     * The CLI uses this to order columns correctly in extracted array CSVs.
     */
    getArrayJoinKeys(): string[];
    private warnJoinKeyUniqueness;
    /**
     * Method that allows you to display metadata at the end of an experiment.
     *
     * @param {string} [elementId="jspsych-metadata-display"] - Id for how to style the metadata. Defaults to default styling.
     */
    displayMetadata(display_element: any): void;
    /**
     * Method that begins a download for the dataset_description.json at the end of experiment.
     * Allows you to download the metadat.
     */
    localSave(): void;
    /**
     * This method loads the metadata into the metadata object. This takes in the"dataset_description.json" string content
     * and first parses it as an object. This then loads in all the fields, authors and variables into the metadata object by calling all the
     * relevant methods that overwrites the default data.
     *
     * @param {string} stringMetadata - String version of the metadata to be loaded from "dataset_description.json".
     */
    loadMetadata(stringMetadata: string): void;
    /**
     * Generates observations based on the input data and processes optional metadata. This is the
     * outer wrapper function that should called and handles the logic of reading individual observations.
     *
     * This method accepts data as a JSON string, a CSV string, or an already-parsed array of
     * observation objects. A string is parsed according to `ext`; an array is consumed as-is.
     * Each observation is processed asynchronously via `generateObservation`. Optionally, metadata
     * options can be provided as an object, and each key-value pair is processed by `processMetadata`.
     *
     * NOTE: when `data` is a pre-parsed array it is consumed in place and MUTATED — unnamed
     * (blank-header) columns are deleted from the row objects. Callers that need the rows to stay
     * pristine must pass a copy. This lets a caller parse a file once and share the rows with
     * generate() instead of having generate() re-parse the same content.
     *
     * @async
     * @param {Array|String} data - Observations to generate from: a pre-parsed array (consumed as-is and mutated in place), a JSON string, or a CSV string.
     * @param {Object} [metadata={}] - Optional metadata to be processed. Each key-value pair in this object will be processed individually.
     * @param {'json'|'csv'} [ext='json'] - Format of a string `data`; ignored when `data` is already an array.
     * @param {Object} [options={}] - arrayJoinKeys / suppressJoinKeyWarning, plus synthesizedSourceRecordId for pre-parsed callers that tagged a synthetic source_record_id themselves.
     */
    generate(data: any, metadata?: {}, ext?: string, options?: {
        arrayJoinKeys?: string[];
        suppressJoinKeyWarning?: boolean;
        synthesizedSourceRecordId?: boolean;
    }): Promise<void>;
    /**
     * This function iterates through the entire row of data stepping through one column at a time.
     * It is designed to only be accessed through calling generate on an entire data file.
     * Searching for plugin, plugin version, extension, extension it then calls the
     * helper methods that process the individual row of data. There is limited error chcking and
     * type conversion from csv due to the way that csv data is represented as strings.
     * This method also handles extensions, declaring them if necessary and iterate through each.
     * This method also skips generating descriptions the variables that should the same for
     * all variables and instead updates their fields.
     *
     * @private
     * @async
     * @param {*} observation Dictionary that represent one row of data
     * @returns {*}
     */
    private generateObservation;
    /**
     * Iterates through one single datapoint which can be thought of as one row-column pair.
     * This method keeps in mind the versionType or pluginType and uses this to generate the
     * metadata.
     *
     * @private
     * @async
     * @param {*} variable - The column name
     * @param {*} value - The value at the row-column mapping that is being used to update fields
     * @param {*} pluginType - The type of the plugin that is used for the fetching (can also be extension if extension?=true)
     * @param {*} version - The version of the plugin that is not necessary but is used post v8 to ensure accurate fetching
     * @param {?*} [extension] - This boolean determines whether is a extension to change fetching
     * @returns {*}
     */
    private generateMetadata;
    /**
     * This calls an update to the individual fields of the metadata, updating levels and
     * minValue and maxValue depeneding on the variable type.
     *
     * @private
     * @param {*} variable - The column of the data and name of variable
     * @param {*} value - The datapoint
     * @param {*} type - The type of the datapoint
     */
    private updateFields;
    /**
     * Iterates through the entire metadata options object by calling processMetadata() to act upon each of the
     * individual fields at one time.
     *
     * @async
     * @param {*} metadata - Metadata options that contains all the metadata according to Psych-DS formatting.
     */
    updateMetadata(metadata: any): Promise<void>;
    /**
     * This is the method that processes each individual element of the metadata options to be updated. This can be called through generate or outside of it,
     * and this processes each element.
     *
     * @private
     * @param {*} metadata - An object that contains all of the metadata. This is used to access the value.
     * @param {*} key - String key that denotes what key-value mapping is being iterated upon.
     */
    private processMetadata;
    /**
     * Applies a user-chosen `value:"boolean"` override to an already-populated variable.
     * Warns when the values detected from the data don't map cleanly to boolean logic
     * (anything other than true/false/0/1, case-insensitive), then drops the detected
     * levels/min/max so the variable matches how genuine booleans are recorded (no levels).
     */
    private applyBooleanOverride;
    /**
     * Registers the keys of a plain JSON object as dotted sub-variables
     * (e.g. response.Q0, response.Q1) and registers the parent with value: "object".
     *
     * Recurses into nested plain objects so structures more than one level deep are
     * fully expanded (e.g. response.address.city). Nested arrays are registered with
     * value: "array" (typeof [] === "object", so the inferred type must be overridden)
     * and, when they hold objects, extracted into a separate CSV keyed by their dotted
     * column name — mirroring how top-level array columns are handled.
     *
     * @param joinValues - The current row's join key values, prepended to every
     *   extracted nested-array row so the sub-table can be rejoined to the main data.
     */
    private expandObjectFields;
    /**
     * Accumulates the object elements of an array column into `extractedArrays` for
     * separate Psych-DS CSV output, keyed by the column's (possibly dotted) name.
     * Each emitted row is the join key values, an `element_index`, then the element's
     * fields under DOTTED names (`columnName.field`) so they don't collide with top-level
     * columns or with fields of other array columns. Every emitted column is registered in
     * variableMeasured so the sidecar CSV has no columns missing from the metadata.
     *
     * Element fields recurse (see expandElementFields): a nested plain object is expanded
     * into deeper dotted columns in the SAME row; a nested array is extracted into its own
     * grandchild CSV, joinable via `${columnName}.element_index` (this element's position)
     * carried alongside the existing join keys.
     *
     * Null / primitive top-level array elements are skipped; arrays with no object elements
     * produce no rows.
     */
    private accumulateArrayColumn;
    /**
     * Recursively records one array element's fields into `row` under dotted names. Scalars become
     * columns with type + min/max/levels tracking; nested plain objects are expanded into the SAME
     * row (deeper dotted columns); nested arrays are extracted into their own grandchild CSV via
     * accumulateArrayColumn (keyed by `nestedJoin`). Object/array nodes are also kept as a single
     * dotted JSON column so their own name is represented as a column too.
     */
    private expandElementFields;
    /** Registers an object/array node variable once (with its plugin description, if any). */
    private registerNodeVariable;
    /**
     * Registers one scalar array-element field under its dotted name (so the sidecar column is
     * represented in variableMeasured), then folds later values into min/max/levels. Empty values
     * still declare the column (placeholder) without polluting min/max/levels.
     */
    private registerScalarField;
    /**
     * Gets the description of a variable in a plugin by fetching the source code of the plugin
     * from a remote source (usually unpkg.com) as a string, passing the script to getJsdocsDescription
     * to extract the description for the variable (present as JSDoc); caches the result for future use.
     *
     * @param {string} pluginType - The type of the plugin for which information is to be fetched.
     * @param {string} variableName - The name of the variable for which information is to be fetched.
     * @param {string} version - The version of the plugin or extension
     * @param {string} extension - Boolean indicating if pluginType refers to extension
     * @returns {Promise<string|null>} The description of the plugin variable if found, otherwise null.
     * @throws Will throw an error if the fetch operation fails.
     */
    private getPluginInfo;
}
export { AuthorFields, VariableFields };
export { analyzeJoinKeys, parseCSV, parseJsonData, unwrapTrials, isValidPsychDSDataFilename, toPsychDSValue, deriveArrayFilename, objectsToCSV, disambiguateArrayFilename, deriveFallbackBase, buildPsychDSDataFiles, stripUnnamedColumns, hasUnnamedColumns, PSYCHDS_IGNORE_FILENAME, PSYCHDS_IGNORE_CONTENT } from "./utils";
export type { JoinKeyAnalysis, PsychDSDataFile, BuildPsychDSDataFilesArgs } from "./utils";
