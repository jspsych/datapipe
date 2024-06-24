import { JsPsych } from 'jspsych';

/**
 * Class that handles the storage, update and retrieval of Metadata.
 *
 * @export
 * @class JsPsychMetadata
 * @typedef {JsPsychMetadata}
 */
declare class JsPsychMetadata {
    private JsPsych;
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
    /**
     * Creates an instance of JsPsychMetadata while passing in JsPsych object to have access to context
     *  allowing it to access the screen printing information.
     *
     * @constructor
     * @param {JsPsych} JsPsych
     */
    constructor(JsPsych: JsPsych);
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
     * @param {{
     *     type?: string;
     *     name: string;
     *     givenName?: string;
     *     familyName?: string;
     *     identifier?: string;
     *   }} fields - All the required or possible fields associated with listing an author according to Psych-DS standards.
     */
    setAuthor(fields: {
        type?: string;
        name: string;
        givenName?: string;
        familyName?: string;
        identifier?: string;
    }): void;
    /**
     * Method that fetches an author object allowing user to update (in existing workflow should not be necessary).
     *
     * @param {string} name - Name of author to be used as key.
     * @returns {{}} - Object with author information.
     */
    getAuthor(name: string): {};
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
    setVariable(fields: {
        type?: string;
        name: string;
        description?: string | {};
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
    }): void;
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
    generate(data: any, metadata?: {}): Promise<void>;
    private generateObservation;
    private generateVariable;
    private generateUpdate;
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
}

export { JsPsychMetadata as default };
