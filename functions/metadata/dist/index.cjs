var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  PSYCHDS_IGNORE_CONTENT: () => PSYCHDS_IGNORE_CONTENT,
  PSYCHDS_IGNORE_FILENAME: () => PSYCHDS_IGNORE_FILENAME,
  analyzeJoinKeys: () => analyzeJoinKeys,
  buildPsychDSDataFiles: () => buildPsychDSDataFiles,
  default: () => JsPsychMetadata,
  deriveArrayFilename: () => deriveArrayFilename,
  deriveFallbackBase: () => deriveFallbackBase,
  disambiguateArrayFilename: () => disambiguateArrayFilename,
  hasUnnamedColumns: () => hasUnnamedColumns,
  isValidPsychDSDataFilename: () => isValidPsychDSDataFilename,
  objectsToCSV: () => objectsToCSV,
  parseCSV: () => parseCSV,
  parseJsonData: () => parseJsonData,
  stripUnnamedColumns: () => stripUnnamedColumns,
  toPsychDSValue: () => toPsychDSValue,
  unwrapTrials: () => unwrapTrials
});
module.exports = __toCommonJS(index_exports);

// src/AuthorsMap.ts
var AuthorsMap = class {
  /**
   * Creates an empty instance of authors map. Doesn't generate default metadata because
   * can't assume anything about the authors.
   *
   * @constructor
   */
  constructor() {
    this.authors = {};
  }
  /**
   * Returns the final list format of the authors according to Psych-DS standards.
   *
   * @returns {(AuthorFields | string)[]} - List of authors
   */
  getList() {
    const author_list = [];
    for (const key of Object.keys(this.authors)) {
      author_list.push(this.authors[key]);
    }
    return author_list;
  }
  /**
   * Method that creates an author. This method can also be used to overwrite existing authors
   * with the same name in order to update fields.
   *
   * @param {AuthorFields | string} author - All the required or possible fields associated with listing an author according to Psych-DS standards. Option as a string to define an author according only to name.
   */
  setAuthor(author) {
    if (typeof author === "string") {
      this.authors[author] = author;
      return;
    }
    if (!author.name) {
      console.warn("Name field is missing. Author not added.");
      return;
    }
    const { name, ...rest } = author;
    if (Object.keys(rest).length == 0) {
      this.authors[name] = name;
    } else {
      const newAuthor = { name, ...rest };
      this.authors[name] = newAuthor;
      const unexpectedFields = Object.keys(author).filter(
        (key) => !["@type", "name", "givenName", "familyName", "identifier"].includes(key)
      );
      if (unexpectedFields.length > 0) {
        console.warn(
          `Unexpected fields (${unexpectedFields.join(
            ", "
          )}) detected and included in the author object.`
        );
      }
    }
  }
  /**
   * Method that fetches an author object allowing user to update (in existing workflow should not be necessary).
   *
   * @param {string} name - Name of author to be used as key.
   * @returns {(AuthorFields | string | {})} - Object with author information. Empty object if not found.
   */
  getAuthor(name) {
    if (name in this.authors) {
      return this.authors[name];
    } else {
      console.warn("Author (", name, ") not found.");
      return {};
    }
  }
  /**
   * Deletes the author if it exists, printing out warning if doesn't exist. 
   *
   * @param {string} author_name - Name of author to be deleted
   */
  deleteAuthor(author_name) {
    if (author_name in this.authors) {
      delete this.authors[author_name];
    } else {
      console.error(`Author "${author_name}" does not exist.`);
    }
  }
};

