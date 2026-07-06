/**
 * Interface that defines the type for the fields that are specified for variables
 * according to Psych-DS regulations, with name being the one required field.
 *
 * @export
 * @interface VariableFields
 * @typedef {VariableFields}
 */
export interface VariableFields {
    "@type"?: string;
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
 * Custom class that stores and handles the storage, update and retrieval of variable metadata.
 *
 * @export
 * @class VariablesMap
 * @typedef {VariablesMap}
 */
export declare class VariablesMap {
    /**
     * Field that holds a map of the current variables allowing for fast look-up.
     *
     * @private
     * @type {{ [key: string]: VariableFields }}
     */
    private variables;
    /**
     *  Creates the VariablesMap by initialising an empty variable map. The jsPsych system
     * variables (trial_type, trial_index, time_elapsed, extension_*) are NOT seeded here — they
     * are registered lazily when their column is actually observed in the data (see
     * {@link registerSystemVariable}). Seeding them unconditionally produced orphan
     * variableMeasured entries (e.g. time_elapsed) for datasets that omit those columns, which
     * fails Psych-DS validation (VARIABLE_MISSING_FROM_CSV_COLUMNS).
     *
     * @constructor
     */
    constructor();
    /**
     * The fixed jsPsych definition for a system column, or null if `name` is not a known system
     * variable. Returns a fresh object on each call so callers never share/mutate one template.
     */
    private static systemVariableTemplate;
    /**
     * Lazily registers the default jsPsych definition for a system column the first time it is
     * observed in the data. No-op (returns false) when `name` is not a known system variable or
     * is already present; returns true when a new variable was registered. This is what keeps a
     * system variable out of variableMeasured unless the data actually contains that column.
     *
     * @param {string} name - The column / system-variable name.
     * @returns {boolean} - True if a variable was registered, false otherwise.
     */
    registerSystemVariable(name: string): boolean;
    /**
     * Initialises the variable map. System variables are registered lazily (see the constructor
     * and {@link registerSystemVariable}), so this just resets the map to empty.
     */
    generateDefaultVariables(): void;
    /**
     * Returns a list of the variables instead of an object according to the Psych-DS format.
     *
     * @returns {{}[]} - The list of variables represented as objects.
     */
    getList(): {}[];
    /**
     * Collapses an internal { pluginType: description } map into a single schema.org-valid
     * Text value. Descriptions are stored per-plugin and only ever hold multiple keys when the
     * texts genuinely differ (identical texts are merged upstream in updateDescription). Psych-DS /
     * schema.org require `description` to be Text, so an object value triggers an OBJECT_TYPE_MISSING
     * validator warning — this folds everything down to a string.
     *
     * @private
     * @param {*} description - The description value (a { pluginType: text } map, or already a string).
     * @returns {string} - A single Text description.
     */
    private collapseDescription;
    /**
     * Allows user to set a variable and includes all the fields that are possible according to
     * Psych-DS guidelines. Only requires the name field which it uses a key to map to the variable.
     * Can also be used to overwrite existing variables if they have the same name.
     *
     * @param {VariableFields} variable - The fields of the variable that is being created.
     */
    setVariable(variable: VariableFields): void;
    /**
     * Allows you to get information for a single variable returning empty dict if it doesn't exist.
     * Allows you to update fields but not recommended in favor of updateVariable.
     *
     * @param {string} name
     * @returns {(VariableFields | {})} - Variable information or empty dict if doesn't exist
     */
    getVariable(name: string): VariableFields | {};
    /**
     * Checks if variable exists in VariablesMap.
     *
     * @param {string} name - Name of variable
     * @returns {boolean} - True if exists, false if doesn't.
     */
    containsVariable(name: string): boolean;
    /**
     * Method that gets a list of the names of variables.
     *
     * @returns {string[]} - String list containing names of existing variables.
     */
    getVariableNames(): string[];
    /**
     * Allows you to update a variable or add a value in the case of updating values. In other situations will
     * replace the existing value with the new value. Has special cases and logic for levels and names making it
     * easier to update variable values.
     *
     *
     * @param {string} var_name - Name of variable to be updated.
     * @param {string} field_name - Specific field to be updated.
     * @param {(string | boolean | number | { [key: string]: string })} added_value - Single value to be updated, with a mapping if adding to description with key representing pluginType.
     */
    updateVariable(var_name: string, field_name: string, added_value: string | boolean | number | {
        [key: string]: string;
    }): void;
    /**
     * Logic that handles updates to levels field by creating new array if necessary, otherwise
     * pushing the value if it doesn't already exist. Levels can only be added to with strings.
     *
     * @private
     * @param {*} updated_var - The variable object to be updated.
     * @param {*} added_value - The value being added to the levels field.
     */
    private updateLevels;
    /**
     * Logic to update the min and max for the specific value.
     *
     * @private
     * @param {*} updated_var - The variable object to be updated.
     * @param {*} added_value - The value that is being checked against current min/max.
     * @param {*} field_name - The name of field that is being checked (min or max).
     */
    private updateMinMax;
    /**
     * Logic for updating description field that checks to see value already exists. If it does,
     * appends the pluginType to the current key and pushes that along with the value. Creates
     * map if it does not exist.
     *
     * @private
     * @param {*} updated_var - The variable to be updated.
     * @param {*} added_value - The value to be added with the key being the name of the plugin and the key being the description field.
     */
    private updateDescription;
    /**
     * Logic for updating name. Needs to retain all the old values while creating a new reference in the map
     * while keeping the same perspe
     *
     * @private
     * @param {*} updated_var
     * @param {*} added_value
     */
    private updateName;
    /**
     * Allows you to delete a variable by key/name. Returns console error if not found.
     *
     * @param {string} var_name - Name of variable to be deleted.
     */
    deleteVariable(var_name: string): void;
}
