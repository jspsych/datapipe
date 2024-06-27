/**
 * Interface that defines the type for the fields that are specified for authors
 * according to Psych-DS regulations, with name being the one required field.
 *
 * @export
 * @interface AuthorFields
 * @typedef {AuthorFields}
 */
interface AuthorFields {
    /** The type of the author. */
    type?: string;
    /** The name of the author. (required) */
    name: string;
    /** The given name of the author. */
    givenName?: string;
    /** The family name of the author. */
    familyName?: string;
    /** The identifier that distinguishes the author across datasets (URL). */
    identifier?: string;
}

/**
 * Interface that defines the type for the fields that are specified for variables
 * according to Psych-DS regulations, with name being the one required field.
 *
 * @export
 * @interface VariableFields
 * @typedef {VariableFields}
 */
interface VariableFields {
    type?: string;
    name: string;
    description?: string | Record<string, string>;
    value?: string;
    identifier?: string;
    minValue?: number;
    maxValue?: number;
    levels?: string[] | [];
    levelsOrdered?: boolean;
    na?: boolean;
    naValue?: string;
    alternateName?: string;
    privacy?: string;
}

/**
 * Class that handles the storage, update and retrieval of Metadata.
 *
 * @export
 * @class JsPsychMetadata
 * @typedef {JsPsychMetadata}
 */
declare class JsPsychMetadata {
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
    /** The cache is a dictionary of dictionaries, with the outer dictionary keyed by type of plugin
     * and the inner dictionary keyed by variableName. This is so that even if we have two variables
     * with the same name in different plugins, we can store their descriptions separately.
     * @private
     * @type {{}}
     */
    private cache;
    private requests_cache;
    /**
     * Creates an instance of JsPsychMetadata while passing in JsPsych object to have access to context
     *  allowing it to access the screen printing information.
     *
     * @constructor
     * @param {JsPsych} JsPsych
     */
    constructor();
    /**
     * Method that fills in JsPsychMetadata class with all the universal fields with default information.
     * This is automatically called whenever creating an instance of JsPsychMetadata and indicates all
     * the required fields that need to filled in to be Psych-DS compliant.
     */
    generateDefaultMetadata(): void;
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
     * Returns the final Metadata in a single javascript object. Bundles together the author and variables
     * together in a list rather than object compliant with Psych-DS standards.
     *
     * @returns {{}} - Final Metadata object
     */
    getMetadata(): {};
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
     * Method that creates a variable. This method can also be used to overwrite variables with the same name
     * as a way to update fields.
     *
     * @param {{
     *     type?: string;
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
     * Method that allows you to display metadata at the end of an experiment.
     *
     * @param {string} [elementId="jspsych-metadata-display"] - Id for how to style the metadata. Defaults to default styling.
     */
    displayMetadata(display_element: any): void;
    /**
     * Method that begins a download for the dataset_description.json at the end of experiment.
     * Allows you to download the metadat.
     */
    saveAsJsonFile(): void;
    /**
     * Function to convert string csv into a javascript json object.
     *
     * Created by reversing function in datamodule using ChatGPT.
     *
     * @private
     * @param {*} csv - CSV that is represented as string
     * @returns {*} - Returns a json object
     */
    private CSV2JSON;
    /**
     * Generates observations based on the input data and processes optional metadata.
     *
     * This method accepts data, which can be an array of observation objects, a JSON string,
     * or a CSV string. If the data is in CSV format, set the `csv` parameter to `true` to
     * parse it into a JSON object. Each observation is processed asynchronously using the
     * `generateObservation` method. Optionally, metadata can be provided in the form of an
     * object, and each key-value pair in the metadata object will be processed by the
     * `processMetadata` method.
     *
     * @async
     * @param {Array|String} data - The data to generate observations from. Can be an array of objects, a JSON string, or a CSV string.
     * @param {Object} [metadata={}] - Optional metadata to be processed. Each key-value pair in this object will be processed individually.
     * @param {boolean} [csv=false] - Flag indicating if the data is in a string CSV. If true, the data will be parsed as CSV.
     */
    generate(data: any, metadata?: {}, csv?: boolean): Promise<void>;
    private generateObservation;
    private generateMetadata;
    private updateFields;
    private processMetadata;
    /**
     * Gets the description of a variable in a plugin by fetching the source code of the plugin
     * from a remote source (usually unpkg.com) as a string, passing the script to getJsdocsDescription
     * to extract the description for the variable (present as JSDoc); caches the result for future use.
     *
     * @param {string} pluginType - The type of the plugin for which information is to be fetched.
     * @param {string} variableName - The name of the variable for which information is to be fetched.
     * @returns {Promise<string|null>} The description of the plugin variable if found, otherwise null.
     * @throws Will throw an error if the fetch operation fails.
     */
    private getPluginInfo;
    /**
     * Extracts the description for a variable of a plugin from the JSDoc comments present in the script of the plugin. The script content is
     * drawn from the remotely hosted source file of the plugin through getPluginInfo. The script content is taken
     * as a string and Regex is used to extract the description.
     *
     *
     * @param {string} scriptContent - The content of the script from which the JSDoc description is to be extracted.
     * @param {string} variableName - The name of the variable for which the JSDoc description is to be extracted.
     * @returns {string} The extracted JSDoc description, cleaned and trimmed.
     */
    private getJsdocsDescription;
}

export { JsPsychMetadata as default };