// src/PluginCache.ts
var PluginCache = class {
  constructor() {
    this.pluginFields = {};
  }
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
  async getPluginInfo(pluginType, variableName, version, verbose, extension) {
    if (!(pluginType in this.pluginFields)) {
      const fields = await this.generatePluginFields(pluginType, version, verbose, extension);
      this.pluginFields[pluginType] = fields;
    }
    if (variableName in this.pluginFields[pluginType])
      return this.pluginFields[pluginType][variableName];
    else
      return {
        description: "unknown",
        type: "unknown"
      };
  }
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
  async generatePluginFields(pluginType, version, verbose, extension) {
    const script = await this.fetchScript(pluginType, version, verbose, extension);
    if (script !== void 0 && script !== null && script !== "") {
      try {
        return this.parseJavadocString(script);
      } catch (err) {
        console.warn("* Error parsing", pluginType, err);
        return {};
      }
    } else {
      return {};
    }
  }
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
  generateUnpkg(pluginType, version, extension) {
    if (extension) {
      if (version) {
        return `https://unpkg.com/@jspsych/extension-${pluginType}@${version}/src/index.ts`;
      } else return `https://unpkg.com/@jspsych/extension-${pluginType}/src/index.ts`;
    }
    if (version) {
      return `https://unpkg.com/@jspsych/plugin-${pluginType}@${version}/src/index.ts`;
    } else return `https://unpkg.com/@jspsych/plugin-${pluginType}/src/index.ts`;
  }
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
  async fetchScript(pluginType, version, verbose, extension) {
    const unpkgUrl = this.generateUnpkg(pluginType, version, extension);
    if (verbose) console.log("-> fetching information for [", pluginType, "] from ->", unpkgUrl);
    try {
      const response = await fetch(unpkgUrl);
      if (!response.ok) {
        console.warn(`Plugin source not found for: ${pluginType} (HTTP ${response.status}). Descriptions will default to "unknown".`);
        return void 0;
      }
      const scriptContent = await response.text();
      return scriptContent;
    } catch (error) {
      console.error(
        `Plugin fetching failed for:`,
        pluginType,
        "with error",
        error,
        "Note: if you are using a plugin not supported the main JsPsych branch this will always fail."
      );
      return void 0;
    }
  }
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
  extractDataBlock(script) {
    const dataStart = script.search(/\bdata:\s*\{/);
    if (dataStart === -1) return null;
    const braceStart = script.indexOf("{", dataStart);
    if (braceStart === -1) return null;
    const braceEnd = this.findMatchingBrace(script, braceStart);
    if (braceEnd === -1) return null;
    return script.substring(braceStart + 1, braceEnd);
  }
  /**
   * Parses JSDoc comments and variable blocks from the data section of a jsPsych plugin source.
   *
   * @private
   * @param {string} script - The script text content of the fetching.
   * @returns {{}}
   */
  parseJavadocString(script) {
    const dataBlock = this.extractDataBlock(script);
    if (!dataBlock) return {};
    return this.extractJsdocFields(dataBlock);
  }
  /**
   * Extracts JSDoc-annotated fields from a data block string. Uses brace counting to find
   * each variable's true closing brace, then recursively processes any `nested:` sub-object
   * so that nested parameter descriptions are also captured.
   *
   * @private
   * @param {string} block - Content of a data or nested block (without outer braces).
   * @returns {Record<string, any>}
   */
  extractJsdocFields(block) {
    const result = {};
    const varStartRegex = /\/\*\*\s*([\s\S]*?)\s*\*\/\s*(\w+):\s*\{/g;
    const propRegex = /(\w+):\s*([^,\s{}]+)/g;
    let match;
    while ((match = varStartRegex.exec(block)) !== null) {
      const description = match[1].replace(/^[ \t]*\*[ \t]?/gm, "").trim().replace(/\s+/g, " ");
      const varName = match[2];
      const braceStart = match.index + match[0].length - 1;
      const braceEnd = this.findMatchingBrace(block, braceStart);
      if (braceEnd === -1) continue;
      varStartRegex.lastIndex = braceEnd + 1;
      const varContent = block.substring(braceStart + 1, braceEnd);
      const propsObj = {};
      let propMatch;
      propRegex.lastIndex = 0;
      while ((propMatch = propRegex.exec(varContent)) !== null) {
        propsObj[propMatch[1]] = propMatch[2];
      }
      result[varName] = { description, ...propsObj };
      const nestedSearch = /\bnested:\s*\{/.exec(varContent);
      if (nestedSearch) {
        const nestedBraceStart = varContent.indexOf("{", nestedSearch.index);
        const nestedBraceEnd = this.findMatchingBrace(varContent, nestedBraceStart);
        if (nestedBraceEnd !== -1) {
          Object.assign(result, this.extractJsdocFields(varContent.substring(nestedBraceStart + 1, nestedBraceEnd)));
        }
      }
    }
    return result;
  }
  /**
   * Returns the index of the `}` that closes the `{` at `startIndex`, using brace counting.
   * Returns -1 if the source is unbalanced (no matching closing brace found).
   *
   * @private
   * @param {string} str - String to search.
   * @param {number} startIndex - Index of the opening `{`.
   * @returns {number}
   */
  findMatchingBrace(str, startIndex) {
    let depth = 0;
    for (let i = startIndex; i < str.length; i++) {
      if (str[i] === "{") depth++;
      else if (str[i] === "}" && --depth === 0) return i;
    }
    return -1;
  }
};

// ../../node_modules/csv-parse/lib/index.js
var import_stream = require("stream");

// ../../node_modules/csv-parse/lib/utils/is_object.js
var is_object = function(obj) {
  return typeof obj === "object" && obj !== null && !Array.isArray(obj);
};

// ../../node_modules/csv-parse/lib/api/CsvError.js
var CsvError = class _CsvError extends Error {
  constructor(code, message, options, ...contexts) {
    if (Array.isArray(message)) message = message.join(" ").trim();
    super(message);
    if (Error.captureStackTrace !== void 0) {
      Error.captureStackTrace(this, _CsvError);
    }
    this.code = code;
    for (const context of contexts) {
      for (const key in context) {
        const value = context[key];
        this[key] = Buffer.isBuffer(value) ? value.toString(options.encoding) : value == null ? value : JSON.parse(JSON.stringify(value));
      }
    }
  }
};

// ../../node_modules/csv-parse/lib/api/normalize_columns_array.js
var normalize_columns_array = function(columns) {
  const normalizedColumns = [];
  for (let i = 0, l = columns.length; i < l; i++) {
    const column = columns[i];
    if (column === void 0 || column === null || column === false) {
      normalizedColumns[i] = { disabled: true };
    } else if (typeof column === "string") {
      normalizedColumns[i] = { name: column };
    } else if (is_object(column)) {
      if (typeof column.name !== "string") {
        throw new CsvError("CSV_OPTION_COLUMNS_MISSING_NAME", [
          "Option columns missing name:",
          `property "name" is required at position ${i}`,
          "when column is an object literal"
        ]);
      }
      normalizedColumns[i] = column;
    } else {
      throw new CsvError("CSV_INVALID_COLUMN_DEFINITION", [
        "Invalid column definition:",
        "expect a string or a literal object,",
        `got ${JSON.stringify(column)} at position ${i}`
      ]);
    }
  }
  return normalizedColumns;
};

// ../../node_modules/csv-parse/lib/utils/ResizeableBuffer.js
var ResizeableBuffer = class {
  constructor(size = 100) {
    this.size = size;
    this.length = 0;
    this.buf = Buffer.allocUnsafe(size);
  }
  prepend(val) {
    if (Buffer.isBuffer(val)) {
      const length = this.length + val.length;
      if (length >= this.size) {
        this.resize();
        if (length >= this.size) {
          throw Error("INVALID_BUFFER_STATE");
        }
      }
      const buf = this.buf;
      this.buf = Buffer.allocUnsafe(this.size);
      val.copy(this.buf, 0);
      buf.copy(this.buf, val.length);
      this.length += val.length;
    } else {
      const length = this.length++;
      if (length === this.size) {
        this.resize();
      }
      const buf = this.clone();
      this.buf[0] = val;
      buf.copy(this.buf, 1, 0, length);
    }
  }
  append(val) {
    const length = this.length++;
    if (length === this.size) {
      this.resize();
    }
    this.buf[length] = val;
  }
  clone() {
    return Buffer.from(this.buf.slice(0, this.length));
  }
  resize() {
    const length = this.length;
    this.size = this.size * 2;
    const buf = Buffer.allocUnsafe(this.size);
    this.buf.copy(buf, 0, 0, length);
    this.buf = buf;
  }
  toString(encoding) {
    if (encoding) {
      return this.buf.slice(0, this.length).toString(encoding);
    } else {
      return Uint8Array.prototype.slice.call(this.buf.slice(0, this.length));
    }
  }
  toJSON() {
    return this.toString("utf8");
  }
  reset() {
    this.length = 0;
  }
};
var ResizeableBuffer_default = ResizeableBuffer;

// ../../node_modules/csv-parse/lib/api/init_state.js
var np = 12;
var cr = 13;
var nl = 10;
var space = 32;
var tab = 9;
var init_state = function(options) {
  return {
    bomSkipped: false,
    bufBytesStart: 0,
    castField: options.cast_function,
    commenting: false,
    // Current error encountered by a record
    error: void 0,
    enabled: options.from_line === 1,
    escaping: false,
    escapeIsQuote: Buffer.isBuffer(options.escape) && Buffer.isBuffer(options.quote) && Buffer.compare(options.escape, options.quote) === 0,
    // columns can be `false`, `true`, `Array`
    expectedRecordLength: Array.isArray(options.columns) ? options.columns.length : void 0,
    field: new ResizeableBuffer_default(20),
    firstLineToHeaders: options.cast_first_line_to_header,
    needMoreDataSize: Math.max(
      // Skip if the remaining buffer smaller than comment
      options.comment !== null ? options.comment.length : 0,
      ...options.delimiter.map((delimiter) => delimiter.length),
      // Skip if the remaining buffer can be escape sequence
      options.quote !== null ? options.quote.length : 0
    ),
    previousBuf: void 0,
    quoting: false,
    stop: false,
    rawBuffer: new ResizeableBuffer_default(100),
    record: [],
    recordHasError: false,
    record_length: 0,
    recordDelimiterMaxLength: options.record_delimiter.length === 0 ? 0 : Math.max(...options.record_delimiter.map((v) => v.length)),
    trimChars: [Buffer.from(" ", options.encoding)[0], Buffer.from("	", options.encoding)[0]],
    wasQuoting: false,
    wasRowDelimiter: false,
    timchars: [
      Buffer.from(Buffer.from([cr], "utf8").toString(), options.encoding),
      Buffer.from(Buffer.from([nl], "utf8").toString(), options.encoding),
      Buffer.from(Buffer.from([np], "utf8").toString(), options.encoding),
      Buffer.from(Buffer.from([space], "utf8").toString(), options.encoding),
      Buffer.from(Buffer.from([tab], "utf8").toString(), options.encoding)
    ]
  };
};

// ../../node_modules/csv-parse/lib/utils/underscore.js
var underscore = function(str) {
  return str.replace(/([A-Z])/g, function(_, match) {
    return "_" + match.toLowerCase();
  });
};

// ../../node_modules/csv-parse/lib/api/normalize_options.js
var normalize_options = function(opts) {
  const options = {};
  for (const opt in opts) {
    options[underscore(opt)] = opts[opt];
  }
  if (options.encoding === void 0 || options.encoding === true) {
    options.encoding = "utf8";
  } else if (options.encoding === null || options.encoding === false) {
    options.encoding = null;
  } else if (typeof options.encoding !== "string" && options.encoding !== null) {
    throw new CsvError("CSV_INVALID_OPTION_ENCODING", [
      "Invalid option encoding:",
      "encoding must be a string or null to return a buffer,",
      `got ${JSON.stringify(options.encoding)}`
    ], options);
  }
  if (options.bom === void 0 || options.bom === null || options.bom === false) {
    options.bom = false;
  } else if (options.bom !== true) {
    throw new CsvError("CSV_INVALID_OPTION_BOM", [
      "Invalid option bom:",
      "bom must be true,",
      `got ${JSON.stringify(options.bom)}`
    ], options);
  }
  options.cast_function = null;
  if (options.cast === void 0 || options.cast === null || options.cast === false || options.cast === "") {
    options.cast = void 0;
  } else if (typeof options.cast === "function") {
    options.cast_function = options.cast;
    options.cast = true;
  } else if (options.cast !== true) {
    throw new CsvError("CSV_INVALID_OPTION_CAST", [
      "Invalid option cast:",
      "cast must be true or a function,",
      `got ${JSON.stringify(options.cast)}`
    ], options);
  }
  if (options.cast_date === void 0 || options.cast_date === null || options.cast_date === false || options.cast_date === "") {
    options.cast_date = false;
  } else if (options.cast_date === true) {
    options.cast_date = function(value) {
      const date = Date.parse(value);
      return !isNaN(date) ? new Date(date) : value;
    };
  } else if (typeof options.cast_date !== "function") {
    throw new CsvError("CSV_INVALID_OPTION_CAST_DATE", [
      "Invalid option cast_date:",
      "cast_date must be true or a function,",
      `got ${JSON.stringify(options.cast_date)}`
    ], options);
  }
  options.cast_first_line_to_header = null;
  if (options.columns === true) {
    options.cast_first_line_to_header = void 0;
  } else if (typeof options.columns === "function") {
    options.cast_first_line_to_header = options.columns;
    options.columns = true;
  } else if (Array.isArray(options.columns)) {
    options.columns = normalize_columns_array(options.columns);
  } else if (options.columns === void 0 || options.columns === null || options.columns === false) {
    options.columns = false;
  } else {
    throw new CsvError("CSV_INVALID_OPTION_COLUMNS", [
      "Invalid option columns:",
      "expect an array, a function or true,",
      `got ${JSON.stringify(options.columns)}`
    ], options);
  }
  if (options.group_columns_by_name === void 0 || options.group_columns_by_name === null || options.group_columns_by_name === false) {
    options.group_columns_by_name = false;
  } else if (options.group_columns_by_name !== true) {
    throw new CsvError("CSV_INVALID_OPTION_GROUP_COLUMNS_BY_NAME", [
      "Invalid option group_columns_by_name:",
      "expect an boolean,",
      `got ${JSON.stringify(options.group_columns_by_name)}`
    ], options);
  } else if (options.columns === false) {
    throw new CsvError("CSV_INVALID_OPTION_GROUP_COLUMNS_BY_NAME", [
      "Invalid option group_columns_by_name:",
      "the `columns` mode must be activated."
    ], options);
  }
  if (options.comment === void 0 || options.comment === null || options.comment === false || options.comment === "") {
    options.comment = null;
  } else {
    if (typeof options.comment === "string") {
      options.comment = Buffer.from(options.comment, options.encoding);
    }
    if (!Buffer.isBuffer(options.comment)) {
      throw new CsvError("CSV_INVALID_OPTION_COMMENT", [
        "Invalid option comment:",
        "comment must be a buffer or a string,",
        `got ${JSON.stringify(options.comment)}`
      ], options);
    }
  }
  if (options.comment_no_infix === void 0 || options.comment_no_infix === null || options.comment_no_infix === false) {
    options.comment_no_infix = false;
  } else if (options.comment_no_infix !== true) {
    throw new CsvError("CSV_INVALID_OPTION_COMMENT", [
      "Invalid option comment_no_infix:",
      "value must be a boolean,",
      `got ${JSON.stringify(options.comment_no_infix)}`
    ], options);
  }
  const delimiter_json = JSON.stringify(options.delimiter);
  if (!Array.isArray(options.delimiter)) options.delimiter = [options.delimiter];
  if (options.delimiter.length === 0) {
    throw new CsvError("CSV_INVALID_OPTION_DELIMITER", [
      "Invalid option delimiter:",
      "delimiter must be a non empty string or buffer or array of string|buffer,",
      `got ${delimiter_json}`
    ], options);
  }
  options.delimiter = options.delimiter.map(function(delimiter) {
    if (delimiter === void 0 || delimiter === null || delimiter === false) {
      return Buffer.from(",", options.encoding);
    }
    if (typeof delimiter === "string") {
      delimiter = Buffer.from(delimiter, options.encoding);
    }
    if (!Buffer.isBuffer(delimiter) || delimiter.length === 0) {
      throw new CsvError("CSV_INVALID_OPTION_DELIMITER", [
        "Invalid option delimiter:",
        "delimiter must be a non empty string or buffer or array of string|buffer,",
        `got ${delimiter_json}`
      ], options);
    }
    return delimiter;
  });
  if (options.escape === void 0 || options.escape === true) {
    options.escape = Buffer.from('"', options.encoding);
  } else if (typeof options.escape === "string") {
    options.escape = Buffer.from(options.escape, options.encoding);
  } else if (options.escape === null || options.escape === false) {
    options.escape = null;
  }
  if (options.escape !== null) {
    if (!Buffer.isBuffer(options.escape)) {
      throw new Error(`Invalid Option: escape must be a buffer, a string or a boolean, got ${JSON.stringify(options.escape)}`);
    }
  }
  if (options.from === void 0 || options.from === null) {
    options.from = 1;
  } else {
    if (typeof options.from === "string" && /\d+/.test(options.from)) {
      options.from = parseInt(options.from);
    }
    if (Number.isInteger(options.from)) {
      if (options.from < 0) {
        throw new Error(`Invalid Option: from must be a positive integer, got ${JSON.stringify(opts.from)}`);
      }
    } else {
      throw new Error(`Invalid Option: from must be an integer, got ${JSON.stringify(options.from)}`);
    }
  }
  if (options.from_line === void 0 || options.from_line === null) {
    options.from_line = 1;
  } else {
    if (typeof options.from_line === "string" && /\d+/.test(options.from_line)) {
      options.from_line = parseInt(options.from_line);
    }
    if (Number.isInteger(options.from_line)) {
      if (options.from_line <= 0) {
        throw new Error(`Invalid Option: from_line must be a positive integer greater than 0, got ${JSON.stringify(opts.from_line)}`);
      }
    } else {
      throw new Error(`Invalid Option: from_line must be an integer, got ${JSON.stringify(opts.from_line)}`);
    }
  }
  if (options.ignore_last_delimiters === void 0 || options.ignore_last_delimiters === null) {
    options.ignore_last_delimiters = false;
  } else if (typeof options.ignore_last_delimiters === "number") {
    options.ignore_last_delimiters = Math.floor(options.ignore_last_delimiters);
    if (options.ignore_last_delimiters === 0) {
      options.ignore_last_delimiters = false;
    }
  } else if (typeof options.ignore_last_delimiters !== "boolean") {
    throw new CsvError("CSV_INVALID_OPTION_IGNORE_LAST_DELIMITERS", [
      "Invalid option `ignore_last_delimiters`:",
      "the value must be a boolean value or an integer,",
      `got ${JSON.stringify(options.ignore_last_delimiters)}`
    ], options);
  }
  if (options.ignore_last_delimiters === true && options.columns === false) {
    throw new CsvError("CSV_IGNORE_LAST_DELIMITERS_REQUIRES_COLUMNS", [
      "The option `ignore_last_delimiters`",
      "requires the activation of the `columns` option"
    ], options);
  }
  if (options.info === void 0 || options.info === null || options.info === false) {
    options.info = false;
  } else if (options.info !== true) {
    throw new Error(`Invalid Option: info must be true, got ${JSON.stringify(options.info)}`);
  }
  if (options.max_record_size === void 0 || options.max_record_size === null || options.max_record_size === false) {
    options.max_record_size = 0;
  } else if (Number.isInteger(options.max_record_size) && options.max_record_size >= 0) {
  } else if (typeof options.max_record_size === "string" && /\d+/.test(options.max_record_size)) {
    options.max_record_size = parseInt(options.max_record_size);
  } else {
    throw new Error(`Invalid Option: max_record_size must be a positive integer, got ${JSON.stringify(options.max_record_size)}`);
  }
  if (options.objname === void 0 || options.objname === null || options.objname === false) {
    options.objname = void 0;
  } else if (Buffer.isBuffer(options.objname)) {
    if (options.objname.length === 0) {
      throw new Error(`Invalid Option: objname must be a non empty buffer`);
    }
    if (options.encoding === null) {
    } else {
      options.objname = options.objname.toString(options.encoding);
    }
  } else if (typeof options.objname === "string") {
    if (options.objname.length === 0) {
      throw new Error(`Invalid Option: objname must be a non empty string`);
    }
  } else if (typeof options.objname === "number") {
  } else {
    throw new Error(`Invalid Option: objname must be a string or a buffer, got ${options.objname}`);
  }
  if (options.objname !== void 0) {
    if (typeof options.objname === "number") {
      if (options.columns !== false) {
        throw Error("Invalid Option: objname index cannot be combined with columns or be defined as a field");
      }
    } else {
      if (options.columns === false) {
        throw Error("Invalid Option: objname field must be combined with columns or be defined as an index");
      }
    }
  }
  if (options.on_record === void 0 || options.on_record === null) {
    options.on_record = void 0;
  } else if (typeof options.on_record !== "function") {
    throw new CsvError("CSV_INVALID_OPTION_ON_RECORD", [
      "Invalid option `on_record`:",
      "expect a function,",
      `got ${JSON.stringify(options.on_record)}`
    ], options);
  }
  if (options.on_skip !== void 0 && options.on_skip !== null && typeof options.on_skip !== "function") {
    throw new Error(`Invalid Option: on_skip must be a function, got ${JSON.stringify(options.on_skip)}`);
  }
  if (options.quote === null || options.quote === false || options.quote === "") {
    options.quote = null;
  } else {
    if (options.quote === void 0 || options.quote === true) {
      options.quote = Buffer.from('"', options.encoding);
    } else if (typeof options.quote === "string") {
      options.quote = Buffer.from(options.quote, options.encoding);
    }
    if (!Buffer.isBuffer(options.quote)) {
      throw new Error(`Invalid Option: quote must be a buffer or a string, got ${JSON.stringify(options.quote)}`);
    }
  }
  if (options.raw === void 0 || options.raw === null || options.raw === false) {
    options.raw = false;
  } else if (options.raw !== true) {
    throw new Error(`Invalid Option: raw must be true, got ${JSON.stringify(options.raw)}`);
  }
  if (options.record_delimiter === void 0) {
    options.record_delimiter = [];
  } else if (typeof options.record_delimiter === "string" || Buffer.isBuffer(options.record_delimiter)) {
    if (options.record_delimiter.length === 0) {
      throw new CsvError("CSV_INVALID_OPTION_RECORD_DELIMITER", [
        "Invalid option `record_delimiter`:",
        "value must be a non empty string or buffer,",
        `got ${JSON.stringify(options.record_delimiter)}`
      ], options);
    }
    options.record_delimiter = [options.record_delimiter];
  } else if (!Array.isArray(options.record_delimiter)) {
    throw new CsvError("CSV_INVALID_OPTION_RECORD_DELIMITER", [
      "Invalid option `record_delimiter`:",
      "value must be a string, a buffer or array of string|buffer,",
      `got ${JSON.stringify(options.record_delimiter)}`
    ], options);
  }
  options.record_delimiter = options.record_delimiter.map(function(rd, i) {
    if (typeof rd !== "string" && !Buffer.isBuffer(rd)) {
      throw new CsvError("CSV_INVALID_OPTION_RECORD_DELIMITER", [
        "Invalid option `record_delimiter`:",
        "value must be a string, a buffer or array of string|buffer",
        `at index ${i},`,
        `got ${JSON.stringify(rd)}`
      ], options);
    } else if (rd.length === 0) {
      throw new CsvError("CSV_INVALID_OPTION_RECORD_DELIMITER", [
        "Invalid option `record_delimiter`:",
        "value must be a non empty string or buffer",
        `at index ${i},`,
        `got ${JSON.stringify(rd)}`
      ], options);
    }
    if (typeof rd === "string") {
      rd = Buffer.from(rd, options.encoding);
    }
    return rd;
  });
  if (typeof options.relax_column_count === "boolean") {
  } else if (options.relax_column_count === void 0 || options.relax_column_count === null) {
    options.relax_column_count = false;
  } else {
    throw new Error(`Invalid Option: relax_column_count must be a boolean, got ${JSON.stringify(options.relax_column_count)}`);
  }
  if (typeof options.relax_column_count_less === "boolean") {
  } else if (options.relax_column_count_less === void 0 || options.relax_column_count_less === null) {
    options.relax_column_count_less = false;
  } else {
    throw new Error(`Invalid Option: relax_column_count_less must be a boolean, got ${JSON.stringify(options.relax_column_count_less)}`);
  }
  if (typeof options.relax_column_count_more === "boolean") {
  } else if (options.relax_column_count_more === void 0 || options.relax_column_count_more === null) {
    options.relax_column_count_more = false;
  } else {
    throw new Error(`Invalid Option: relax_column_count_more must be a boolean, got ${JSON.stringify(options.relax_column_count_more)}`);
  }
  if (typeof options.relax_quotes === "boolean") {
  } else if (options.relax_quotes === void 0 || options.relax_quotes === null) {
    options.relax_quotes = false;
  } else {
    throw new Error(`Invalid Option: relax_quotes must be a boolean, got ${JSON.stringify(options.relax_quotes)}`);
  }
  if (typeof options.skip_empty_lines === "boolean") {
  } else if (options.skip_empty_lines === void 0 || options.skip_empty_lines === null) {
    options.skip_empty_lines = false;
  } else {
    throw new Error(`Invalid Option: skip_empty_lines must be a boolean, got ${JSON.stringify(options.skip_empty_lines)}`);
  }
  if (typeof options.skip_records_with_empty_values === "boolean") {
  } else if (options.skip_records_with_empty_values === void 0 || options.skip_records_with_empty_values === null) {
    options.skip_records_with_empty_values = false;
  } else {
    throw new Error(`Invalid Option: skip_records_with_empty_values must be a boolean, got ${JSON.stringify(options.skip_records_with_empty_values)}`);
  }
  if (typeof options.skip_records_with_error === "boolean") {
  } else if (options.skip_records_with_error === void 0 || options.skip_records_with_error === null) {
    options.skip_records_with_error = false;
  } else {
    throw new Error(`Invalid Option: skip_records_with_error must be a boolean, got ${JSON.stringify(options.skip_records_with_error)}`);
  }
  if (options.rtrim === void 0 || options.rtrim === null || options.rtrim === false) {
    options.rtrim = false;
  } else if (options.rtrim !== true) {
    throw new Error(`Invalid Option: rtrim must be a boolean, got ${JSON.stringify(options.rtrim)}`);
  }
  if (options.ltrim === void 0 || options.ltrim === null || options.ltrim === false) {
    options.ltrim = false;
  } else if (options.ltrim !== true) {
    throw new Error(`Invalid Option: ltrim must be a boolean, got ${JSON.stringify(options.ltrim)}`);
  }
  if (options.trim === void 0 || options.trim === null || options.trim === false) {
    options.trim = false;
  } else if (options.trim !== true) {
    throw new Error(`Invalid Option: trim must be a boolean, got ${JSON.stringify(options.trim)}`);
  }
  if (options.trim === true && opts.ltrim !== false) {
    options.ltrim = true;
  } else if (options.ltrim !== true) {
    options.ltrim = false;
  }
  if (options.trim === true && opts.rtrim !== false) {
    options.rtrim = true;
  } else if (options.rtrim !== true) {
    options.rtrim = false;
  }
  if (options.to === void 0 || options.to === null) {
    options.to = -1;
  } else {
    if (typeof options.to === "string" && /\d+/.test(options.to)) {
      options.to = parseInt(options.to);
    }
    if (Number.isInteger(options.to)) {
      if (options.to <= 0) {
        throw new Error(`Invalid Option: to must be a positive integer greater than 0, got ${JSON.stringify(opts.to)}`);
      }
    } else {
      throw new Error(`Invalid Option: to must be an integer, got ${JSON.stringify(opts.to)}`);
    }
  }
  if (options.to_line === void 0 || options.to_line === null) {
    options.to_line = -1;
  } else {
    if (typeof options.to_line === "string" && /\d+/.test(options.to_line)) {
      options.to_line = parseInt(options.to_line);
    }
    if (Number.isInteger(options.to_line)) {
      if (options.to_line <= 0) {
        throw new Error(`Invalid Option: to_line must be a positive integer greater than 0, got ${JSON.stringify(opts.to_line)}`);
      }
    } else {
      throw new Error(`Invalid Option: to_line must be an integer, got ${JSON.stringify(opts.to_line)}`);
    }
  }
  return options;
};

// ../../node_modules/csv-parse/lib/api/index.js
var isRecordEmpty = function(record) {
  return record.every((field) => field == null || field.toString && field.toString().trim() === "");
};
var cr2 = 13;
var nl2 = 10;
var boms = {
  // Note, the following are equals:
  // Buffer.from("\ufeff")
  // Buffer.from([239, 187, 191])
  // Buffer.from('EFBBBF', 'hex')
  "utf8": Buffer.from([239, 187, 191]),
  // Note, the following are equals:
  // Buffer.from "\ufeff", 'utf16le
  // Buffer.from([255, 254])
  "utf16le": Buffer.from([255, 254])
};
var transform = function(original_options = {}) {
  const info = {
    bytes: 0,
    comment_lines: 0,
    empty_lines: 0,
    invalid_field_length: 0,
    lines: 1,
    records: 0
  };
  const options = normalize_options(original_options);
  return {
    info,
    original_options,
    options,
    state: init_state(options),
    __needMoreData: function(i, bufLen, end) {
      if (end) return false;
      const { encoding, escape, quote } = this.options;
      const { quoting, needMoreDataSize, recordDelimiterMaxLength } = this.state;
      const numOfCharLeft = bufLen - i - 1;
      const requiredLength = Math.max(
        needMoreDataSize,
        // Skip if the remaining buffer smaller than record delimiter
        // If "record_delimiter" is yet to be discovered:
        // 1. It is equals to `[]` and "recordDelimiterMaxLength" equals `0`
        // 2. We set the length to windows line ending in the current encoding
        // Note, that encoding is known from user or bom discovery at that point
        // recordDelimiterMaxLength,
        recordDelimiterMaxLength === 0 ? Buffer.from("\r\n", encoding).length : recordDelimiterMaxLength,
        // Skip if remaining buffer can be an escaped quote
        quoting ? (escape === null ? 0 : escape.length) + quote.length : 0,
        // Skip if remaining buffer can be record delimiter following the closing quote
        quoting ? quote.length + recordDelimiterMaxLength : 0
      );
      return numOfCharLeft < requiredLength;
    },
    // Central parser implementation
    parse: function(nextBuf, end, push, close) {
      const { bom, comment_no_infix, encoding, from_line, ltrim, max_record_size, raw, relax_quotes, rtrim, skip_empty_lines, to, to_line } = this.options;
      let { comment, escape, quote, record_delimiter } = this.options;
      const { bomSkipped, previousBuf, rawBuffer, escapeIsQuote } = this.state;
      let buf;
      if (previousBuf === void 0) {
        if (nextBuf === void 0) {
          close();
          return;
        } else {
          buf = nextBuf;
        }
      } else if (previousBuf !== void 0 && nextBuf === void 0) {
        buf = previousBuf;
      } else {
        buf = Buffer.concat([previousBuf, nextBuf]);
      }
      if (bomSkipped === false) {
        if (bom === false) {
          this.state.bomSkipped = true;
        } else if (buf.length < 3) {
          if (end === false) {
            this.state.previousBuf = buf;
            return;
          }
        } else {
          for (const encoding2 in boms) {
            if (boms[encoding2].compare(buf, 0, boms[encoding2].length) === 0) {
              const bomLength = boms[encoding2].length;
              this.state.bufBytesStart += bomLength;
              buf = buf.slice(bomLength);
              this.options = normalize_options({ ...this.original_options, encoding: encoding2 });
              ({ comment, escape, quote } = this.options);
              break;
            }
          }
          this.state.bomSkipped = true;
        }
      }
      const bufLen = buf.length;
      let pos;
      for (pos = 0; pos < bufLen; pos++) {
        if (this.__needMoreData(pos, bufLen, end)) {
          break;
        }
        if (this.state.wasRowDelimiter === true) {
          this.info.lines++;
          this.state.wasRowDelimiter = false;
        }
        if (to_line !== -1 && this.info.lines > to_line) {
          this.state.stop = true;
          close();
          return;
        }
        if (this.state.quoting === false && record_delimiter.length === 0) {
          const record_delimiterCount = this.__autoDiscoverRecordDelimiter(buf, pos);
          if (record_delimiterCount) {
            record_delimiter = this.options.record_delimiter;
          }
        }
        const chr = buf[pos];
        if (raw === true) {
          rawBuffer.append(chr);
        }
        if ((chr === cr2 || chr === nl2) && this.state.wasRowDelimiter === false) {
          this.state.wasRowDelimiter = true;
        }
        if (this.state.escaping === true) {
          this.state.escaping = false;
        } else {
          if (escape !== null && this.state.quoting === true && this.__isEscape(buf, pos, chr) && pos + escape.length < bufLen) {
            if (escapeIsQuote) {
              if (this.__isQuote(buf, pos + escape.length)) {
                this.state.escaping = true;
                pos += escape.length - 1;
                continue;
              }
            } else {
              this.state.escaping = true;
              pos += escape.length - 1;
              continue;
            }
          }
          if (this.state.commenting === false && this.__isQuote(buf, pos)) {
            if (this.state.quoting === true) {
              const nextChr = buf[pos + quote.length];
              const isNextChrTrimable = rtrim && this.__isCharTrimable(buf, pos + quote.length);
              const isNextChrComment = comment !== null && this.__compareBytes(comment, buf, pos + quote.length, nextChr);
              const isNextChrDelimiter = this.__isDelimiter(buf, pos + quote.length, nextChr);
              const isNextChrRecordDelimiter = record_delimiter.length === 0 ? this.__autoDiscoverRecordDelimiter(buf, pos + quote.length) : this.__isRecordDelimiter(nextChr, buf, pos + quote.length);
              if (escape !== null && this.__isEscape(buf, pos, chr) && this.__isQuote(buf, pos + escape.length)) {
                pos += escape.length - 1;
              } else if (!nextChr || isNextChrDelimiter || isNextChrRecordDelimiter || isNextChrComment || isNextChrTrimable) {
                this.state.quoting = false;
                this.state.wasQuoting = true;
                pos += quote.length - 1;
                continue;
              } else if (relax_quotes === false) {
                const err = this.__error(
                  new CsvError("CSV_INVALID_CLOSING_QUOTE", [
                    "Invalid Closing Quote:",
                    `got "${String.fromCharCode(nextChr)}"`,
                    `at line ${this.info.lines}`,
                    "instead of delimiter, record delimiter, trimable character",
                    "(if activated) or comment"
                  ], this.options, this.__infoField())
                );
                if (err !== void 0) return err;
              } else {
                this.state.quoting = false;
                this.state.wasQuoting = true;
                this.state.field.prepend(quote);
                pos += quote.length - 1;
              }
            } else {
              if (this.state.field.length !== 0) {
                if (relax_quotes === false) {
                  const info2 = this.__infoField();
                  const bom2 = Object.keys(boms).map((b) => boms[b].equals(this.state.field.toString()) ? b : false).filter(Boolean)[0];
                  const err = this.__error(
                    new CsvError("INVALID_OPENING_QUOTE", [
                      "Invalid Opening Quote:",
                      `a quote is found on field ${JSON.stringify(info2.column)} at line ${info2.lines}, value is ${JSON.stringify(this.state.field.toString(encoding))}`,
                      bom2 ? `(${bom2} bom)` : void 0
                    ], this.options, info2, {
                      field: this.state.field
                    })
                  );
                  if (err !== void 0) return err;
                }
              } else {
                this.state.quoting = true;
                pos += quote.length - 1;
                continue;
              }
            }
          }
          if (this.state.quoting === false) {
            const recordDelimiterLength = this.__isRecordDelimiter(chr, buf, pos);
            if (recordDelimiterLength !== 0) {
              const skipCommentLine = this.state.commenting && (this.state.wasQuoting === false && this.state.record.length === 0 && this.state.field.length === 0);
              if (skipCommentLine) {
                this.info.comment_lines++;
              } else {
                if (this.state.enabled === false && this.info.lines + (this.state.wasRowDelimiter === true ? 1 : 0) >= from_line) {
                  this.state.enabled = true;
                  this.__resetField();
                  this.__resetRecord();
                  pos += recordDelimiterLength - 1;
                  continue;
                }
                if (skip_empty_lines === true && this.state.wasQuoting === false && this.state.record.length === 0 && this.state.field.length === 0) {
                  this.info.empty_lines++;
                  pos += recordDelimiterLength - 1;
                  continue;
                }
                this.info.bytes = this.state.bufBytesStart + pos;
                const errField = this.__onField();
                if (errField !== void 0) return errField;
                this.info.bytes = this.state.bufBytesStart + pos + recordDelimiterLength;
                const errRecord = this.__onRecord(push);
                if (errRecord !== void 0) return errRecord;
                if (to !== -1 && this.info.records >= to) {
                  this.state.stop = true;
                  close();
                  return;
                }
              }
              this.state.commenting = false;
              pos += recordDelimiterLength - 1;
              continue;
            }
            if (this.state.commenting) {
              continue;
            }
            if (comment !== null && (comment_no_infix === false || this.state.record.length === 0 && this.state.field.length === 0)) {
              const commentCount = this.__compareBytes(comment, buf, pos, chr);
              if (commentCount !== 0) {
                this.state.commenting = true;
                continue;
              }
            }
            const delimiterLength = this.__isDelimiter(buf, pos, chr);
            if (delimiterLength !== 0) {
              this.info.bytes = this.state.bufBytesStart + pos;
              const errField = this.__onField();
              if (errField !== void 0) return errField;
              pos += delimiterLength - 1;
              continue;
            }
          }
        }
        if (this.state.commenting === false) {
          if (max_record_size !== 0 && this.state.record_length + this.state.field.length > max_record_size) {
            return this.__error(
              new CsvError("CSV_MAX_RECORD_SIZE", [
                "Max Record Size:",
                "record exceed the maximum number of tolerated bytes",
                `of ${max_record_size}`,
                `at line ${this.info.lines}`
              ], this.options, this.__infoField())
            );
          }
        }
        const lappend = ltrim === false || this.state.quoting === true || this.state.field.length !== 0 || !this.__isCharTrimable(buf, pos);
        const rappend = rtrim === false || this.state.wasQuoting === false;
        if (lappend === true && rappend === true) {
          this.state.field.append(chr);
        } else if (rtrim === true && !this.__isCharTrimable(buf, pos)) {
          return this.__error(
            new CsvError("CSV_NON_TRIMABLE_CHAR_AFTER_CLOSING_QUOTE", [
              "Invalid Closing Quote:",
              "found non trimable byte after quote",
              `at line ${this.info.lines}`
            ], this.options, this.__infoField())
          );
        } else {
          if (lappend === false) {
            pos += this.__isCharTrimable(buf, pos) - 1;
          }
          continue;
        }
      }
      if (end === true) {
        if (this.state.quoting === true) {
          const err = this.__error(
            new CsvError("CSV_QUOTE_NOT_CLOSED", [
              "Quote Not Closed:",
              `the parsing is finished with an opening quote at line ${this.info.lines}`
            ], this.options, this.__infoField())
          );
          if (err !== void 0) return err;
        } else {
          if (this.state.wasQuoting === true || this.state.record.length !== 0 || this.state.field.length !== 0) {
            this.info.bytes = this.state.bufBytesStart + pos;
            const errField = this.__onField();
            if (errField !== void 0) return errField;
            const errRecord = this.__onRecord(push);
            if (errRecord !== void 0) return errRecord;
          } else if (this.state.wasRowDelimiter === true) {
            this.info.empty_lines++;
          } else if (this.state.commenting === true) {
            this.info.comment_lines++;
          }
        }
      } else {
        this.state.bufBytesStart += pos;
        this.state.previousBuf = buf.slice(pos);
      }
      if (this.state.wasRowDelimiter === true) {
        this.info.lines++;
        this.state.wasRowDelimiter = false;
      }
    },
    __onRecord: function(push) {
      const { columns, group_columns_by_name, encoding, info: info2, from, relax_column_count, relax_column_count_less, relax_column_count_more, raw, skip_records_with_empty_values } = this.options;
      const { enabled, record } = this.state;
      if (enabled === false) {
        return this.__resetRecord();
      }
      const recordLength = record.length;
      if (columns === true) {
        if (skip_records_with_empty_values === true && isRecordEmpty(record)) {
          this.__resetRecord();
          return;
        }
        return this.__firstLineToColumns(record);
      }
      if (columns === false && this.info.records === 0) {
        this.state.expectedRecordLength = recordLength;
      }
      if (recordLength !== this.state.expectedRecordLength) {
        const err = columns === false ? new CsvError("CSV_RECORD_INCONSISTENT_FIELDS_LENGTH", [
          "Invalid Record Length:",
          `expect ${this.state.expectedRecordLength},`,
          `got ${recordLength} on line ${this.info.lines}`
        ], this.options, this.__infoField(), {
          record
        }) : new CsvError("CSV_RECORD_INCONSISTENT_COLUMNS", [
          "Invalid Record Length:",
          `columns length is ${columns.length},`,
          // rename columns
          `got ${recordLength} on line ${this.info.lines}`
        ], this.options, this.__infoField(), {
          record
        });
        if (relax_column_count === true || relax_column_count_less === true && recordLength < this.state.expectedRecordLength || relax_column_count_more === true && recordLength > this.state.expectedRecordLength) {
          this.info.invalid_field_length++;
          this.state.error = err;
        } else {
          const finalErr = this.__error(err);
          if (finalErr) return finalErr;
        }
      }
      if (skip_records_with_empty_values === true && isRecordEmpty(record)) {
        this.__resetRecord();
        return;
      }
      if (this.state.recordHasError === true) {
        this.__resetRecord();
        this.state.recordHasError = false;
        return;
      }
      this.info.records++;
      if (from === 1 || this.info.records >= from) {
        const { objname } = this.options;
        if (columns !== false) {
          const obj = {};
          for (let i = 0, l = record.length; i < l; i++) {
            if (columns[i] === void 0 || columns[i].disabled) continue;
            if (group_columns_by_name === true && obj[columns[i].name] !== void 0) {
              if (Array.isArray(obj[columns[i].name])) {
                obj[columns[i].name] = obj[columns[i].name].concat(record[i]);
              } else {
                obj[columns[i].name] = [obj[columns[i].name], record[i]];
              }
            } else {
              obj[columns[i].name] = record[i];
            }
          }
          if (raw === true || info2 === true) {
            const extRecord = Object.assign(
              { record: obj },
              raw === true ? { raw: this.state.rawBuffer.toString(encoding) } : {},
              info2 === true ? { info: this.__infoRecord() } : {}
            );
            const err = this.__push(
              objname === void 0 ? extRecord : [obj[objname], extRecord],
              push
            );
            if (err) {
              return err;
            }
          } else {
            const err = this.__push(
              objname === void 0 ? obj : [obj[objname], obj],
              push
            );
            if (err) {
              return err;
            }
          }
        } else {
          if (raw === true || info2 === true) {
            const extRecord = Object.assign(
              { record },
              raw === true ? { raw: this.state.rawBuffer.toString(encoding) } : {},
              info2 === true ? { info: this.__infoRecord() } : {}
            );
            const err = this.__push(
              objname === void 0 ? extRecord : [record[objname], extRecord],
              push
            );
            if (err) {
              return err;
            }
          } else {
            const err = this.__push(
              objname === void 0 ? record : [record[objname], record],
              push
            );
            if (err) {
              return err;
            }
          }
        }
      }
      this.__resetRecord();
    },
    __firstLineToColumns: function(record) {
      const { firstLineToHeaders } = this.state;
      try {
        const headers = firstLineToHeaders === void 0 ? record : firstLineToHeaders.call(null, record);
        if (!Array.isArray(headers)) {
          return this.__error(
            new CsvError("CSV_INVALID_COLUMN_MAPPING", [
              "Invalid Column Mapping:",
              "expect an array from column function,",
              `got ${JSON.stringify(headers)}`
            ], this.options, this.__infoField(), {
              headers
            })
          );
        }
        const normalizedHeaders = normalize_columns_array(headers);
        this.state.expectedRecordLength = normalizedHeaders.length;
        this.options.columns = normalizedHeaders;
        this.__resetRecord();
        return;
      } catch (err) {
        return err;
      }
    },
    __resetRecord: function() {
      if (this.options.raw === true) {
        this.state.rawBuffer.reset();
      }
      this.state.error = void 0;
      this.state.record = [];
      this.state.record_length = 0;
    },
    __onField: function() {
      const { cast, encoding, rtrim, max_record_size } = this.options;
      const { enabled, wasQuoting } = this.state;
      if (enabled === false) {
        return this.__resetField();
      }
      let field = this.state.field.toString(encoding);
      if (rtrim === true && wasQuoting === false) {
        field = field.trimRight();
      }
      if (cast === true) {
        const [err, f] = this.__cast(field);
        if (err !== void 0) return err;
        field = f;
      }
      this.state.record.push(field);
      if (max_record_size !== 0 && typeof field === "string") {
        this.state.record_length += field.length;
      }
      this.__resetField();
    },
    __resetField: function() {
      this.state.field.reset();
      this.state.wasQuoting = false;
    },
    __push: function(record, push) {
      const { on_record } = this.options;
      if (on_record !== void 0) {
        const info2 = this.__infoRecord();
        try {
          record = on_record.call(null, record, info2);
        } catch (err) {
          return err;
        }
        if (record === void 0 || record === null) {
          return;
        }
      }
      push(record);
    },
    // Return a tuple with the error and the casted value
    __cast: function(field) {
      const { columns, relax_column_count } = this.options;
      const isColumns = Array.isArray(columns);
      if (isColumns === true && relax_column_count && this.options.columns.length <= this.state.record.length) {
        return [void 0, void 0];
      }
      if (this.state.castField !== null) {
        try {
          const info2 = this.__infoField();
          return [void 0, this.state.castField.call(null, field, info2)];
        } catch (err) {
          return [err];
        }
      }
      if (this.__isFloat(field)) {
        return [void 0, parseFloat(field)];
      } else if (this.options.cast_date !== false) {
        const info2 = this.__infoField();
        return [void 0, this.options.cast_date.call(null, field, info2)];
      }
      return [void 0, field];
    },
    // Helper to test if a character is a space or a line delimiter
    __isCharTrimable: function(buf, pos) {
      const isTrim = (buf2, pos2) => {
        const { timchars } = this.state;
        loop1: for (let i = 0; i < timchars.length; i++) {
          const timchar = timchars[i];
          for (let j = 0; j < timchar.length; j++) {
            if (timchar[j] !== buf2[pos2 + j]) continue loop1;
          }
          return timchar.length;
        }
        return 0;
      };
      return isTrim(buf, pos);
    },
    // Keep it in case we implement the `cast_int` option
    // __isInt(value){
    //   // return Number.isInteger(parseInt(value))
    //   // return !isNaN( parseInt( obj ) );
    //   return /^(\-|\+)?[1-9][0-9]*$/.test(value)
    // }
    __isFloat: function(value) {
      return value - parseFloat(value) + 1 >= 0;
    },
    __compareBytes: function(sourceBuf, targetBuf, targetPos, firstByte) {
      if (sourceBuf[0] !== firstByte) return 0;
      const sourceLength = sourceBuf.length;
      for (let i = 1; i < sourceLength; i++) {
        if (sourceBuf[i] !== targetBuf[targetPos + i]) return 0;
      }
      return sourceLength;
    },
    __isDelimiter: function(buf, pos, chr) {
      const { delimiter, ignore_last_delimiters } = this.options;
      if (ignore_last_delimiters === true && this.state.record.length === this.options.columns.length - 1) {
        return 0;
      } else if (ignore_last_delimiters !== false && typeof ignore_last_delimiters === "number" && this.state.record.length === ignore_last_delimiters - 1) {
        return 0;
      }
      loop1: for (let i = 0; i < delimiter.length; i++) {
        const del = delimiter[i];
        if (del[0] === chr) {
          for (let j = 1; j < del.length; j++) {
            if (del[j] !== buf[pos + j]) continue loop1;
          }
          return del.length;
        }
      }
      return 0;
    },
    __isRecordDelimiter: function(chr, buf, pos) {
      const { record_delimiter } = this.options;
      const recordDelimiterLength = record_delimiter.length;
      loop1: for (let i = 0; i < recordDelimiterLength; i++) {
        const rd = record_delimiter[i];
        const rdLength = rd.length;
        if (rd[0] !== chr) {
          continue;
        }
        for (let j = 1; j < rdLength; j++) {
          if (rd[j] !== buf[pos + j]) {
            continue loop1;
          }
        }
        return rd.length;
      }
      return 0;
    },
    __isEscape: function(buf, pos, chr) {
      const { escape } = this.options;
      if (escape === null) return false;
      const l = escape.length;
      if (escape[0] === chr) {
        for (let i = 0; i < l; i++) {
          if (escape[i] !== buf[pos + i]) {
            return false;
          }
        }
        return true;
      }
      return false;
    },
    __isQuote: function(buf, pos) {
      const { quote } = this.options;
      if (quote === null) return false;
      const l = quote.length;
      for (let i = 0; i < l; i++) {
        if (quote[i] !== buf[pos + i]) {
          return false;
        }
      }
      return true;
    },
    __autoDiscoverRecordDelimiter: function(buf, pos) {
      const { encoding } = this.options;
      const rds = [
        // Important, the windows line ending must be before mac os 9
        Buffer.from("\r\n", encoding),
        Buffer.from("\n", encoding),
        Buffer.from("\r", encoding)
      ];
      loop: for (let i = 0; i < rds.length; i++) {
        const l = rds[i].length;
        for (let j = 0; j < l; j++) {
          if (rds[i][j] !== buf[pos + j]) {
            continue loop;
          }
        }
        this.options.record_delimiter.push(rds[i]);
        this.state.recordDelimiterMaxLength = rds[i].length;
        return rds[i].length;
      }
      return 0;
    },
    __error: function(msg) {
      const { encoding, raw, skip_records_with_error } = this.options;
      const err = typeof msg === "string" ? new Error(msg) : msg;
      if (skip_records_with_error) {
        this.state.recordHasError = true;
        if (this.options.on_skip !== void 0) {
          this.options.on_skip(err, raw ? this.state.rawBuffer.toString(encoding) : void 0);
        }
        return void 0;
      } else {
        return err;
      }
    },
    __infoDataSet: function() {
      return {
        ...this.info,
        columns: this.options.columns
      };
    },
    __infoRecord: function() {
      const { columns, raw, encoding } = this.options;
      return {
        ...this.__infoDataSet(),
        error: this.state.error,
        header: columns === true,
        index: this.state.record.length,
        raw: raw ? this.state.rawBuffer.toString(encoding) : void 0
      };
    },
    __infoField: function() {
      const { columns } = this.options;
      const isColumns = Array.isArray(columns);
      return {
        ...this.__infoRecord(),
        column: isColumns === true ? columns.length > this.state.record.length ? columns[this.state.record.length].name : null : this.state.record.length,
        quoting: this.state.wasQuoting
      };
    }
  };
};

// ../../node_modules/csv-parse/lib/index.js
var Parser = class extends import_stream.Transform {
  constructor(opts = {}) {
    super({ ...{ readableObjectMode: true }, ...opts, encoding: null });
    this.api = transform({ on_skip: (err, chunk) => {
      this.emit("skip", err, chunk);
    }, ...opts });
    this.state = this.api.state;
    this.options = this.api.options;
    this.info = this.api.info;
  }
  // Implementation of `Transform._transform`
  _transform(buf, _, callback) {
    if (this.state.stop === true) {
      return;
    }
    const err = this.api.parse(buf, false, (record) => {
      this.push(record);
    }, () => {
      this.push(null);
      this.end();
      this.on("end", this.destroy);
    });
    if (err !== void 0) {
      this.state.stop = true;
    }
    callback(err);
  }
  // Implementation of `Transform._flush`
  _flush(callback) {
    if (this.state.stop === true) {
      return;
    }
    const err = this.api.parse(void 0, true, (record) => {
      this.push(record);
    }, () => {
      this.push(null);
      this.on("end", this.destroy);
    });
    callback(err);
  }
};
var parse = function() {
  let data, options, callback;
  for (const i in arguments) {
    const argument = arguments[i];
    const type = typeof argument;
    if (data === void 0 && (typeof argument === "string" || Buffer.isBuffer(argument))) {
      data = argument;
    } else if (options === void 0 && is_object(argument)) {
      options = argument;
    } else if (callback === void 0 && type === "function") {
      callback = argument;
    } else {
      throw new CsvError("CSV_INVALID_ARGUMENT", [
        "Invalid argument:",
        `got ${JSON.stringify(argument)} at index ${i}`
      ], options || {});
    }
  }
  const parser = new Parser(options);
  if (callback) {
    const records = options === void 0 || options.objname === void 0 ? [] : {};
    parser.on("readable", function() {
      let record;
      while ((record = this.read()) !== null) {
        if (options === void 0 || options.objname === void 0) {
          records.push(record);
        } else {
          records[record[0]] = record[1];
        }
      }
    });
    parser.on("error", function(err) {
      callback(err, void 0, parser.api.__infoDataSet());
    });
    parser.on("end", function() {
      callback(void 0, records, parser.api.__infoDataSet());
    });
  }
  if (data !== void 0) {
    const writer = function() {
      parser.write(data);
      parser.end();
    };
    if (typeof setImmediate === "function") {
      setImmediate(writer);
    } else {
      setTimeout(writer, 0);
    }
  }
  return parser;
};

// src/utils.ts
var PSYCHDS_IGNORE_FILENAME = ".psychds-ignore";
var PSYCHDS_IGNORE_CONTENT = "**/raw/\n.psychds-ignore\n";
function saveTextToFile(textstr, filename) {
  const blobToSave = new Blob([textstr], {
    type: "text/plain"
  });
  let blobURL = "";
  if (typeof window.webkitURL !== "undefined") {
    blobURL = window.webkitURL.createObjectURL(blobToSave);
  } else {
    blobURL = window.URL.createObjectURL(blobToSave);
  }
  const link = document.createElement("a");
  link.id = "jspsych-download-as-text-link";
  link.style.display = "none";
  link.download = filename;
  link.href = blobURL;
  link.click();
}
function tryParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
function unwrapTrials(data) {
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const keys = Object.keys(parsed);
    if (keys.length === 1 && keys[0] === "trials" && Array.isArray(parsed.trials)) {
      return parsed.trials;
    }
  }
  return parsed;
}
function parseJsonData(content, options = {}, stats) {
  if (content.charCodeAt(0) === 65279) content = content.slice(1);
  const whole = tryParseJSON(content);
  if (whole !== null) return unwrapTrials(whole);
  const lines = content.split(/\r?\n/);
  const out = [];
  let parsedAny = false;
  let recordIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(
        `Could not parse data as JSON or JSON-Lines: line ${i + 1} is not valid JSON.`
      );
    }
    parsedAny = true;
    const observations = Array.isArray(value) ? value : [value];
    if (options.tagSourceRecordId) {
      for (const obs of observations) {
        if (obs !== null && typeof obs === "object" && !Array.isArray(obs) && !("source_record_id" in obs) && !("participant_id" in obs)) {
          obs.source_record_id = recordIndex;
          if (stats) stats.synthesizedSourceRecordId = true;
        }
      }
    }
    out.push(...observations);
    recordIndex++;
  }
  if (!parsedAny) {
    throw new Error("Could not parse data: input is empty or not valid JSON/JSON-Lines.");
  }
  return out;
}
var SYSTEM_COLUMNS = /* @__PURE__ */ new Set([
  "trial_type",
  "trial_index",
  "time_elapsed",
  "extension_type",
  "extension_version"
]);
function analyzeJoinKeys(parsedData, keys) {
  if (parsedData.length === 0) {
    return { isUnique: true, duplicateCount: 0, duplicateValues: [], candidates: [], suggestedAdditionalKeys: null };
  }
  const compositeKeys = parsedData.map(
    (row) => keys.map((k) => String(row[k] ?? "")).join("\0")
  );
  const keyCount = /* @__PURE__ */ new Map();
  for (const ck of compositeKeys) keyCount.set(ck, (keyCount.get(ck) ?? 0) + 1);
  const duplicateCount = [...keyCount.values()].reduce((n, c) => n + (c > 1 ? c - 1 : 0), 0);
  const isUnique = duplicateCount === 0;
  const duplicateValues = [];
  for (let i = 0; i < parsedData.length && duplicateValues.length < 5; i++) {
    if ((keyCount.get(compositeKeys[i]) ?? 0) > 1) {
      const vals = keys.reduce((acc, k) => {
        acc[k] = parsedData[i][k];
        return acc;
      }, {});
      if (!duplicateValues.some((v) => JSON.stringify(v) === JSON.stringify(vals))) {
        duplicateValues.push(vals);
      }
    }
  }
  if (isUnique) {
    return { isUnique: true, duplicateCount: 0, duplicateValues: [], candidates: [], suggestedAdditionalKeys: null };
  }
  const keySet = new Set(keys);
  const allColumns = /* @__PURE__ */ new Set();
  for (const row of parsedData) for (const col of Object.keys(row)) allColumns.add(col);
  const candidateColumns = [...allColumns].filter(
    (col) => !isUnnamedHeader(col) && !keySet.has(col) && !SYSTEM_COLUMNS.has(col)
  );
  const candidates = candidateColumns.map((col) => {
    const extended = parsedData.map(
      (row) => [...keys, col].map((k) => String(row[k] ?? "")).join("\0")
    );
    return { column: col, makesUnique: new Set(extended).size === parsedData.length };
  });
  if (candidates.some((c) => c.makesUnique)) {
    return { isUnique, duplicateCount, duplicateValues, candidates, suggestedAdditionalKeys: [] };
  }
  const workingKeys = [...keys];
  const available = [...candidateColumns];
  while (available.length > 0) {
    const current = parsedData.map(
      (row) => workingKeys.map((k) => String(row[k] ?? "")).join("\0")
    );
    if (new Set(current).size === parsedData.length) break;
    let bestCol = null;
    let bestCount = new Set(current).size;
    for (const col of available) {
      const test = parsedData.map(
        (row) => [...workingKeys, col].map((k) => String(row[k] ?? "")).join("\0")
      );
      const count = new Set(test).size;
      if (count > bestCount) {
        bestCount = count;
        bestCol = col;
      }
    }
    if (bestCol === null) break;
    workingKeys.push(bestCol);
    available.splice(available.indexOf(bestCol), 1);
  }
  const added = workingKeys.slice(keys.length);
  const greedyIsUnique = new Set(
    parsedData.map((row) => workingKeys.map((k) => String(row[k] ?? "")).join("\0"))
  ).size === parsedData.length;
  return {
    isUnique,
    duplicateCount,
    duplicateValues,
    candidates,
    suggestedAdditionalKeys: added.length > 0 && greedyIsUnique ? added : null
  };
}
var PSYCH_DS_FILENAME_RE = /^([a-z]+-[a-zA-Z0-9]+)(_[a-z]+-[a-zA-Z0-9]+)*_data\.(csv|tsv)$/;
function isValidPsychDSDataFilename(name) {
  return PSYCH_DS_FILENAME_RE.test(name);
}
function toPsychDSValue(name, fallback = "value") {
  const parts = name.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  return parts[0] + parts.slice(1).map((p) => p[0].toUpperCase() + p.slice(1)).join("");
}
function deriveFallbackBase(stem) {
  return `subject-${toPsychDSValue(stem, "file")}`;
}
function deriveArrayFilename(parentBase, columnName) {
  return `${parentBase}_measure-${toPsychDSValue(columnName, "col")}_data.csv`;
}
function objectsToCSV(rows, priorityCols = ["trial_index", "element_index"]) {
  if (rows.length === 0) return "";
  const allKeys = /* @__PURE__ */ new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) allKeys.add(key);
  }
  const otherCols = [...allKeys].filter((k) => !priorityCols.includes(k));
  const headers = [...priorityCols.filter((c) => allKeys.has(c)), ...otherCols];
  const escape = (val) => {
    if (val === null || val === void 0) return "";
    const str = typeof val === "object" ? JSON.stringify(val) : String(val);
    return str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r") ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\r\n");
}
function disambiguateArrayFilename(base, used) {
  if (!used.has(base)) return base;
  const suffix = "_data.csv";
  const root = base.endsWith(suffix) ? base.slice(0, -suffix.length) : base.replace(/\.csv$/i, "");
  let n = 2;
  let candidate = `${root}${n}${suffix}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${root}${n}${suffix}`;
  }
  return candidate;
}
var isUnnamedHeader = (key) => key.trim() === "";
function hasUnnamedColumns(rows) {
  return rows.some((row) => Object.keys(row).some(isUnnamedHeader));
}
function stripUnnamedColumns(rows) {
  const unnamed = /* @__PURE__ */ new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (isUnnamedHeader(key)) unnamed.add(key);
    }
  }
  if (unnamed.size > 0) {
    for (const row of rows) {
      for (const key of unnamed) delete row[key];
    }
  }
  return { rows, dropped: [...unnamed] };
}
function buildPsychDSDataFiles(args) {
  const {
    base,
    mainRows,
    mainContent,
    extractedArrays = /* @__PURE__ */ new Map(),
    extractedObjects = /* @__PURE__ */ new Map(),
    joinKeys = ["trial_index"],
    usedArrayFilenames = /* @__PURE__ */ new Set()
  } = args;
  const out = [];
  const reserve = (name) => {
    if (!isValidPsychDSDataFilename(name)) {
      throw new Error(`Refusing to write non-Psych-DS-compliant data filename "${name}".`);
    }
    usedArrayFilenames.add(name);
    return name;
  };
  const mainName = reserve(disambiguateArrayFilename(`${base}_data.csv`, usedArrayFilenames));
  const { rows: cleanedMainRows, dropped: droppedMain } = stripUnnamedColumns(mainRows);
  out.push({
    filename: mainName,
    content: mainContent !== void 0 && droppedMain.length === 0 ? mainContent : objectsToCSV(cleanedMainRows, ["trial_index"]),
    kind: "main"
  });
  const arrayPriority = [...joinKeys, "element_index"];
  for (const [colName, rows] of extractedArrays) {
    const name = reserve(disambiguateArrayFilename(deriveArrayFilename(base, colName), usedArrayFilenames));
    out.push({ filename: name, content: objectsToCSV(rows, arrayPriority), kind: "array" });
  }
  for (const [colName, rows] of extractedObjects) {
    const name = reserve(disambiguateArrayFilename(deriveArrayFilename(base, colName), usedArrayFilenames));
    out.push({ filename: name, content: objectsToCSV(rows, joinKeys), kind: "object" });
  }
  return out;
}
async function parseCSV(input) {
  if (!parse) {
    throw new Error("Parser module not loaded");
  }
  return new Promise((resolve, reject) => {
    parse(input, {
      columns: true,
      // Treat the first row as headers
      delimiter: ",",
      // Specify the delimiter (e.g., comma)
      bom: true
      // Strip a leading UTF-8 BOM so the first header name isn't corrupted (e.g. "﻿Participant_ID")
    }, (err, records) => {
      if (err) {
        reject(err);
      } else {
        resolve(records);
      }
    });
  });
}

