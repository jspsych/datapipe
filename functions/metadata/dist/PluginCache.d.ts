/**
 * This class handles the fetching and extraction of description field data about variables
 * using plugin and extension type. It caches and parses it efficiently to speed up the metadata generation
 * process.
 *
 * @export
 * @class PluginCache
 * @typedef {PluginCache}
 */
export declare class PluginCache {
    private pluginFields;
    constructor();
    /**
     * Gets the description of a variable in a plugin by fetching the source code of the plugin
     * from a remote source (usually unpkg.com) as a string, passing the script to getJsdocsDescription
     * to extract the description for the variable (present as JSDoc); caches the result for future use.
     *
     * @param {string} pluginType - The type of the plugin for which information is to be fetched.
     * @param {string} variableName - The name of the variable for which information is to be fetched.
     * @param {string} version - The name of the variable for which information is to be fetched.
     * @param {boolean} verbose - Indicates whether should run with verbose mode
     * @param {boolean} [extension] - An optional flag to indicate if an extension should be used.
     * @returns {Promise<string|null>} The description of the plugin variable if found, otherwise null.
     * @throws Will throw an error if the fetch operation fails.
     */
    getPluginInfo(pluginType: string, variableName: string, version: string, verbose: boolean, extension?: boolean): Promise<any>;
    /**
     * Method that handles the generation of the fields and calls helpers methods that
     * fetch and parse the plugin data.
     *
     * @private
     * @async
     * @param {string} pluginType - Name of plugin or extension to fetch.
     * @param {string} version - String version to fetch
     * @param {boolean} verbose - Boolean indicating verbose mode
     * @param {?boolean} [extension] - Optional flag if pluginType is extension
     * @returns {unknown}
     */
    private generatePluginFields;
    /**
     * The method that generates the unpkg links based on whether extension vs plugin and the
     * specific type.
     *
     * @private
     * @param {string} pluginType - Name of plugin or extension to fetch
     * @param {string} version - String version used
     * @param {?boolean} [extension] - Optional flag if pluginType is extension
     * @returns {string}
     */
    private generateUnpkg;
    /**
     * Fetches the actual script text content from unpkg. Calls the method to generate the link
     * and then handles error checking and fetching.
     *
     * @private
     * @async
     * @param {string} pluginType - The plugin or extension name to be fetched
     * @param {string} version - The string version of the plugin
     * @param {boolean} verbose - Boolean indicating verbose mode
     * @param {?boolean} [extension] - Whether pluginType is extension
     * @returns {unknown}
     */
    private fetchScript;
    /**
     * Extracts the content of the top-level `data: { ... }` block from a jsPsych plugin source
     * file using brace counting. This is more robust than a regex approach because the data block
     * ends with `},` (not `};`), and plugin sources contain deeply nested objects that would
     * cause a lazy regex to stop at the wrong closing brace.
     *
     * Known limitations (acceptable for current jsPsych plugin sources):
     * - Matches the first `data:` property in the file; a plugin with a `data:` field inside its
     *   `parameters` block before the top-level `info.data` block would extract the wrong object.
     * - Brace counting treats every `{`/`}` as structural; braces inside string literals or JSDoc
     *   comments (e.g. `/** e.g. {foo: 1} *\/`) would throw off the counter.
     *
     * @private
     * @param {string} script - Full plugin source text.
     * @returns {string | null} Content between the outer braces of the data block, or null if not found.
     */
    private extractDataBlock;
    /**
     * Parses JSDoc comments and variable blocks from the data section of a jsPsych plugin source.
     *
     * @private
     * @param {string} script - The script text content of the fetching.
     * @returns {{}}
     */
    private parseJavadocString;
    /**
     * Extracts JSDoc-annotated fields from a data block string. Uses brace counting to find
     * each variable's true closing brace, then recursively processes any `nested:` sub-object
     * so that nested parameter descriptions are also captured.
     *
     * @private
     * @param {string} block - Content of a data or nested block (without outer braces).
     * @returns {Record<string, any>}
     */
    private extractJsdocFields;
    /**
     * Returns the index of the `}` that closes the `{` at `startIndex`, using brace counting.
     * Returns -1 if the source is unbalanced (no matching closing brace found).
     *
     * @private
     * @param {string} str - String to search.
     * @param {number} startIndex - Index of the opening `{`.
     * @returns {number}
     */
    private findMatchingBrace;
}