// src/VariablesMap.ts
var VariablesMap = class _VariablesMap {
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
  constructor() {
    this.generateDefaultVariables();
  }
  /**
   * The fixed jsPsych definition for a system column, or null if `name` is not a known system
   * variable. Returns a fresh object on each call so callers never share/mutate one template.
   */
  static systemVariableTemplate(name) {
    switch (name) {
      case "trial_type":
        return {
          "@type": "PropertyValue",
          name: "trial_type",
          description: { default: "unknown", jsPsych: "The name of the plugin used to run the trial." },
          value: "string"
        };
      case "trial_index":
        return {
          "@type": "PropertyValue",
          name: "trial_index",
          description: { default: "unknown", jsPsych: "The index of the current trial across the whole experiment." },
          value: "number"
        };
      case "time_elapsed":
        return {
          "@type": "PropertyValue",
          name: "time_elapsed",
          description: {
            default: "unknown",
            jsPsych: "The number of milliseconds between the start of the experiment and when the trial ended."
          },
          value: "number"
        };
      case "extension_type":
        return {
          "@type": "PropertyValue",
          name: "extension_type",
          description: { default: "unknown", jsPsych: "The name(s) of the extension(s) used in the trial." },
          value: "string"
        };
      case "extension_version":
        return {
          "@type": "PropertyValue",
          name: "extension_version",
          description: { default: "unknown", jsPsych: "The version(s) of the extension(s) used in the trial." },
          value: "number"
        };
      default:
        return null;
    }
  }
  /**
   * Lazily registers the default jsPsych definition for a system column the first time it is
   * observed in the data. No-op (returns false) when `name` is not a known system variable or
   * is already present; returns true when a new variable was registered. This is what keeps a
   * system variable out of variableMeasured unless the data actually contains that column.
   *
   * @param {string} name - The column / system-variable name.
   * @returns {boolean} - True if a variable was registered, false otherwise.
   */
  registerSystemVariable(name) {
    if (this.containsVariable(name)) return false;
    const template = _VariablesMap.systemVariableTemplate(name);
    if (!template) return false;
    this.setVariable(template);
    return true;
  }
  /**
   * Initialises the variable map. System variables are registered lazily (see the constructor
   * and {@link registerSystemVariable}), so this just resets the map to empty.
   */
  generateDefaultVariables() {
    this.variables = {};
  }
  /**
   * Returns a list of the variables instead of an object according to the Psych-DS format.
   *
   * @returns {{}[]} - The list of variables represented as objects.
   */
  getList() {
    var var_list = [];
    for (const key of Object.keys(this.variables)) {
      const variable = this.variables[key];
      variable["description"] = this.collapseDescription(variable["description"]);
      var_list.push(variable);
    }
    return var_list;
  }
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
  collapseDescription(description) {
    if (typeof description !== "object" || description === null) {
      return description;
    }
    if (Object.keys(description).length === 0) {
      console.error("Empty description");
      return "unknown";
    }
    if (Object.keys(description).length > 1 && "default" in description) {
      delete description["default"];
    }
    for (const descKey of Object.keys(description)) {
      if (description[descKey] === "unknown" && Object.keys(description).length > 1) {
        delete description[descKey];
      }
    }
    return Object.values(description).join(" | ");
  }
  /**
   * Allows user to set a variable and includes all the fields that are possible according to
   * Psych-DS guidelines. Only requires the name field which it uses a key to map to the variable.
   * Can also be used to overwrite existing variables if they have the same name.
   *
   * @param {VariableFields} variable - The fields of the variable that is being created.
   */
  setVariable(variable) {
    if (!variable.name) {
      console.warn("Name field is missing. Variable not added.", variable);
      return;
    }
    this.variables[variable.name] = variable;
    const unexpectedFields = Object.keys(variable).filter(
      (key) => ![
        "@type",
        "name",
        "description",
        "value",
        "identifier",
        "minValue",
        "maxValue",
        "levels",
        "levelsOrdered",
        "na",
        "naValue",
        "alternateName",
        "privacy"
      ].includes(key)
    );
    if (unexpectedFields.length > 0) {
      console.warn(
        `Unexpected fields (${unexpectedFields.join(
          ", "
        )}) detected and included in the variable object.`
      );
    }
  }
  /**
   * Allows you to get information for a single variable returning empty dict if it doesn't exist.
   * Allows you to update fields but not recommended in favor of updateVariable.
   *
   * @param {string} name
   * @returns {(VariableFields | {})} - Variable information or empty dict if doesn't exist
   */
  getVariable(name) {
    return this.variables[name] || {};
  }
  /**
   * Checks if variable exists in VariablesMap.
   *
   * @param {string} name - Name of variable
   * @returns {boolean} - True if exists, false if doesn't.
   */
  containsVariable(name) {
    return name in this.variables;
  }
  /**
   * Method that gets a list of the names of variables.
   *
   * @returns {string[]} - String list containing names of existing variables.
   */
  getVariableNames() {
    var var_list = [];
    for (const key of Object.keys(this.variables)) {
      var_list.push(this.variables[key]["name"]);
    }
    return var_list;
  }
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
  updateVariable(var_name, field_name, added_value) {
    const updated_var = this.getVariable(var_name);
    if (Object.keys(updated_var).length === 0) {
      console.error(`Variable "${var_name}" does not exist.`);
      return;
    }
    if (field_name === "levels") {
      this.updateLevels(updated_var, added_value);
    } else if (field_name === "minValue" || field_name === "maxValue") {
      this.updateMinMax(updated_var, added_value, field_name);
    } else if (field_name === "description") {
      this.updateDescription(updated_var, added_value);
    } else if (field_name === "name") {
      this.updateName(updated_var, added_value);
    } else {
      updated_var[field_name] = added_value;
    }
  }
  /**
   * Logic that handles updates to levels field by creating new array if necessary, otherwise
   * pushing the value if it doesn't already exist. Levels can only be added to with strings.
   *
   * @private
   * @param {*} updated_var - The variable object to be updated.
   * @param {*} added_value - The value being added to the levels field.
   */
  updateLevels(updated_var, added_value) {
    if (typeof added_value === "object")
      return;
    const MAX_LENGTH = 50;
    if (added_value.length > MAX_LENGTH) {
      added_value = added_value.substring(0, MAX_LENGTH) + "...";
    }
    if (!Array.isArray(updated_var["levels"])) {
      updated_var["levels"] = [];
    }
    if (!updated_var["levels"].includes(added_value)) {
      updated_var["levels"].push(added_value);
    }
  }
  /**
   * Logic to update the min and max for the specific value.
   *
   * @private
   * @param {*} updated_var - The variable object to be updated.
   * @param {*} added_value - The value that is being checked against current min/max.
   * @param {*} field_name - The name of field that is being checked (min or max).
   */
  updateMinMax(updated_var, added_value, field_name) {
    if (!("minValue" in updated_var) || !("maxValue" in updated_var)) {
      updated_var["maxValue"] = updated_var["minValue"] = added_value;
      return;
    }
    if (field_name === "minValue" && updated_var["minValue"] > added_value) {
      updated_var["minValue"] = added_value;
    } else if (field_name === "maxValue" && updated_var["maxValue"] < added_value) {
      updated_var["maxValue"] = added_value;
    }
  }
  /**
   * Logic for updating description field that checks to see value already exists. If it does,
   * appends the pluginType to the current key and pushes that along with the value. Creates
   * map if it does not exist.
   *
   * @private
   * @param {*} updated_var - The variable to be updated.
   * @param {*} added_value - The value to be added with the key being the name of the plugin and the key being the description field.
   */
  updateDescription(updated_var, added_value) {
    const add_key = Object.keys(added_value)[0];
    const add_value = Object.values(added_value)[0];
    if (add_key === "undefined" || add_value === "undefined") {
      console.error("New value is passed in bad format", added_value);
      return;
    }
    var exists = false;
    if (typeof updated_var["description"] !== "object") {
      const existing = updated_var["description"];
      updated_var["description"] = typeof existing === "string" && existing && existing !== "unknown" ? { default: existing } : {};
    }
    Object.entries(updated_var["description"]).forEach(([key, value]) => {
      if (value === add_value) {
        if (!key.includes(add_key)) {
          delete updated_var["description"][key];
          updated_var["description"][key + ", " + add_key] = add_value;
        }
        exists = true;
      }
    });
    if (!exists) Object.assign(updated_var["description"], added_value);
  }
  /**
   * Logic for updating name. Needs to retain all the old values while creating a new reference in the map
   * while keeping the same perspe
   *
   * @private
   * @param {*} updated_var
   * @param {*} added_value
   */
  updateName(updated_var, added_value) {
    const old_name = updated_var["name"];
    updated_var["name"] = added_value;
    delete this.variables[old_name];
    this.setVariable(updated_var);
  }
  /**
   * Allows you to delete a variable by key/name. Returns console error if not found.
   *
   * @param {string} var_name - Name of variable to be deleted.
   */
  deleteVariable(var_name) {
    if (var_name in this.variables) {
      delete this.variables[var_name];
    } else {
      console.error(`Variable "${var_name}" does not exist.`);
    }
  }
};

// src/index.ts
var JsPsychMetadata = class {
  /**
   * Creates an instance of JsPsychMetadata while passing in JsPsych object to have access to context
   *  allowing it to access the screen printing information.
   *
   * @constructor
   * @param {JsPsych} JsPsych
   */
  constructor(verbose) {
    /**
     * Initializes a set that contains the variable fields that are to be ignored, so can help with later 
     * logic when generating data.
     *
     * @private
     * @type {*}
     */
    this.ignored_variables = new Set(SYSTEM_COLUMNS);
    /**
     * Verbose mode that is used in by the tools that call this to print fetching messages and 
     * reading messages.
     *
     * @private
     * @type {boolean}
     */
    this.verbose = false;
    this.extractedArrays = /* @__PURE__ */ new Map();
    // Plain (non-array) object columns expanded by expandObjectFields. One row per trial,
    // keyed by the same arrayJoinKeys as extractedArrays, with a column for every dotted
    // descendant variable (leaf scalars, intermediate object nodes, and nested-array parents).
    // The CLI writes these as separate Psych-DS CSVs so those dotted names map to real columns.
    this.extractedObjects = /* @__PURE__ */ new Map();
    this.arrayJoinKeys = ["trial_index"];
    this.mixedColumns = /* @__PURE__ */ new Set();
    this.metadata = {};
    this.setMetadataField("name", "title");
    this.setMetadataField("schemaVersion", "Psych-DS 0.4.0");
    this.setMetadataField("@context", "https://schema.org");
    this.setMetadataField("@type", "Dataset");
    this.setMetadataField("description", "Dataset generated using JsPsych");
    this.authors = new AuthorsMap();
    this.variables = new VariablesMap();
    this.pluginCache = new PluginCache();
    this.verbose = verbose;
  }
  /**
   * Method that sets simple metadata fields. This method can also be used to update/overwrite existing fields.
   *
   * @param {string} key - Metadata field name
   * @param {*} value - Data associated with the field
   */
  setMetadataField(key, value) {
    this.metadata[key] = value;
  }
  /**
   * Simple get that accesses the data associated with a field.
   *
   * @param {string} key - Field name
   * @returns {*} - Data associated with the field
   */
  getMetadataField(key) {
    return this.metadata[key];
  }
  /**
   * Checks if the metadata field exists in the metadata.
   *
   * @param {string} key - Key of metadata being checked.
   * @returns {*} - Boolean
   */
  containsMetadataField(key) {
    return key in this.metadata;
  }
  /**
   * Deletes a metadata from the metadata if it exists. 
   *
   * @param {string} key - Name of field to be deleted
   */
  deleteMetadataField(key) {
    if (key in this.metadata) {
      delete this.metadata[key];
    } else {
      console.error(`Metadata "${key}" does not exist.`);
    }
  }
  /**
   * Returns the final Metadata in a single javascript object. Bundles together the author and variables
   * together in a list rather than object compliant with Psych-DS standards. Seems that javascript get
   * are implictly called.
   *
   * @returns {{}} - Final Metadata object
   */
  getMetadata() {
    const res = this.metadata;
    res["author"] = this.authors.getList();
    res["variableMeasured"] = this.variables.getList();
    return res;
  }
  getUserMetadataFields() {
    const res = {};
    const ignored_fields = /* @__PURE__ */ new Set(["schemaVersion", "@type", "@context", "author", "variableMeasured"]);
    for (const key in this.metadata) {
      if (!ignored_fields.has(key)) {
        res[key] = this.metadata[key];
      }
    }
    return res;
  }
  /**
   * Returns the variable fields while excluding the authors and variables.`
   *
   * @returns {{}} - Final Metadata object
   */
  getMetadataFields() {
    const res = this.metadata;
    delete res["author"];
    delete res["variableMeasured"];
    return res;
  }
  /**
   * Method that creates an author. This method can also be used to overwrite existing authors
   * with the same name in order to update fields.
   *
   * @param {AuthorFields | string} author - All the required or possible fields associated with listing an author according to Psych-DS standards. Option as a string to define an author according only to name.
   */
  setAuthor(fields) {
    this.authors.setAuthor(fields);
  }
  /**
   * Method that fetches an author object allowing user to update (in existing workflow should not be necessary).
   *
   * @param {string} name - Name of author to be used as key.
   * @returns {(AuthorFields | string | {})} - Object with author information. Empty object if not found.
   */
  getAuthor(name) {
    return this.authors.getAuthor(name);
  }
  /**
   * Returns a list of the authors defined in the metadata.
   *
   * @returns {(string | AuthorFields)[]} - Authors
   */
  getAuthorList() {
    return this.authors.getList();
  }
  /**
   * Deletes an author from the authorsField.
   *
   * @param {string} name - Name of author to be deleted.
   */
  deleteAuthor(name) {
    this.authors.deleteAuthor(name);
  }
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
  setVariable(variable) {
    this.variables.setVariable(variable);
  }
  /**
   * Allows you to access a variable's information by using the name of the variable. Can
   * be used to update fields within a variable, but suggest using updateVariable() to prevent errors.
   *
   * @param {string} name - Name of variable to be accessed
   * @returns {{}} - Returns object of fields
   */
  getVariable(name) {
    return this.variables.getVariable(name);
  }
  /**
   * Returns a list of the variables defined in the metadata.
   *
   * @returns {{}[]} - Authors
   */
  getVariableList() {
    return this.variables.getList();
  }
  /**
   * Allows you to check if the name of the variable exists in variablesMap.
   *
   * @param {string} name - Name of variable
   * @returns {boolean} - Does variable exist in variables
   */
  containsVariable(name) {
    return this.variables.containsVariable(name);
  }
  /**
   * Allows you to update a variable or add a value in the case of updating values. In other situations will
   * replace the existing value with the new value.
   *
   * @param {string} var_name - Name of variable to be updated.
   * @param {string} field_name - Name of field to be updated.
   * @param {(string | boolean | number | {})} added_value - Value to be used in the update.
   */
  updateVariable(var_name, field_name, added_value) {
    this.variables.updateVariable(var_name, field_name, added_value);
  }
  /**
   * Allows you to delete a variable by key/name.
   *
   * @param {string} var_name - Name of variable to be deleted.
   */
  deleteVariable(var_name) {
    this.variables.deleteVariable(var_name);
  }
  /**
   * Gets a list of all the variable names.
   *
   * @returns {string[]} - List of variable string names.
   */
  getVariableNames() {
    return this.variables.getVariableNames();
  }
  /**
   * Returns accumulated array-column data keyed by column name.
   * Each entry is a list of rows with join key columns, element_index, and the element's own fields.
   * Used by the CLI to write Psych-DS compliant separate CSV files.
   */
  getExtractedArrays() {
    return this.extractedArrays;
  }
  /**
   * Returns accumulated plain-object-column data keyed by the top-level column name.
   * Each entry is one row per trial: the join key columns plus a column for every dotted
   * descendant variable expanded from that object (matching the names in variableMeasured).
   * Used by the CLI to write a separate Psych-DS CSV per object column, so those dotted
   * sub-variables resolve to real columns. No element_index (one row per trial, not per element).
   */
  getExtractedObjects() {
    return this.extractedObjects;
  }
  /**
   * Returns the join key columns used in the most recent generate() call.
   * The CLI uses this to order columns correctly in extracted array CSVs.
   */
  getArrayJoinKeys() {
    return [...this.arrayJoinKeys];
  }
  warnJoinKeyUniqueness(analysis) {
    const keyStr = this.arrayJoinKeys.join(", ");
    const exampleStr = analysis.duplicateValues.slice(0, 3).map((v) => Object.entries(v).map(([k, val]) => `${k}=${val}`).join(", ")).join("; ");
    let msg = `[jspsych-metadata] Join key (${keyStr}) is not unique in this dataset
  (${analysis.duplicateCount} duplicate rows; e.g. ${exampleStr})
`;
    if (analysis.suggestedAdditionalKeys !== null && analysis.suggestedAdditionalKeys.length === 0) {
      const sufficient = analysis.candidates.filter((c) => c.makesUnique).map((c) => c.column);
      const example = JSON.stringify([sufficient[0], ...this.arrayJoinKeys]);
      msg += `  Sufficient fix: add one of these columns to arrayJoinKeys:
    ${sufficient.join(", ")}
  Pass { arrayJoinKeys: ${example} } as the options argument to generate().`;
    } else if (analysis.suggestedAdditionalKeys !== null && analysis.suggestedAdditionalKeys.length > 0) {
      const combined = JSON.stringify([...analysis.suggestedAdditionalKeys, ...this.arrayJoinKeys]);
      msg += `  No single column makes rows unique. Suggested combination:
    ${analysis.suggestedAdditionalKeys.join(" + ")}
  Pass { arrayJoinKeys: ${combined} } as the options argument to generate().`;
    } else {
      msg += `  No combination of available columns was found to make rows unique.
  Your data may contain genuinely duplicate rows.
  Extracted array CSVs will have non-unique join keys.`;
    }
    console.warn(msg);
  }
  /**
   * Method that allows you to display metadata at the end of an experiment.
   *
   * @param {string} [elementId="jspsych-metadata-display"] - Id for how to style the metadata. Defaults to default styling.
   */
  displayMetadata(display_element) {
    const elementId = "jspsych-metadata-display";
    const metadata_string = JSON.stringify(this.getMetadata(), null, 2);
    display_element.innerHTML += `<p id="jspsych-metadata-header">Metadata</p><pre id="${elementId}" class="jspsych-preformat"></pre>`;
    document.getElementById(elementId).textContent += metadata_string;
  }
  /**
   * Method that begins a download for the dataset_description.json at the end of experiment.
   * Allows you to download the metadat.
   */
  localSave() {
    let data_string = JSON.stringify(this.getMetadata());
    saveTextToFile(data_string, "dataset_description.json");
  }
  /**
   * This method loads the metadata into the metadata object. This takes in the"dataset_description.json" string content 
   * and first parses it as an object. This then loads in all the fields, authors and variables into the metadata object by calling all the 
   * relevant methods that overwrites the default data.
   *
   * @param {string} stringMetadata - String version of the metadata to be loaded from "dataset_description.json".
   */
  loadMetadata(stringMetadata) {
    const meta = JSON.parse(stringMetadata);
    for (const field_key in meta) {
      if (field_key === "variableMeasured") {
        for (const variable of meta[field_key]) {
          this.setVariable(variable);
        }
      } else if (field_key === "author") {
        for (const author of meta[field_key]) {
          this.setAuthor(author);
        }
      } else {
        this.setMetadataField(field_key, meta[field_key]);
      }
    }
  }
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
  async generate(data, metadata = {}, ext = "json", options = {}) {
    this.extractedArrays = /* @__PURE__ */ new Map();
    this.extractedObjects = /* @__PURE__ */ new Map();
    this.arrayJoinKeys = options.arrayJoinKeys ?? ["trial_index"];
    var parsed_data;
    let synthesizedSourceRecordId = options.synthesizedSourceRecordId ?? false;
    if (Array.isArray(data)) {
      parsed_data = data;
    } else if (ext === "csv") {
      parsed_data = await parseCSV(data);
    } else if (ext === "json") {
      const parseStats = {};
      parsed_data = parseJsonData(data, { tagSourceRecordId: true }, parseStats);
      synthesizedSourceRecordId = parseStats.synthesizedSourceRecordId === true;
    }
    if (!Array.isArray(parsed_data)) {
      throw new Error("Parsed data is not in correct format: Expected an array of observations");
    }
    const { dropped } = stripUnnamedColumns(parsed_data);
    if (dropped.length > 0) {
      console.warn(
        `Dropped ${dropped.length} unnamed column${dropped.length > 1 ? "s" : ""} from the data \u2014 Psych-DS requires every column to have a name (usually a row-index column added by R's write.csv). Excluded from variableMeasured.`
      );
    }
    const rows = parsed_data;
    const hasColumn = (col) => ext === "json" && rows.some((row) => row && typeof row === "object" && col in row);
    const idColumn = hasColumn("source_record_id") ? "source_record_id" : hasColumn("participant_id") ? "participant_id" : void 0;
    if (idColumn && !this.arrayJoinKeys.includes(idColumn)) {
      this.arrayJoinKeys = [idColumn, ...this.arrayJoinKeys];
    }
    const analysis = analyzeJoinKeys(parsed_data, this.arrayJoinKeys);
    if (!analysis.isUnique && !options.suppressJoinKeyWarning) this.warnJoinKeyUniqueness(analysis);
    for (const observation of parsed_data) {
      await this.generateObservation(observation);
    }
    if (synthesizedSourceRecordId && this.containsVariable("source_record_id")) {
      const existing = this.getVariable("source_record_id");
      this.setVariable({
        ...existing,
        description: { default: "Synthetic source-record identifier (0-based), assigned one per source record (one JSON-Lines line, which is usually but not always one participant) because the raw data carried no identifier column. NOT a real subject ID from the experiment \u2014 it only orders/links records as they appeared in the source file, and serves as a join key connecting each trial to its extracted array/object rows." }
      });
    }
    await this.updateMetadata(metadata);
  }
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
  async generateObservation(observation) {
    const version = observation["plugin_version"] ? observation["plugin_version"] : null;
    const pluginType = observation["trial_type"];
    const extensionType = observation["extension_type"];
    const extensionVersion = observation["extension_version"];
    const joinValues = this.arrayJoinKeys.reduce((acc, k) => {
      acc[k] = observation[k];
      return acc;
    }, {});
    for (const variable in observation) {
      var value = observation[variable];
      var type = typeof value;
      if (!this.containsVariable(variable)) {
        if (this.ignored_variables.has(variable)) {
          this.variables.registerSystemVariable(variable);
        } else {
          this.setVariable({
            "@type": "PropertyValue",
            name: variable,
            description: { default: "unknown" },
            value: "unknown"
          });
        }
      }
      if (value === null || value === void 0 || value === "" || value === "null") {
        continue;
      }
      if (type === "string") {
        const asNumber = Number(value);
        if (value.trim() !== "" && Number.isFinite(asNumber)) {
          type = "number";
          value = asNumber;
        } else if (value.startsWith("{") || value.startsWith("[")) {
          const parsed = tryParseJSON(value);
          if (parsed !== null) {
            value = parsed;
            type = Array.isArray(parsed) ? "array" : "object";
          }
        }
      }
      if (this.ignored_variables.has(variable)) {
        this.updateFields(variable, value, type);
      } else {
        if (type === "object" && value !== null && !Array.isArray(value)) {
          const objectRow = { ...joinValues };
          await this.expandObjectFields(variable, value, pluginType, version, joinValues, objectRow);
          const existingObjects = this.extractedObjects.get(variable) ?? [];
          existingObjects.push(objectRow);
          this.extractedObjects.set(variable, existingObjects);
        } else if (type === "array" || type === "object" && Array.isArray(value)) {
          await this.generateMetadata(variable, value, pluginType, version);
          const existingVar = this.containsVariable(variable) ? this.getVariable(variable) : null;
          const existingType = existingVar?.value;
          if (existingType !== "string" && existingType !== "number" && existingType !== "boolean") {
            this.updateVariable(variable, "value", "array");
          }
          await this.accumulateArrayColumn(variable, value, joinValues, pluginType, version);
        } else {
          await this.generateMetadata(variable, value, pluginType, version);
        }
        if (extensionType) {
          await Promise.all(
            extensionType.map(async (ext, index) => {
              if (ext && extensionVersion[index])
                await this.generateMetadata(variable, value, ext, extensionVersion[index], true);
            })
          );
        }
      }
    }
  }
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
  async generateMetadata(variable, value, pluginType, version, extension) {
    const type = typeof value;
    if (!this.containsVariable(variable)) {
      const new_var = {
        "@type": "PropertyValue",
        name: variable,
        description: { default: "unknown" },
        value: type
      };
      this.setVariable(new_var);
    } else {
      const existing = this.getVariable(variable);
      if (existing.value === "unknown") this.updateVariable(variable, "value", type);
    }
    if (pluginType) {
      const pluginInfo = await this.getPluginInfo(pluginType, variable, version, extension);
      const description = pluginInfo["description"];
      const new_description = description ? { [pluginType]: description } : { [pluginType]: "unknown" };
      this.updateVariable(variable, "description", new_description);
    }
    this.updateFields(variable, value, type);
  }
  /**
   * This calls an update to the individual fields of the metadata, updating levels and 
   * minValue and maxValue depeneding on the variable type.
   *
   * @private
   * @param {*} variable - The column of the data and name of variable
   * @param {*} value - The datapoint 
   * @param {*} type - The type of the datapoint
   */
  updateFields(variable, value, type) {
    if (type === "boolean") return;
    const existing = this.getVariable(variable);
    if (type === "number") {
      if (Array.isArray(existing.levels)) {
        if (!this.mixedColumns.has(variable)) {
          this.mixedColumns.add(variable);
          console.warn(`Variable "${variable}" has mixed numeric and non-numeric values; treating as categorical.`);
        }
        this.updateVariable(variable, "levels", String(value));
        return;
      }
      this.updateVariable(variable, "minValue", value);
      this.updateVariable(variable, "maxValue", value);
      return;
    }
    if (type !== "object") {
      if ("minValue" in existing || "maxValue" in existing) {
        if (!this.mixedColumns.has(variable)) {
          this.mixedColumns.add(variable);
          console.warn(`Variable "${variable}" has mixed numeric and non-numeric values; treating as categorical.`);
        }
        if ("minValue" in existing) this.updateVariable(variable, "levels", String(existing.minValue));
        if ("maxValue" in existing && existing.maxValue !== existing.minValue) {
          this.updateVariable(variable, "levels", String(existing.maxValue));
        }
        delete existing.minValue;
        delete existing.maxValue;
        this.updateVariable(variable, "value", "string");
      }
      if (existing.value === "boolean" && (value === "true" || value === "false")) {
        return;
      }
      this.updateVariable(variable, "levels", value);
    }
  }
  /**
   * Iterates through the entire metadata options object by calling processMetadata() to act upon each of the 
   * individual fields at one time. 
   *
   * @async
   * @param {*} metadata - Metadata options that contains all the metadata according to Psych-DS formatting. 
   */
  async updateMetadata(metadata) {
    for (const key in metadata) {
      await this.processMetadata(metadata, key);
    }
  }
  /**
   * This is the method that processes each individual element of the metadata options to be updated. This can be called through generate or outside of it, 
   * and this processes each element. 
   *
   * @private
   * @param {*} metadata - An object that contains all of the metadata. This is used to access the value. 
   * @param {*} key - String key that denotes what key-value mapping is being iterated upon. 
   */
  processMetadata(metadata, key) {
    const value = metadata[key];
    if (key === "variables") {
      if (typeof value !== "object" || value === null) {
        console.warn("Variable object is either null or incorrect type");
        return;
      }
      for (let variable_key in value) {
        if (!this.containsVariable(variable_key)) {
          console.warn("Metadata does not contain variable:", variable_key);
          continue;
        }
        const variable_parameters = value[variable_key];
        if (typeof variable_parameters !== "object" || variable_parameters === null) {
          console.warn(
            "Parameters of variable:",
            variable_key,
            "is either null or incorrect type. The value",
            variable_parameters,
            "is either null or not an object."
          );
          continue;
        }
        for (const parameter in variable_parameters) {
          const parameter_value = variable_parameters[parameter];
          this.updateVariable(variable_key, parameter, parameter_value);
          if (parameter === "value" && parameter_value === "boolean") {
            this.applyBooleanOverride(variable_key);
          }
          if (parameter === "name") variable_key = parameter_value;
        }
      }
    } else if (key === "author") {
      if (typeof value !== "object" || value === null) {
        console.warn("Author object is not correct type");
        return;
      }
      for (const author_key in value) {
        const author = value[author_key];
        if (typeof author !== "string" && !("name" in author)) author["name"] = author_key;
        this.setAuthor(author);
      }
    } else this.setMetadataField(key, value);
  }
  /**
   * Applies a user-chosen `value:"boolean"` override to an already-populated variable.
   * Warns when the values detected from the data don't map cleanly to boolean logic
   * (anything other than true/false/0/1, case-insensitive), then drops the detected
   * levels/min/max so the variable matches how genuine booleans are recorded (no levels).
   */
  applyBooleanOverride(variableName) {
    const existing = this.getVariable(variableName);
    const isBooleanLike = (v) => {
      const s = String(v).trim().toLowerCase();
      return s === "true" || s === "false" || s === "0" || s === "1";
    };
    const offenders = /* @__PURE__ */ new Set();
    if (Array.isArray(existing.levels)) {
      for (const level of existing.levels) if (!isBooleanLike(level)) offenders.add(String(level));
    }
    if (typeof existing.minValue === "number" && !isBooleanLike(existing.minValue)) offenders.add(String(existing.minValue));
    if (typeof existing.maxValue === "number" && !isBooleanLike(existing.maxValue)) offenders.add(String(existing.maxValue));
    if (offenders.size > 0) {
      const sample = [...offenders].slice(0, 10).join(", ");
      const more = offenders.size > 10 ? `, \u2026(+${offenders.size - 10} more)` : "";
      console.warn(
        `Variable "${variableName}" was set to value:"boolean", but the detected values don't map cleanly to true/false: ${sample}${more}. Double-check this is the intended type.`
      );
    }
    delete existing.levels;
    delete existing.minValue;
    delete existing.maxValue;
  }
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
  async expandObjectFields(parentName, obj, pluginType, version, joinValues, row) {
    await this.generateMetadata(parentName, obj, pluginType, version);
    for (const key of Object.keys(obj)) {
      const childName = `${parentName}.${key}`;
      const childValue = obj[key];
      if (row) row[childName] = childValue;
      if (childValue !== null && typeof childValue === "object" && !Array.isArray(childValue)) {
        await this.expandObjectFields(childName, childValue, pluginType, version, joinValues, row);
      } else if (Array.isArray(childValue)) {
        await this.generateMetadata(childName, childValue, pluginType, version);
        this.updateVariable(childName, "value", "array");
        await this.accumulateArrayColumn(childName, childValue, joinValues, pluginType, version);
      } else {
        await this.generateMetadata(childName, childValue, pluginType, version);
      }
    }
  }
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
  async accumulateArrayColumn(columnName, arr, joinValues, pluginType, version) {
    const elements = [];
    arr.forEach((element, index) => {
      if (element !== null && element !== void 0) elements.push({ element, index });
    });
    if (elements.length === 0) return;
    if (!this.containsVariable("element_index")) {
      this.setVariable({
        "@type": "PropertyValue",
        name: "element_index",
        description: { default: "Position of this element within its source array column (0-based)." },
        value: "number"
      });
    }
    for (const joinKey of Object.keys(joinValues)) {
      if (!this.containsVariable(joinKey)) {
        this.setVariable({
          "@type": "PropertyValue",
          name: joinKey,
          description: { default: "Join key referencing the position of an enclosing array element (0-based index)." },
          value: "number"
        });
      }
    }
    const existing = this.extractedArrays.get(columnName) ?? [];
    for (const { element, index } of elements) {
      const row = { ...joinValues, element_index: index };
      const nestedJoin = { ...joinValues, [`${columnName}.element_index`]: index };
      if (typeof element === "object" && !Array.isArray(element)) {
        await this.expandElementFields(columnName, element, row, nestedJoin, pluginType, version);
      } else {
        const valueName = `${columnName}.value`;
        row[valueName] = element;
        if (Array.isArray(element)) {
          await this.registerNodeVariable(valueName, element, "array", pluginType, version);
          await this.accumulateArrayColumn(valueName, element, nestedJoin, pluginType, version);
        } else {
          await this.registerScalarField(valueName, element, pluginType, version);
        }
      }
      existing.push(row);
    }
    this.extractedArrays.set(columnName, existing);
  }
  /**
   * Recursively records one array element's fields into `row` under dotted names. Scalars become
   * columns with type + min/max/levels tracking; nested plain objects are expanded into the SAME
   * row (deeper dotted columns); nested arrays are extracted into their own grandchild CSV via
   * accumulateArrayColumn (keyed by `nestedJoin`). Object/array nodes are also kept as a single
   * dotted JSON column so their own name is represented as a column too.
   */
  async expandElementFields(prefix, obj, row, nestedJoin, pluginType, version) {
    for (const key of Object.keys(obj)) {
      const name = `${prefix}.${key}`;
      const value = obj[key];
      row[name] = value;
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        await this.registerNodeVariable(name, value, "object", pluginType, version);
        await this.expandElementFields(name, value, row, nestedJoin, pluginType, version);
      } else if (Array.isArray(value)) {
        await this.registerNodeVariable(name, value, "array", pluginType, version);
        await this.accumulateArrayColumn(name, value, nestedJoin, pluginType, version);
      } else {
        await this.registerScalarField(name, value, pluginType, version);
      }
    }
  }
  /** Registers an object/array node variable once (with its plugin description, if any). */
  async registerNodeVariable(name, value, type, pluginType, version) {
    if (this.containsVariable(name) && this.getVariable(name).value !== "unknown") return;
    await this.generateMetadata(name, value, pluginType, version);
    if (!this.containsVariable(name)) {
      this.setVariable({ "@type": "PropertyValue", name, description: { default: "unknown" }, value: type });
    } else {
      this.updateVariable(name, "value", type);
    }
  }
  /**
   * Registers one scalar array-element field under its dotted name (so the sidecar column is
   * represented in variableMeasured), then folds later values into min/max/levels. Empty values
   * still declare the column (placeholder) without polluting min/max/levels.
   */
  async registerScalarField(name, value, pluginType, version) {
    if (value === null || value === void 0 || value === "" || value === "null") {
      if (!this.containsVariable(name)) {
        this.setVariable({ "@type": "PropertyValue", name, description: { default: "unknown" }, value: "unknown" });
      }
      return;
    }
    const type = typeof value;
    const needsRegister = !this.containsVariable(name) || this.getVariable(name).value === "unknown";
    if (needsRegister) {
      await this.generateMetadata(name, value, pluginType, version);
      if (!this.containsVariable(name)) {
        this.setVariable({ "@type": "PropertyValue", name, description: { default: "unknown" }, value: type });
        this.updateFields(name, value, type);
      }
    } else {
      this.updateFields(name, value, type);
    }
  }
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
  async getPluginInfo(pluginType, variableName, version, extension) {
    return this.pluginCache.getPluginInfo(pluginType, variableName, version, this.verbose, extension);
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PSYCHDS_IGNORE_CONTENT,
  PSYCHDS_IGNORE_FILENAME,
  analyzeJoinKeys,
  buildPsychDSDataFiles,
  deriveArrayFilename,
  deriveFallbackBase,
  disambiguateArrayFilename,
  hasUnnamedColumns,
  isValidPsychDSDataFilename,
  objectsToCSV,
  parseCSV,
  parseJsonData,
  stripUnnamedColumns,
  toPsychDSValue,
  unwrapTrials
});
