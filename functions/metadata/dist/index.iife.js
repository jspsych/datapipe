var JsPsychMetadata = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from2, except, desc) => {
    if (from2 && typeof from2 === "object" || typeof from2 === "function") {
      for (let key of __getOwnPropNames(from2))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from2[key], enumerable: !(desc = __getOwnPropDesc(from2, key)) || desc.enumerable });
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
    async getPluginInfo(pluginType, variableName, version2, verbose, extension) {
      if (!(pluginType in this.pluginFields)) {
        const fields = await this.generatePluginFields(pluginType, version2, verbose, extension);
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
    async generatePluginFields(pluginType, version2, verbose, extension) {
      const script = await this.fetchScript(pluginType, version2, verbose, extension);
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
    generateUnpkg(pluginType, version2, extension) {
      if (extension) {
        if (version2) {
          return `https://unpkg.com/@jspsych/extension-${pluginType}@${version2}/src/index.ts`;
        } else return `https://unpkg.com/@jspsych/extension-${pluginType}/src/index.ts`;
      }
      if (version2) {
        return `https://unpkg.com/@jspsych/plugin-${pluginType}@${version2}/src/index.ts`;
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
    async fetchScript(pluginType, version2, verbose, extension) {
      const unpkgUrl = this.generateUnpkg(pluginType, version2, extension);
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

  // ../../node_modules/csv-parse/dist/esm/index.js
  var global$1 = typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {};
  var lookup = [];
  var revLookup = [];
  var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
  var inited = false;
  function init() {
    inited = true;
    var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (var i = 0, len = code.length; i < len; ++i) {
      lookup[i] = code[i];
      revLookup[code.charCodeAt(i)] = i;
    }
    revLookup["-".charCodeAt(0)] = 62;
    revLookup["_".charCodeAt(0)] = 63;
  }
  function toByteArray(b64) {
    if (!inited) {
      init();
    }
    var i, j, l, tmp, placeHolders, arr;
    var len = b64.length;
    if (len % 4 > 0) {
      throw new Error("Invalid string. Length must be a multiple of 4");
    }
    placeHolders = b64[len - 2] === "=" ? 2 : b64[len - 1] === "=" ? 1 : 0;
    arr = new Arr(len * 3 / 4 - placeHolders);
    l = placeHolders > 0 ? len - 4 : len;
    var L = 0;
    for (i = 0, j = 0; i < l; i += 4, j += 3) {
      tmp = revLookup[b64.charCodeAt(i)] << 18 | revLookup[b64.charCodeAt(i + 1)] << 12 | revLookup[b64.charCodeAt(i + 2)] << 6 | revLookup[b64.charCodeAt(i + 3)];
      arr[L++] = tmp >> 16 & 255;
      arr[L++] = tmp >> 8 & 255;
      arr[L++] = tmp & 255;
    }
    if (placeHolders === 2) {
      tmp = revLookup[b64.charCodeAt(i)] << 2 | revLookup[b64.charCodeAt(i + 1)] >> 4;
      arr[L++] = tmp & 255;
    } else if (placeHolders === 1) {
      tmp = revLookup[b64.charCodeAt(i)] << 10 | revLookup[b64.charCodeAt(i + 1)] << 4 | revLookup[b64.charCodeAt(i + 2)] >> 2;
      arr[L++] = tmp >> 8 & 255;
      arr[L++] = tmp & 255;
    }
    return arr;
  }
  function tripletToBase64(num) {
    return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
  }
  function encodeChunk(uint8, start, end) {
    var tmp;
    var output = [];
    for (var i = start; i < end; i += 3) {
      tmp = (uint8[i] << 16) + (uint8[i + 1] << 8) + uint8[i + 2];
      output.push(tripletToBase64(tmp));
    }
    return output.join("");
  }
  function fromByteArray(uint8) {
    if (!inited) {
      init();
    }
    var tmp;
    var len = uint8.length;
    var extraBytes = len % 3;
    var output = "";
    var parts = [];
    var maxChunkLength = 16383;
    for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
      parts.push(encodeChunk(uint8, i, i + maxChunkLength > len2 ? len2 : i + maxChunkLength));
    }
    if (extraBytes === 1) {
      tmp = uint8[len - 1];
      output += lookup[tmp >> 2];
      output += lookup[tmp << 4 & 63];
      output += "==";
    } else if (extraBytes === 2) {
      tmp = (uint8[len - 2] << 8) + uint8[len - 1];
      output += lookup[tmp >> 10];
      output += lookup[tmp >> 4 & 63];
      output += lookup[tmp << 2 & 63];
      output += "=";
    }
    parts.push(output);
    return parts.join("");
  }
  function read(buffer, offset, isLE, mLen, nBytes) {
    var e, m;
    var eLen = nBytes * 8 - mLen - 1;
    var eMax = (1 << eLen) - 1;
    var eBias = eMax >> 1;
    var nBits = -7;
    var i = isLE ? nBytes - 1 : 0;
    var d = isLE ? -1 : 1;
    var s = buffer[offset + i];
    i += d;
    e = s & (1 << -nBits) - 1;
    s >>= -nBits;
    nBits += eLen;
    for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {
    }
    m = e & (1 << -nBits) - 1;
    e >>= -nBits;
    nBits += mLen;
    for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {
    }
    if (e === 0) {
      e = 1 - eBias;
    } else if (e === eMax) {
      return m ? NaN : (s ? -1 : 1) * Infinity;
    } else {
      m = m + Math.pow(2, mLen);
      e = e - eBias;
    }
    return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
  }
  function write(buffer, value, offset, isLE, mLen, nBytes) {
    var e, m, c;
    var eLen = nBytes * 8 - mLen - 1;
    var eMax = (1 << eLen) - 1;
    var eBias = eMax >> 1;
    var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
    var i = isLE ? 0 : nBytes - 1;
    var d = isLE ? 1 : -1;
    var s = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
    value = Math.abs(value);
    if (isNaN(value) || value === Infinity) {
      m = isNaN(value) ? 1 : 0;
      e = eMax;
    } else {
      e = Math.floor(Math.log(value) / Math.LN2);
      if (value * (c = Math.pow(2, -e)) < 1) {
        e--;
        c *= 2;
      }
      if (e + eBias >= 1) {
        value += rt / c;
      } else {
        value += rt * Math.pow(2, 1 - eBias);
      }
      if (value * c >= 2) {
        e++;
        c /= 2;
      }
      if (e + eBias >= eMax) {
        m = 0;
        e = eMax;
      } else if (e + eBias >= 1) {
        m = (value * c - 1) * Math.pow(2, mLen);
        e = e + eBias;
      } else {
        m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
        e = 0;
      }
    }
    for (; mLen >= 8; buffer[offset + i] = m & 255, i += d, m /= 256, mLen -= 8) {
    }
    e = e << mLen | m;
    eLen += mLen;
    for (; eLen > 0; buffer[offset + i] = e & 255, i += d, e /= 256, eLen -= 8) {
    }
    buffer[offset + i - d] |= s * 128;
  }
  var toString = {}.toString;
  var isArray$1 = Array.isArray || function(arr) {
    return toString.call(arr) == "[object Array]";
  };
  var INSPECT_MAX_BYTES = 50;
  Buffer2.TYPED_ARRAY_SUPPORT = global$1.TYPED_ARRAY_SUPPORT !== void 0 ? global$1.TYPED_ARRAY_SUPPORT : true;
  kMaxLength();
  function kMaxLength() {
    return Buffer2.TYPED_ARRAY_SUPPORT ? 2147483647 : 1073741823;
  }
  function createBuffer(that, length) {
    if (kMaxLength() < length) {
      throw new RangeError("Invalid typed array length");
    }
    if (Buffer2.TYPED_ARRAY_SUPPORT) {
      that = new Uint8Array(length);
      that.__proto__ = Buffer2.prototype;
    } else {
      if (that === null) {
        that = new Buffer2(length);
      }
      that.length = length;
    }
    return that;
  }
  function Buffer2(arg, encodingOrOffset, length) {
    if (!Buffer2.TYPED_ARRAY_SUPPORT && !(this instanceof Buffer2)) {
      return new Buffer2(arg, encodingOrOffset, length);
    }
    if (typeof arg === "number") {
      if (typeof encodingOrOffset === "string") {
        throw new Error(
          "If encoding is specified then the first argument must be a string"
        );
      }
      return allocUnsafe(this, arg);
    }
    return from(this, arg, encodingOrOffset, length);
  }
  Buffer2.poolSize = 8192;
  Buffer2._augment = function(arr) {
    arr.__proto__ = Buffer2.prototype;
    return arr;
  };
  function from(that, value, encodingOrOffset, length) {
    if (typeof value === "number") {
      throw new TypeError('"value" argument must not be a number');
    }
    if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
      return fromArrayBuffer(that, value, encodingOrOffset, length);
    }
    if (typeof value === "string") {
      return fromString(that, value, encodingOrOffset);
    }
    return fromObject(that, value);
  }
  Buffer2.from = function(value, encodingOrOffset, length) {
    return from(null, value, encodingOrOffset, length);
  };
  if (Buffer2.TYPED_ARRAY_SUPPORT) {
    Buffer2.prototype.__proto__ = Uint8Array.prototype;
    Buffer2.__proto__ = Uint8Array;
    if (typeof Symbol !== "undefined" && Symbol.species && Buffer2[Symbol.species] === Buffer2) ;
  }
  function assertSize(size) {
    if (typeof size !== "number") {
      throw new TypeError('"size" argument must be a number');
    } else if (size < 0) {
      throw new RangeError('"size" argument must not be negative');
    }
  }
  function alloc(that, size, fill2, encoding) {
    assertSize(size);
    if (size <= 0) {
      return createBuffer(that, size);
    }
    if (fill2 !== void 0) {
      return typeof encoding === "string" ? createBuffer(that, size).fill(fill2, encoding) : createBuffer(that, size).fill(fill2);
    }
    return createBuffer(that, size);
  }
  Buffer2.alloc = function(size, fill2, encoding) {
    return alloc(null, size, fill2, encoding);
  };
  function allocUnsafe(that, size) {
    assertSize(size);
    that = createBuffer(that, size < 0 ? 0 : checked(size) | 0);
    if (!Buffer2.TYPED_ARRAY_SUPPORT) {
      for (var i = 0; i < size; ++i) {
        that[i] = 0;
      }
    }
    return that;
  }
  Buffer2.allocUnsafe = function(size) {
    return allocUnsafe(null, size);
  };
  Buffer2.allocUnsafeSlow = function(size) {
    return allocUnsafe(null, size);
  };
  function fromString(that, string, encoding) {
    if (typeof encoding !== "string" || encoding === "") {
      encoding = "utf8";
    }
    if (!Buffer2.isEncoding(encoding)) {
      throw new TypeError('"encoding" must be a valid string encoding');
    }
    var length = byteLength(string, encoding) | 0;
    that = createBuffer(that, length);
    var actual = that.write(string, encoding);
    if (actual !== length) {
      that = that.slice(0, actual);
    }
    return that;
  }
  function fromArrayLike(that, array) {
    var length = array.length < 0 ? 0 : checked(array.length) | 0;
    that = createBuffer(that, length);
    for (var i = 0; i < length; i += 1) {
      that[i] = array[i] & 255;
    }
    return that;
  }
  function fromArrayBuffer(that, array, byteOffset, length) {
    array.byteLength;
    if (byteOffset < 0 || array.byteLength < byteOffset) {
      throw new RangeError("'offset' is out of bounds");
    }
    if (array.byteLength < byteOffset + (length || 0)) {
      throw new RangeError("'length' is out of bounds");
    }
    if (byteOffset === void 0 && length === void 0) {
      array = new Uint8Array(array);
    } else if (length === void 0) {
      array = new Uint8Array(array, byteOffset);
    } else {
      array = new Uint8Array(array, byteOffset, length);
    }
    if (Buffer2.TYPED_ARRAY_SUPPORT) {
      that = array;
      that.__proto__ = Buffer2.prototype;
    } else {
      that = fromArrayLike(that, array);
    }
    return that;
  }
  function fromObject(that, obj) {
    if (internalIsBuffer(obj)) {
      var len = checked(obj.length) | 0;
      that = createBuffer(that, len);
      if (that.length === 0) {
        return that;
      }
      obj.copy(that, 0, 0, len);
      return that;
    }
    if (obj) {
      if (typeof ArrayBuffer !== "undefined" && obj.buffer instanceof ArrayBuffer || "length" in obj) {
        if (typeof obj.length !== "number" || isnan(obj.length)) {
          return createBuffer(that, 0);
        }
        return fromArrayLike(that, obj);
      }
      if (obj.type === "Buffer" && isArray$1(obj.data)) {
        return fromArrayLike(that, obj.data);
      }
    }
    throw new TypeError("First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.");
  }
  function checked(length) {
    if (length >= kMaxLength()) {
      throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + kMaxLength().toString(16) + " bytes");
    }
    return length | 0;
  }
  Buffer2.isBuffer = isBuffer;
  function internalIsBuffer(b) {
    return !!(b != null && b._isBuffer);
  }
  Buffer2.compare = function compare(a, b) {
    if (!internalIsBuffer(a) || !internalIsBuffer(b)) {
      throw new TypeError("Arguments must be Buffers");
    }
    if (a === b) return 0;
    var x = a.length;
    var y = b.length;
    for (var i = 0, len = Math.min(x, y); i < len; ++i) {
      if (a[i] !== b[i]) {
        x = a[i];
        y = b[i];
        break;
      }
    }
    if (x < y) return -1;
    if (y < x) return 1;
    return 0;
  };
  Buffer2.isEncoding = function isEncoding(encoding) {
    switch (String(encoding).toLowerCase()) {
      case "hex":
      case "utf8":
      case "utf-8":
      case "ascii":
      case "latin1":
      case "binary":
      case "base64":
      case "ucs2":
      case "ucs-2":
      case "utf16le":
      case "utf-16le":
        return true;
      default:
        return false;
    }
  };
  Buffer2.concat = function concat(list, length) {
    if (!isArray$1(list)) {
      throw new TypeError('"list" argument must be an Array of Buffers');
    }
    if (list.length === 0) {
      return Buffer2.alloc(0);
    }
    var i;
    if (length === void 0) {
      length = 0;
      for (i = 0; i < list.length; ++i) {
        length += list[i].length;
      }
    }
    var buffer = Buffer2.allocUnsafe(length);
    var pos = 0;
    for (i = 0; i < list.length; ++i) {
      var buf = list[i];
      if (!internalIsBuffer(buf)) {
        throw new TypeError('"list" argument must be an Array of Buffers');
      }
      buf.copy(buffer, pos);
      pos += buf.length;
    }
    return buffer;
  };
  function byteLength(string, encoding) {
    if (internalIsBuffer(string)) {
      return string.length;
    }
    if (typeof ArrayBuffer !== "undefined" && typeof ArrayBuffer.isView === "function" && (ArrayBuffer.isView(string) || string instanceof ArrayBuffer)) {
      return string.byteLength;
    }
    if (typeof string !== "string") {
      string = "" + string;
    }
    var len = string.length;
    if (len === 0) return 0;
    var loweredCase = false;
    for (; ; ) {
      switch (encoding) {
        case "ascii":
        case "latin1":
        case "binary":
          return len;
        case "utf8":
        case "utf-8":
        case void 0:
          return utf8ToBytes(string).length;
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return len * 2;
        case "hex":
          return len >>> 1;
        case "base64":
          return base64ToBytes(string).length;
        default:
          if (loweredCase) return utf8ToBytes(string).length;
          encoding = ("" + encoding).toLowerCase();
          loweredCase = true;
      }
    }
  }
  Buffer2.byteLength = byteLength;
  function slowToString(encoding, start, end) {
    var loweredCase = false;
    if (start === void 0 || start < 0) {
      start = 0;
    }
    if (start > this.length) {
      return "";
    }
    if (end === void 0 || end > this.length) {
      end = this.length;
    }
    if (end <= 0) {
      return "";
    }
    end >>>= 0;
    start >>>= 0;
    if (end <= start) {
      return "";
    }
    if (!encoding) encoding = "utf8";
    while (true) {
      switch (encoding) {
        case "hex":
          return hexSlice(this, start, end);
        case "utf8":
        case "utf-8":
          return utf8Slice(this, start, end);
        case "ascii":
          return asciiSlice(this, start, end);
        case "latin1":
        case "binary":
          return latin1Slice(this, start, end);
        case "base64":
          return base64Slice(this, start, end);
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return utf16leSlice(this, start, end);
        default:
          if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
          encoding = (encoding + "").toLowerCase();
          loweredCase = true;
      }
    }
  }
  Buffer2.prototype._isBuffer = true;
  function swap(b, n, m) {
    var i = b[n];
    b[n] = b[m];
    b[m] = i;
  }
  Buffer2.prototype.swap16 = function swap16() {
    var len = this.length;
    if (len % 2 !== 0) {
      throw new RangeError("Buffer size must be a multiple of 16-bits");
    }
    for (var i = 0; i < len; i += 2) {
      swap(this, i, i + 1);
    }
    return this;
  };
  Buffer2.prototype.swap32 = function swap32() {
    var len = this.length;
    if (len % 4 !== 0) {
      throw new RangeError("Buffer size must be a multiple of 32-bits");
    }
    for (var i = 0; i < len; i += 4) {
      swap(this, i, i + 3);
      swap(this, i + 1, i + 2);
    }
    return this;
  };
  Buffer2.prototype.swap64 = function swap64() {
    var len = this.length;
    if (len % 8 !== 0) {
      throw new RangeError("Buffer size must be a multiple of 64-bits");
    }
    for (var i = 0; i < len; i += 8) {
      swap(this, i, i + 7);
      swap(this, i + 1, i + 6);
      swap(this, i + 2, i + 5);
      swap(this, i + 3, i + 4);
    }
    return this;
  };
  Buffer2.prototype.toString = function toString2() {
    var length = this.length | 0;
    if (length === 0) return "";
    if (arguments.length === 0) return utf8Slice(this, 0, length);
    return slowToString.apply(this, arguments);
  };
  Buffer2.prototype.equals = function equals(b) {
    if (!internalIsBuffer(b)) throw new TypeError("Argument must be a Buffer");
    if (this === b) return true;
    return Buffer2.compare(this, b) === 0;
  };
  Buffer2.prototype.inspect = function inspect() {
    var str = "";
    var max = INSPECT_MAX_BYTES;
    if (this.length > 0) {
      str = this.toString("hex", 0, max).match(/.{2}/g).join(" ");
      if (this.length > max) str += " ... ";
    }
    return "<Buffer " + str + ">";
  };
  Buffer2.prototype.compare = function compare2(target, start, end, thisStart, thisEnd) {
    if (!internalIsBuffer(target)) {
      throw new TypeError("Argument must be a Buffer");
    }
    if (start === void 0) {
      start = 0;
    }
    if (end === void 0) {
      end = target ? target.length : 0;
    }
    if (thisStart === void 0) {
      thisStart = 0;
    }
    if (thisEnd === void 0) {
      thisEnd = this.length;
    }
    if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
      throw new RangeError("out of range index");
    }
    if (thisStart >= thisEnd && start >= end) {
      return 0;
    }
    if (thisStart >= thisEnd) {
      return -1;
    }
    if (start >= end) {
      return 1;
    }
    start >>>= 0;
    end >>>= 0;
    thisStart >>>= 0;
    thisEnd >>>= 0;
    if (this === target) return 0;
    var x = thisEnd - thisStart;
    var y = end - start;
    var len = Math.min(x, y);
    var thisCopy = this.slice(thisStart, thisEnd);
    var targetCopy = target.slice(start, end);
    for (var i = 0; i < len; ++i) {
      if (thisCopy[i] !== targetCopy[i]) {
        x = thisCopy[i];
        y = targetCopy[i];
        break;
      }
    }
    if (x < y) return -1;
    if (y < x) return 1;
    return 0;
  };
  function bidirectionalIndexOf(buffer, val, byteOffset, encoding, dir) {
    if (buffer.length === 0) return -1;
    if (typeof byteOffset === "string") {
      encoding = byteOffset;
      byteOffset = 0;
    } else if (byteOffset > 2147483647) {
      byteOffset = 2147483647;
    } else if (byteOffset < -2147483648) {
      byteOffset = -2147483648;
    }
    byteOffset = +byteOffset;
    if (isNaN(byteOffset)) {
      byteOffset = dir ? 0 : buffer.length - 1;
    }
    if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
    if (byteOffset >= buffer.length) {
      if (dir) return -1;
      else byteOffset = buffer.length - 1;
    } else if (byteOffset < 0) {
      if (dir) byteOffset = 0;
      else return -1;
    }
    if (typeof val === "string") {
      val = Buffer2.from(val, encoding);
    }
    if (internalIsBuffer(val)) {
      if (val.length === 0) {
        return -1;
      }
      return arrayIndexOf(buffer, val, byteOffset, encoding, dir);
    } else if (typeof val === "number") {
      val = val & 255;
      if (Buffer2.TYPED_ARRAY_SUPPORT && typeof Uint8Array.prototype.indexOf === "function") {
        if (dir) {
          return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset);
        } else {
          return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset);
        }
      }
      return arrayIndexOf(buffer, [val], byteOffset, encoding, dir);
    }
    throw new TypeError("val must be string, number or Buffer");
  }
  function arrayIndexOf(arr, val, byteOffset, encoding, dir) {
    var indexSize = 1;
    var arrLength = arr.length;
    var valLength = val.length;
    if (encoding !== void 0) {
      encoding = String(encoding).toLowerCase();
      if (encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le") {
        if (arr.length < 2 || val.length < 2) {
          return -1;
        }
        indexSize = 2;
        arrLength /= 2;
        valLength /= 2;
        byteOffset /= 2;
      }
    }
    function read2(buf, i2) {
      if (indexSize === 1) {
        return buf[i2];
      } else {
        return buf.readUInt16BE(i2 * indexSize);
      }
    }
    var i;
    if (dir) {
      var foundIndex = -1;
      for (i = byteOffset; i < arrLength; i++) {
        if (read2(arr, i) === read2(val, foundIndex === -1 ? 0 : i - foundIndex)) {
          if (foundIndex === -1) foundIndex = i;
          if (i - foundIndex + 1 === valLength) return foundIndex * indexSize;
        } else {
          if (foundIndex !== -1) i -= i - foundIndex;
          foundIndex = -1;
        }
      }
    } else {
      if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
      for (i = byteOffset; i >= 0; i--) {
        var found = true;
        for (var j = 0; j < valLength; j++) {
          if (read2(arr, i + j) !== read2(val, j)) {
            found = false;
            break;
          }
        }
        if (found) return i;
      }
    }
    return -1;
  }
  Buffer2.prototype.includes = function includes(val, byteOffset, encoding) {
    return this.indexOf(val, byteOffset, encoding) !== -1;
  };
  Buffer2.prototype.indexOf = function indexOf(val, byteOffset, encoding) {
    return bidirectionalIndexOf(this, val, byteOffset, encoding, true);
  };
  Buffer2.prototype.lastIndexOf = function lastIndexOf(val, byteOffset, encoding) {
    return bidirectionalIndexOf(this, val, byteOffset, encoding, false);
  };
  function hexWrite(buf, string, offset, length) {
    offset = Number(offset) || 0;
    var remaining = buf.length - offset;
    if (!length) {
      length = remaining;
    } else {
      length = Number(length);
      if (length > remaining) {
        length = remaining;
      }
    }
    var strLen = string.length;
    if (strLen % 2 !== 0) throw new TypeError("Invalid hex string");
    if (length > strLen / 2) {
      length = strLen / 2;
    }
    for (var i = 0; i < length; ++i) {
      var parsed = parseInt(string.substr(i * 2, 2), 16);
      if (isNaN(parsed)) return i;
      buf[offset + i] = parsed;
    }
    return i;
  }
  function utf8Write(buf, string, offset, length) {
    return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
  }
  function asciiWrite(buf, string, offset, length) {
    return blitBuffer(asciiToBytes(string), buf, offset, length);
  }
  function latin1Write(buf, string, offset, length) {
    return asciiWrite(buf, string, offset, length);
  }
  function base64Write(buf, string, offset, length) {
    return blitBuffer(base64ToBytes(string), buf, offset, length);
  }
  function ucs2Write(buf, string, offset, length) {
    return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
  }
  Buffer2.prototype.write = function write2(string, offset, length, encoding) {
    if (offset === void 0) {
      encoding = "utf8";
      length = this.length;
      offset = 0;
    } else if (length === void 0 && typeof offset === "string") {
      encoding = offset;
      length = this.length;
      offset = 0;
    } else if (isFinite(offset)) {
      offset = offset | 0;
      if (isFinite(length)) {
        length = length | 0;
        if (encoding === void 0) encoding = "utf8";
      } else {
        encoding = length;
        length = void 0;
      }
    } else {
      throw new Error(
        "Buffer.write(string, encoding, offset[, length]) is no longer supported"
      );
    }
    var remaining = this.length - offset;
    if (length === void 0 || length > remaining) length = remaining;
    if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
      throw new RangeError("Attempt to write outside buffer bounds");
    }
    if (!encoding) encoding = "utf8";
    var loweredCase = false;
    for (; ; ) {
      switch (encoding) {
        case "hex":
          return hexWrite(this, string, offset, length);
        case "utf8":
        case "utf-8":
          return utf8Write(this, string, offset, length);
        case "ascii":
          return asciiWrite(this, string, offset, length);
        case "latin1":
        case "binary":
          return latin1Write(this, string, offset, length);
        case "base64":
          return base64Write(this, string, offset, length);
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return ucs2Write(this, string, offset, length);
        default:
          if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
          encoding = ("" + encoding).toLowerCase();
          loweredCase = true;
      }
    }
  };
  Buffer2.prototype.toJSON = function toJSON() {
    return {
      type: "Buffer",
      data: Array.prototype.slice.call(this._arr || this, 0)
    };
  };
  function base64Slice(buf, start, end) {
    if (start === 0 && end === buf.length) {
      return fromByteArray(buf);
    } else {
      return fromByteArray(buf.slice(start, end));
    }
  }
  function utf8Slice(buf, start, end) {
    end = Math.min(buf.length, end);
    var res = [];
    var i = start;
    while (i < end) {
      var firstByte = buf[i];
      var codePoint = null;
      var bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
      if (i + bytesPerSequence <= end) {
        var secondByte, thirdByte, fourthByte, tempCodePoint;
        switch (bytesPerSequence) {
          case 1:
            if (firstByte < 128) {
              codePoint = firstByte;
            }
            break;
          case 2:
            secondByte = buf[i + 1];
            if ((secondByte & 192) === 128) {
              tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
              if (tempCodePoint > 127) {
                codePoint = tempCodePoint;
              }
            }
            break;
          case 3:
            secondByte = buf[i + 1];
            thirdByte = buf[i + 2];
            if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
              tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
              if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                codePoint = tempCodePoint;
              }
            }
            break;
          case 4:
            secondByte = buf[i + 1];
            thirdByte = buf[i + 2];
            fourthByte = buf[i + 3];
            if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
              tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
              if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                codePoint = tempCodePoint;
              }
            }
        }
      }
      if (codePoint === null) {
        codePoint = 65533;
        bytesPerSequence = 1;
      } else if (codePoint > 65535) {
        codePoint -= 65536;
        res.push(codePoint >>> 10 & 1023 | 55296);
        codePoint = 56320 | codePoint & 1023;
      }
      res.push(codePoint);
      i += bytesPerSequence;
    }
    return decodeCodePointsArray(res);
  }
  var MAX_ARGUMENTS_LENGTH = 4096;
  function decodeCodePointsArray(codePoints) {
    var len = codePoints.length;
    if (len <= MAX_ARGUMENTS_LENGTH) {
      return String.fromCharCode.apply(String, codePoints);
    }
    var res = "";
    var i = 0;
    while (i < len) {
      res += String.fromCharCode.apply(
        String,
        codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
      );
    }
    return res;
  }
  function asciiSlice(buf, start, end) {
    var ret = "";
    end = Math.min(buf.length, end);
    for (var i = start; i < end; ++i) {
      ret += String.fromCharCode(buf[i] & 127);
    }
    return ret;
  }
  function latin1Slice(buf, start, end) {
    var ret = "";
    end = Math.min(buf.length, end);
    for (var i = start; i < end; ++i) {
      ret += String.fromCharCode(buf[i]);
    }
    return ret;
  }
  function hexSlice(buf, start, end) {
    var len = buf.length;
    if (!start || start < 0) start = 0;
    if (!end || end < 0 || end > len) end = len;
    var out = "";
    for (var i = start; i < end; ++i) {
      out += toHex(buf[i]);
    }
    return out;
  }
  function utf16leSlice(buf, start, end) {
    var bytes = buf.slice(start, end);
    var res = "";
    for (var i = 0; i < bytes.length; i += 2) {
      res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
    }
    return res;
  }
  Buffer2.prototype.slice = function slice(start, end) {
    var len = this.length;
    start = ~~start;
    end = end === void 0 ? len : ~~end;
    if (start < 0) {
      start += len;
      if (start < 0) start = 0;
    } else if (start > len) {
      start = len;
    }
    if (end < 0) {
      end += len;
      if (end < 0) end = 0;
    } else if (end > len) {
      end = len;
    }
    if (end < start) end = start;
    var newBuf;
    if (Buffer2.TYPED_ARRAY_SUPPORT) {
      newBuf = this.subarray(start, end);
      newBuf.__proto__ = Buffer2.prototype;
    } else {
      var sliceLen = end - start;
      newBuf = new Buffer2(sliceLen, void 0);
      for (var i = 0; i < sliceLen; ++i) {
        newBuf[i] = this[i + start];
      }
    }
    return newBuf;
  };
  function checkOffset(offset, ext, length) {
    if (offset % 1 !== 0 || offset < 0) throw new RangeError("offset is not uint");
    if (offset + ext > length) throw new RangeError("Trying to access beyond buffer length");
  }
  Buffer2.prototype.readUIntLE = function readUIntLE(offset, byteLength2, noAssert) {
    offset = offset | 0;
    byteLength2 = byteLength2 | 0;
    if (!noAssert) checkOffset(offset, byteLength2, this.length);
    var val = this[offset];
    var mul = 1;
    var i = 0;
    while (++i < byteLength2 && (mul *= 256)) {
      val += this[offset + i] * mul;
    }
    return val;
  };
  Buffer2.prototype.readUIntBE = function readUIntBE(offset, byteLength2, noAssert) {
    offset = offset | 0;
    byteLength2 = byteLength2 | 0;
    if (!noAssert) {
      checkOffset(offset, byteLength2, this.length);
    }
    var val = this[offset + --byteLength2];
    var mul = 1;
    while (byteLength2 > 0 && (mul *= 256)) {
      val += this[offset + --byteLength2] * mul;
    }
    return val;
  };
  Buffer2.prototype.readUInt8 = function readUInt8(offset, noAssert) {
    if (!noAssert) checkOffset(offset, 1, this.length);
    return this[offset];
  };
  Buffer2.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
    if (!noAssert) checkOffset(offset, 2, this.length);
    return this[offset] | this[offset + 1] << 8;
  };
  Buffer2.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
    if (!noAssert) checkOffset(offset, 2, this.length);
    return this[offset] << 8 | this[offset + 1];
  };
  Buffer2.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
    if (!noAssert) checkOffset(offset, 4, this.length);
    return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
  };
  Buffer2.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
    if (!noAssert) checkOffset(offset, 4, this.length);
    return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
  };
  Buffer2.prototype.readIntLE = function readIntLE(offset, byteLength2, noAssert) {
    offset = offset | 0;
    byteLength2 = byteLength2 | 0;
    if (!noAssert) checkOffset(offset, byteLength2, this.length);
    var val = this[offset];
    var mul = 1;
    var i = 0;
    while (++i < byteLength2 && (mul *= 256)) {
      val += this[offset + i] * mul;
    }
    mul *= 128;
    if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
    return val;
  };
  Buffer2.prototype.readIntBE = function readIntBE(offset, byteLength2, noAssert) {
    offset = offset | 0;
    byteLength2 = byteLength2 | 0;
    if (!noAssert) checkOffset(offset, byteLength2, this.length);
    var i = byteLength2;
    var mul = 1;
    var val = this[offset + --i];
    while (i > 0 && (mul *= 256)) {
      val += this[offset + --i] * mul;
    }
    mul *= 128;
    if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
    return val;
  };
  Buffer2.prototype.readInt8 = function readInt8(offset, noAssert) {
    if (!noAssert) checkOffset(offset, 1, this.length);
    if (!(this[offset] & 128)) return this[offset];
    return (255 - this[offset] + 1) * -1;
  };
  Buffer2.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
    if (!noAssert) checkOffset(offset, 2, this.length);
    var val = this[offset] | this[offset + 1] << 8;
    return val & 32768 ? val | 4294901760 : val;
  };
  Buffer2.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
    if (!noAssert) checkOffset(offset, 2, this.length);
    var val = this[offset + 1] | this[offset] << 8;
    return val & 32768 ? val | 4294901760 : val;
  };
  Buffer2.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
    if (!noAssert) checkOffset(offset, 4, this.length);
    return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
  };
  Buffer2.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
    if (!noAssert) checkOffset(offset, 4, this.length);
    return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
  };
  Buffer2.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
    if (!noAssert) checkOffset(offset, 4, this.length);
    return read(this, offset, true, 23, 4);
  };
  Buffer2.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
    if (!noAssert) checkOffset(offset, 4, this.length);
    return read(this, offset, false, 23, 4);
  };
  Buffer2.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
    if (!noAssert) checkOffset(offset, 8, this.length);
    return read(this, offset, true, 52, 8);
  };
  Buffer2.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
    if (!noAssert) checkOffset(offset, 8, this.length);
    return read(this, offset, false, 52, 8);
  };
  function checkInt(buf, value, offset, ext, max, min) {
    if (!internalIsBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance');
    if (value > max || value < min) throw new RangeError('"value" argument is out of bounds');
    if (offset + ext > buf.length) throw new RangeError("Index out of range");
  }
  Buffer2.prototype.writeUIntLE = function writeUIntLE(value, offset, byteLength2, noAssert) {
    value = +value;
    offset = offset | 0;
    byteLength2 = byteLength2 | 0;
    if (!noAssert) {
      var maxBytes = Math.pow(2, 8 * byteLength2) - 1;
      checkInt(this, value, offset, byteLength2, maxBytes, 0);
    }
    var mul = 1;
    var i = 0;
    this[offset] = value & 255;
    while (++i < byteLength2 && (mul *= 256)) {
      this[offset + i] = value / mul & 255;
    }
    return offset + byteLength2;
  };
  Buffer2.prototype.writeUIntBE = function writeUIntBE(value, offset, byteLength2, noAssert) {
    value = +value;
    offset = offset | 0;
    byteLength2 = byteLength2 | 0;
    if (!noAssert) {
      var maxBytes = Math.pow(2, 8 * byteLength2) - 1;
      checkInt(this, value, offset, byteLength2, maxBytes, 0);
    }
    var i = byteLength2 - 1;
    var mul = 1;
    this[offset + i] = value & 255;
    while (--i >= 0 && (mul *= 256)) {
      this[offset + i] = value / mul & 255;
    }
    return offset + byteLength2;
  };
  Buffer2.prototype.writeUInt8 = function writeUInt8(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert) checkInt(this, value, offset, 1, 255, 0);
    if (!Buffer2.TYPED_ARRAY_SUPPORT) value = Math.floor(value);
    this[offset] = value & 255;
    return offset + 1;
  };
  function objectWriteUInt16(buf, value, offset, littleEndian) {
    if (value < 0) value = 65535 + value + 1;
    for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; ++i) {
      buf[offset + i] = (value & 255 << 8 * (littleEndian ? i : 1 - i)) >>> (littleEndian ? i : 1 - i) * 8;
    }
  }
  Buffer2.prototype.writeUInt16LE = function writeUInt16LE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
    if (Buffer2.TYPED_ARRAY_SUPPORT) {
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
    } else {
      objectWriteUInt16(this, value, offset, true);
    }
    return offset + 2;
  };
  Buffer2.prototype.writeUInt16BE = function writeUInt16BE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
    if (Buffer2.TYPED_ARRAY_SUPPORT) {
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
    } else {
      objectWriteUInt16(this, value, offset, false);
    }
    return offset + 2;
  };
  function objectWriteUInt32(buf, value, offset, littleEndian) {
    if (value < 0) value = 4294967295 + value + 1;
    for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; ++i) {
      buf[offset + i] = value >>> (littleEndian ? i : 3 - i) * 8 & 255;
    }
  }
  Buffer2.prototype.writeUInt32LE = function writeUInt32LE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
    if (Buffer2.TYPED_ARRAY_SUPPORT) {
      this[offset + 3] = value >>> 24;
      this[offset + 2] = value >>> 16;
      this[offset + 1] = value >>> 8;
      this[offset] = value & 255;
    } else {
      objectWriteUInt32(this, value, offset, true);
    }
    return offset + 4;
  };
  Buffer2.prototype.writeUInt32BE = function writeUInt32BE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
    if (Buffer2.TYPED_ARRAY_SUPPORT) {
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
    } else {
      objectWriteUInt32(this, value, offset, false);
    }
    return offset + 4;
  };
  Buffer2.prototype.writeIntLE = function writeIntLE(value, offset, byteLength2, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert) {
      var limit = Math.pow(2, 8 * byteLength2 - 1);
      checkInt(this, value, offset, byteLength2, limit - 1, -limit);
    }
    var i = 0;
    var mul = 1;
    var sub = 0;
    this[offset] = value & 255;
    while (++i < byteLength2 && (mul *= 256)) {
      if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
        sub = 1;
      }
      this[offset + i] = (value / mul >> 0) - sub & 255;
    }
    return offset + byteLength2;
  };
  Buffer2.prototype.writeIntBE = function writeIntBE(value, offset, byteLength2, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert) {
      var limit = Math.pow(2, 8 * byteLength2 - 1);
      checkInt(this, value, offset, byteLength2, limit - 1, -limit);
    }
    var i = byteLength2 - 1;
    var mul = 1;
    var sub = 0;
    this[offset + i] = value & 255;
    while (--i >= 0 && (mul *= 256)) {
      if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
        sub = 1;
      }
      this[offset + i] = (value / mul >> 0) - sub & 255;
    }
    return offset + byteLength2;
  };
  Buffer2.prototype.writeInt8 = function writeInt8(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert) checkInt(this, value, offset, 1, 127, -128);
    if (!Buffer2.TYPED_ARRAY_SUPPORT) value = Math.floor(value);
    if (value < 0) value = 255 + value + 1;
    this[offset] = value & 255;
    return offset + 1;
  };
  Buffer2.prototype.writeInt16LE = function writeInt16LE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
    if (Buffer2.TYPED_ARRAY_SUPPORT) {
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
    } else {
      objectWriteUInt16(this, value, offset, true);
    }
    return offset + 2;
  };
  Buffer2.prototype.writeInt16BE = function writeInt16BE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
    if (Buffer2.TYPED_ARRAY_SUPPORT) {
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
    } else {
      objectWriteUInt16(this, value, offset, false);
    }
    return offset + 2;
  };
  Buffer2.prototype.writeInt32LE = function writeInt32LE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
    if (Buffer2.TYPED_ARRAY_SUPPORT) {
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      this[offset + 2] = value >>> 16;
      this[offset + 3] = value >>> 24;
    } else {
      objectWriteUInt32(this, value, offset, true);
    }
    return offset + 4;
  };
  Buffer2.prototype.writeInt32BE = function writeInt32BE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
    if (value < 0) value = 4294967295 + value + 1;
    if (Buffer2.TYPED_ARRAY_SUPPORT) {
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
    } else {
      objectWriteUInt32(this, value, offset, false);
    }
    return offset + 4;
  };
  function checkIEEE754(buf, value, offset, ext, max, min) {
    if (offset + ext > buf.length) throw new RangeError("Index out of range");
    if (offset < 0) throw new RangeError("Index out of range");
  }
  function writeFloat(buf, value, offset, littleEndian, noAssert) {
    if (!noAssert) {
      checkIEEE754(buf, value, offset, 4);
    }
    write(buf, value, offset, littleEndian, 23, 4);
    return offset + 4;
  }
  Buffer2.prototype.writeFloatLE = function writeFloatLE(value, offset, noAssert) {
    return writeFloat(this, value, offset, true, noAssert);
  };
  Buffer2.prototype.writeFloatBE = function writeFloatBE(value, offset, noAssert) {
    return writeFloat(this, value, offset, false, noAssert);
  };
  function writeDouble(buf, value, offset, littleEndian, noAssert) {
    if (!noAssert) {
      checkIEEE754(buf, value, offset, 8);
    }
    write(buf, value, offset, littleEndian, 52, 8);
    return offset + 8;
  }
  Buffer2.prototype.writeDoubleLE = function writeDoubleLE(value, offset, noAssert) {
    return writeDouble(this, value, offset, true, noAssert);
  };
  Buffer2.prototype.writeDoubleBE = function writeDoubleBE(value, offset, noAssert) {
    return writeDouble(this, value, offset, false, noAssert);
  };
  Buffer2.prototype.copy = function copy(target, targetStart, start, end) {
    if (!start) start = 0;
    if (!end && end !== 0) end = this.length;
    if (targetStart >= target.length) targetStart = target.length;
    if (!targetStart) targetStart = 0;
    if (end > 0 && end < start) end = start;
    if (end === start) return 0;
    if (target.length === 0 || this.length === 0) return 0;
    if (targetStart < 0) {
      throw new RangeError("targetStart out of bounds");
    }
    if (start < 0 || start >= this.length) throw new RangeError("sourceStart out of bounds");
    if (end < 0) throw new RangeError("sourceEnd out of bounds");
    if (end > this.length) end = this.length;
    if (target.length - targetStart < end - start) {
      end = target.length - targetStart + start;
    }
    var len = end - start;
    var i;
    if (this === target && start < targetStart && targetStart < end) {
      for (i = len - 1; i >= 0; --i) {
        target[i + targetStart] = this[i + start];
      }
    } else if (len < 1e3 || !Buffer2.TYPED_ARRAY_SUPPORT) {
      for (i = 0; i < len; ++i) {
        target[i + targetStart] = this[i + start];
      }
    } else {
      Uint8Array.prototype.set.call(
        target,
        this.subarray(start, start + len),
        targetStart
      );
    }
    return len;
  };
  Buffer2.prototype.fill = function fill(val, start, end, encoding) {
    if (typeof val === "string") {
      if (typeof start === "string") {
        encoding = start;
        start = 0;
        end = this.length;
      } else if (typeof end === "string") {
        encoding = end;
        end = this.length;
      }
      if (val.length === 1) {
        var code = val.charCodeAt(0);
        if (code < 256) {
          val = code;
        }
      }
      if (encoding !== void 0 && typeof encoding !== "string") {
        throw new TypeError("encoding must be a string");
      }
      if (typeof encoding === "string" && !Buffer2.isEncoding(encoding)) {
        throw new TypeError("Unknown encoding: " + encoding);
      }
    } else if (typeof val === "number") {
      val = val & 255;
    }
    if (start < 0 || this.length < start || this.length < end) {
      throw new RangeError("Out of range index");
    }
    if (end <= start) {
      return this;
    }
    start = start >>> 0;
    end = end === void 0 ? this.length : end >>> 0;
    if (!val) val = 0;
    var i;
    if (typeof val === "number") {
      for (i = start; i < end; ++i) {
        this[i] = val;
      }
    } else {
      var bytes = internalIsBuffer(val) ? val : utf8ToBytes(new Buffer2(val, encoding).toString());
      var len = bytes.length;
      for (i = 0; i < end - start; ++i) {
        this[i + start] = bytes[i % len];
      }
    }
    return this;
  };
  var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g;
  function base64clean(str) {
    str = stringtrim(str).replace(INVALID_BASE64_RE, "");
    if (str.length < 2) return "";
    while (str.length % 4 !== 0) {
      str = str + "=";
    }
    return str;
  }
  function stringtrim(str) {
    if (str.trim) return str.trim();
    return str.replace(/^\s+|\s+$/g, "");
  }
  function toHex(n) {
    if (n < 16) return "0" + n.toString(16);
    return n.toString(16);
  }
  function utf8ToBytes(string, units) {
    units = units || Infinity;
    var codePoint;
    var length = string.length;
    var leadSurrogate = null;
    var bytes = [];
    for (var i = 0; i < length; ++i) {
      codePoint = string.charCodeAt(i);
      if (codePoint > 55295 && codePoint < 57344) {
        if (!leadSurrogate) {
          if (codePoint > 56319) {
            if ((units -= 3) > -1) bytes.push(239, 191, 189);
            continue;
          } else if (i + 1 === length) {
            if ((units -= 3) > -1) bytes.push(239, 191, 189);
            continue;
          }
          leadSurrogate = codePoint;
          continue;
        }
        if (codePoint < 56320) {
          if ((units -= 3) > -1) bytes.push(239, 191, 189);
          leadSurrogate = codePoint;
          continue;
        }
        codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
      } else if (leadSurrogate) {
        if ((units -= 3) > -1) bytes.push(239, 191, 189);
      }
      leadSurrogate = null;
      if (codePoint < 128) {
        if ((units -= 1) < 0) break;
        bytes.push(codePoint);
      } else if (codePoint < 2048) {
        if ((units -= 2) < 0) break;
        bytes.push(
          codePoint >> 6 | 192,
          codePoint & 63 | 128
        );
      } else if (codePoint < 65536) {
        if ((units -= 3) < 0) break;
        bytes.push(
          codePoint >> 12 | 224,
          codePoint >> 6 & 63 | 128,
          codePoint & 63 | 128
        );
      } else if (codePoint < 1114112) {
        if ((units -= 4) < 0) break;
        bytes.push(
          codePoint >> 18 | 240,
          codePoint >> 12 & 63 | 128,
          codePoint >> 6 & 63 | 128,
          codePoint & 63 | 128
        );
      } else {
        throw new Error("Invalid code point");
      }
    }
    return bytes;
  }
  function asciiToBytes(str) {
    var byteArray = [];
    for (var i = 0; i < str.length; ++i) {
      byteArray.push(str.charCodeAt(i) & 255);
    }
    return byteArray;
  }
  function utf16leToBytes(str, units) {
    var c, hi, lo;
    var byteArray = [];
    for (var i = 0; i < str.length; ++i) {
      if ((units -= 2) < 0) break;
      c = str.charCodeAt(i);
      hi = c >> 8;
      lo = c % 256;
      byteArray.push(lo);
      byteArray.push(hi);
    }
    return byteArray;
  }
  function base64ToBytes(str) {
    return toByteArray(base64clean(str));
  }
  function blitBuffer(src, dst, offset, length) {
    for (var i = 0; i < length; ++i) {
      if (i + offset >= dst.length || i >= src.length) break;
      dst[i + offset] = src[i];
    }
    return i;
  }
  function isnan(val) {
    return val !== val;
  }
  function isBuffer(obj) {
    return obj != null && (!!obj._isBuffer || isFastBuffer(obj) || isSlowBuffer(obj));
  }
  function isFastBuffer(obj) {
    return !!obj.constructor && typeof obj.constructor.isBuffer === "function" && obj.constructor.isBuffer(obj);
  }
  function isSlowBuffer(obj) {
    return typeof obj.readFloatLE === "function" && typeof obj.slice === "function" && isFastBuffer(obj.slice(0, 0));
  }
  var domain;
  function EventHandlers() {
  }
  EventHandlers.prototype = /* @__PURE__ */ Object.create(null);
  function EventEmitter() {
    EventEmitter.init.call(this);
  }
  EventEmitter.EventEmitter = EventEmitter;
  EventEmitter.usingDomains = false;
  EventEmitter.prototype.domain = void 0;
  EventEmitter.prototype._events = void 0;
  EventEmitter.prototype._maxListeners = void 0;
  EventEmitter.defaultMaxListeners = 10;
  EventEmitter.init = function() {
    this.domain = null;
    if (EventEmitter.usingDomains) {
      if (domain.active) ;
    }
    if (!this._events || this._events === Object.getPrototypeOf(this)._events) {
      this._events = new EventHandlers();
      this._eventsCount = 0;
    }
    this._maxListeners = this._maxListeners || void 0;
  };
  EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
    if (typeof n !== "number" || n < 0 || isNaN(n))
      throw new TypeError('"n" argument must be a positive number');
    this._maxListeners = n;
    return this;
  };
  function $getMaxListeners(that) {
    if (that._maxListeners === void 0)
      return EventEmitter.defaultMaxListeners;
    return that._maxListeners;
  }
  EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
    return $getMaxListeners(this);
  };
  function emitNone(handler, isFn, self2) {
    if (isFn)
      handler.call(self2);
    else {
      var len = handler.length;
      var listeners2 = arrayClone(handler, len);
      for (var i = 0; i < len; ++i)
        listeners2[i].call(self2);
    }
  }
  function emitOne(handler, isFn, self2, arg1) {
    if (isFn)
      handler.call(self2, arg1);
    else {
      var len = handler.length;
      var listeners2 = arrayClone(handler, len);
      for (var i = 0; i < len; ++i)
        listeners2[i].call(self2, arg1);
    }
  }
  function emitTwo(handler, isFn, self2, arg1, arg2) {
    if (isFn)
      handler.call(self2, arg1, arg2);
    else {
      var len = handler.length;
      var listeners2 = arrayClone(handler, len);
      for (var i = 0; i < len; ++i)
        listeners2[i].call(self2, arg1, arg2);
    }
  }
  function emitThree(handler, isFn, self2, arg1, arg2, arg3) {
    if (isFn)
      handler.call(self2, arg1, arg2, arg3);
    else {
      var len = handler.length;
      var listeners2 = arrayClone(handler, len);
      for (var i = 0; i < len; ++i)
        listeners2[i].call(self2, arg1, arg2, arg3);
    }
  }
  function emitMany(handler, isFn, self2, args) {
    if (isFn)
      handler.apply(self2, args);
    else {
      var len = handler.length;
      var listeners2 = arrayClone(handler, len);
      for (var i = 0; i < len; ++i)
        listeners2[i].apply(self2, args);
    }
  }
  EventEmitter.prototype.emit = function emit(type) {
    var er, handler, len, args, i, events, domain2;
    var doError = type === "error";
    events = this._events;
    if (events)
      doError = doError && events.error == null;
    else if (!doError)
      return false;
    domain2 = this.domain;
    if (doError) {
      er = arguments[1];
      if (domain2) {
        if (!er)
          er = new Error('Uncaught, unspecified "error" event');
        er.domainEmitter = this;
        er.domain = domain2;
        er.domainThrown = false;
        domain2.emit("error", er);
      } else if (er instanceof Error) {
        throw er;
      } else {
        var err = new Error('Uncaught, unspecified "error" event. (' + er + ")");
        err.context = er;
        throw err;
      }
      return false;
    }
    handler = events[type];
    if (!handler)
      return false;
    var isFn = typeof handler === "function";
    len = arguments.length;
    switch (len) {
      // fast cases
      case 1:
        emitNone(handler, isFn, this);
        break;
      case 2:
        emitOne(handler, isFn, this, arguments[1]);
        break;
      case 3:
        emitTwo(handler, isFn, this, arguments[1], arguments[2]);
        break;
      case 4:
        emitThree(handler, isFn, this, arguments[1], arguments[2], arguments[3]);
        break;
      // slower
      default:
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        emitMany(handler, isFn, this, args);
    }
    return true;
  };
  function _addListener(target, type, listener, prepend) {
    var m;
    var events;
    var existing;
    if (typeof listener !== "function")
      throw new TypeError('"listener" argument must be a function');
    events = target._events;
    if (!events) {
      events = target._events = new EventHandlers();
      target._eventsCount = 0;
    } else {
      if (events.newListener) {
        target.emit(
          "newListener",
          type,
          listener.listener ? listener.listener : listener
        );
        events = target._events;
      }
      existing = events[type];
    }
    if (!existing) {
      existing = events[type] = listener;
      ++target._eventsCount;
    } else {
      if (typeof existing === "function") {
        existing = events[type] = prepend ? [listener, existing] : [existing, listener];
      } else {
        if (prepend) {
          existing.unshift(listener);
        } else {
          existing.push(listener);
        }
      }
      if (!existing.warned) {
        m = $getMaxListeners(target);
        if (m && m > 0 && existing.length > m) {
          existing.warned = true;
          var w = new Error("Possible EventEmitter memory leak detected. " + existing.length + " " + type + " listeners added. Use emitter.setMaxListeners() to increase limit");
          w.name = "MaxListenersExceededWarning";
          w.emitter = target;
          w.type = type;
          w.count = existing.length;
          emitWarning(w);
        }
      }
    }
    return target;
  }
  function emitWarning(e) {
    typeof console.warn === "function" ? console.warn(e) : console.log(e);
  }
  EventEmitter.prototype.addListener = function addListener(type, listener) {
    return _addListener(this, type, listener, false);
  };
  EventEmitter.prototype.on = EventEmitter.prototype.addListener;
  EventEmitter.prototype.prependListener = function prependListener(type, listener) {
    return _addListener(this, type, listener, true);
  };
  function _onceWrap(target, type, listener) {
    var fired = false;
    function g() {
      target.removeListener(type, g);
      if (!fired) {
        fired = true;
        listener.apply(target, arguments);
      }
    }
    g.listener = listener;
    return g;
  }
  EventEmitter.prototype.once = function once(type, listener) {
    if (typeof listener !== "function")
      throw new TypeError('"listener" argument must be a function');
    this.on(type, _onceWrap(this, type, listener));
    return this;
  };
  EventEmitter.prototype.prependOnceListener = function prependOnceListener(type, listener) {
    if (typeof listener !== "function")
      throw new TypeError('"listener" argument must be a function');
    this.prependListener(type, _onceWrap(this, type, listener));
    return this;
  };
  EventEmitter.prototype.removeListener = function removeListener(type, listener) {
    var list, events, position, i, originalListener;
    if (typeof listener !== "function")
      throw new TypeError('"listener" argument must be a function');
    events = this._events;
    if (!events)
      return this;
    list = events[type];
    if (!list)
      return this;
    if (list === listener || list.listener && list.listener === listener) {
      if (--this._eventsCount === 0)
        this._events = new EventHandlers();
      else {
        delete events[type];
        if (events.removeListener)
          this.emit("removeListener", type, list.listener || listener);
      }
    } else if (typeof list !== "function") {
      position = -1;
      for (i = list.length; i-- > 0; ) {
        if (list[i] === listener || list[i].listener && list[i].listener === listener) {
          originalListener = list[i].listener;
          position = i;
          break;
        }
      }
      if (position < 0)
        return this;
      if (list.length === 1) {
        list[0] = void 0;
        if (--this._eventsCount === 0) {
          this._events = new EventHandlers();
          return this;
        } else {
          delete events[type];
        }
      } else {
        spliceOne(list, position);
      }
      if (events.removeListener)
        this.emit("removeListener", type, originalListener || listener);
    }
    return this;
  };
  EventEmitter.prototype.removeAllListeners = function removeAllListeners(type) {
    var listeners2, events;
    events = this._events;
    if (!events)
      return this;
    if (!events.removeListener) {
      if (arguments.length === 0) {
        this._events = new EventHandlers();
        this._eventsCount = 0;
      } else if (events[type]) {
        if (--this._eventsCount === 0)
          this._events = new EventHandlers();
        else
          delete events[type];
      }
      return this;
    }
    if (arguments.length === 0) {
      var keys2 = Object.keys(events);
      for (var i = 0, key; i < keys2.length; ++i) {
        key = keys2[i];
        if (key === "removeListener") continue;
        this.removeAllListeners(key);
      }
      this.removeAllListeners("removeListener");
      this._events = new EventHandlers();
      this._eventsCount = 0;
      return this;
    }
    listeners2 = events[type];
    if (typeof listeners2 === "function") {
      this.removeListener(type, listeners2);
    } else if (listeners2) {
      do {
        this.removeListener(type, listeners2[listeners2.length - 1]);
      } while (listeners2[0]);
    }
    return this;
  };
  EventEmitter.prototype.listeners = function listeners(type) {
    var evlistener;
    var ret;
    var events = this._events;
    if (!events)
      ret = [];
    else {
      evlistener = events[type];
      if (!evlistener)
        ret = [];
      else if (typeof evlistener === "function")
        ret = [evlistener.listener || evlistener];
      else
        ret = unwrapListeners(evlistener);
    }
    return ret;
  };
  EventEmitter.listenerCount = function(emitter, type) {
    if (typeof emitter.listenerCount === "function") {
      return emitter.listenerCount(type);
    } else {
      return listenerCount$1.call(emitter, type);
    }
  };
  EventEmitter.prototype.listenerCount = listenerCount$1;
  function listenerCount$1(type) {
    var events = this._events;
    if (events) {
      var evlistener = events[type];
      if (typeof evlistener === "function") {
        return 1;
      } else if (evlistener) {
        return evlistener.length;
      }
    }
    return 0;
  }
  EventEmitter.prototype.eventNames = function eventNames() {
    return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
  };
  function spliceOne(list, index) {
    for (var i = index, k = i + 1, n = list.length; k < n; i += 1, k += 1)
      list[i] = list[k];
    list.pop();
  }
  function arrayClone(arr, i) {
    var copy2 = new Array(i);
    while (i--)
      copy2[i] = arr[i];
    return copy2;
  }
  function unwrapListeners(arr) {
    var ret = new Array(arr.length);
    for (var i = 0; i < ret.length; ++i) {
      ret[i] = arr[i].listener || arr[i];
    }
    return ret;
  }
  function defaultSetTimout() {
    throw new Error("setTimeout has not been defined");
  }
  function defaultClearTimeout() {
    throw new Error("clearTimeout has not been defined");
  }
  var cachedSetTimeout = defaultSetTimout;
  var cachedClearTimeout = defaultClearTimeout;
  if (typeof global$1.setTimeout === "function") {
    cachedSetTimeout = setTimeout;
  }
  if (typeof global$1.clearTimeout === "function") {
    cachedClearTimeout = clearTimeout;
  }
  function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
      return setTimeout(fun, 0);
    }
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
      cachedSetTimeout = setTimeout;
      return setTimeout(fun, 0);
    }
    try {
      return cachedSetTimeout(fun, 0);
    } catch (e) {
      try {
        return cachedSetTimeout.call(null, fun, 0);
      } catch (e2) {
        return cachedSetTimeout.call(this, fun, 0);
      }
    }
  }
  function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
      return clearTimeout(marker);
    }
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
      cachedClearTimeout = clearTimeout;
      return clearTimeout(marker);
    }
    try {
      return cachedClearTimeout(marker);
    } catch (e) {
      try {
        return cachedClearTimeout.call(null, marker);
      } catch (e2) {
        return cachedClearTimeout.call(this, marker);
      }
    }
  }
  var queue = [];
  var draining = false;
  var currentQueue;
  var queueIndex = -1;
  function cleanUpNextTick() {
    if (!draining || !currentQueue) {
      return;
    }
    draining = false;
    if (currentQueue.length) {
      queue = currentQueue.concat(queue);
    } else {
      queueIndex = -1;
    }
    if (queue.length) {
      drainQueue();
    }
  }
  function drainQueue() {
    if (draining) {
      return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;
    var len = queue.length;
    while (len) {
      currentQueue = queue;
      queue = [];
      while (++queueIndex < len) {
        if (currentQueue) {
          currentQueue[queueIndex].run();
        }
      }
      queueIndex = -1;
      len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
  }
  function nextTick(fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
      for (var i = 1; i < arguments.length; i++) {
        args[i - 1] = arguments[i];
      }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
      runTimeout(drainQueue);
    }
  }
  function Item(fun, array) {
    this.fun = fun;
    this.array = array;
  }
  Item.prototype.run = function() {
    this.fun.apply(null, this.array);
  };
  var title = "browser";
  var platform = "browser";
  var browser = true;
  var env = {};
  var argv = [];
  var version = "";
  var versions = {};
  var release = {};
  var config = {};
  function noop() {
  }
  var on = noop;
  var addListener2 = noop;
  var once2 = noop;
  var off = noop;
  var removeListener2 = noop;
  var removeAllListeners2 = noop;
  var emit2 = noop;
  function binding(name) {
    throw new Error("process.binding is not supported");
  }
  function cwd() {
    return "/";
  }
  function chdir(dir) {
    throw new Error("process.chdir is not supported");
  }
  function umask() {
    return 0;
  }
  var performance = global$1.performance || {};
  var performanceNow = performance.now || performance.mozNow || performance.msNow || performance.oNow || performance.webkitNow || function() {
    return (/* @__PURE__ */ new Date()).getTime();
  };
  function hrtime(previousTimestamp) {
    var clocktime = performanceNow.call(performance) * 1e-3;
    var seconds = Math.floor(clocktime);
    var nanoseconds = Math.floor(clocktime % 1 * 1e9);
    if (previousTimestamp) {
      seconds = seconds - previousTimestamp[0];
      nanoseconds = nanoseconds - previousTimestamp[1];
      if (nanoseconds < 0) {
        seconds--;
        nanoseconds += 1e9;
      }
    }
    return [seconds, nanoseconds];
  }
  var startTime = /* @__PURE__ */ new Date();
  function uptime() {
    var currentTime = /* @__PURE__ */ new Date();
    var dif = currentTime - startTime;
    return dif / 1e3;
  }
  var process = {
    nextTick,
    title,
    browser,
    env,
    argv,
    version,
    versions,
    on,
    addListener: addListener2,
    once: once2,
    off,
    removeListener: removeListener2,
    removeAllListeners: removeAllListeners2,
    emit: emit2,
    binding,
    cwd,
    chdir,
    umask,
    hrtime,
    platform,
    release,
    config,
    uptime
  };
  var inherits;
  if (typeof Object.create === "function") {
    inherits = function inherits2(ctor, superCtor) {
      ctor.super_ = superCtor;
      ctor.prototype = Object.create(superCtor.prototype, {
        constructor: {
          value: ctor,
          enumerable: false,
          writable: true,
          configurable: true
        }
      });
    };
  } else {
    inherits = function inherits2(ctor, superCtor) {
      ctor.super_ = superCtor;
      var TempCtor = function() {
      };
      TempCtor.prototype = superCtor.prototype;
      ctor.prototype = new TempCtor();
      ctor.prototype.constructor = ctor;
    };
  }
  var inherits$1 = inherits;
  var formatRegExp = /%[sdj%]/g;
  function format(f) {
    if (!isString(f)) {
      var objects = [];
      for (var i = 0; i < arguments.length; i++) {
        objects.push(inspect2(arguments[i]));
      }
      return objects.join(" ");
    }
    var i = 1;
    var args = arguments;
    var len = args.length;
    var str = String(f).replace(formatRegExp, function(x2) {
      if (x2 === "%%") return "%";
      if (i >= len) return x2;
      switch (x2) {
        case "%s":
          return String(args[i++]);
        case "%d":
          return Number(args[i++]);
        case "%j":
          try {
            return JSON.stringify(args[i++]);
          } catch (_) {
            return "[Circular]";
          }
        default:
          return x2;
      }
    });
    for (var x = args[i]; i < len; x = args[++i]) {
      if (isNull(x) || !isObject(x)) {
        str += " " + x;
      } else {
        str += " " + inspect2(x);
      }
    }
    return str;
  }
  function deprecate(fn, msg) {
    if (isUndefined(global$1.process)) {
      return function() {
        return deprecate(fn, msg).apply(this, arguments);
      };
    }
    if (process.noDeprecation === true) {
      return fn;
    }
    var warned = false;
    function deprecated() {
      if (!warned) {
        if (process.throwDeprecation) {
          throw new Error(msg);
        } else if (process.traceDeprecation) {
          console.trace(msg);
        } else {
          console.error(msg);
        }
        warned = true;
      }
      return fn.apply(this, arguments);
    }
    return deprecated;
  }
  var debugs = {};
  var debugEnviron;
  function debuglog(set) {
    if (isUndefined(debugEnviron))
      debugEnviron = process.env.NODE_DEBUG || "";
    set = set.toUpperCase();
    if (!debugs[set]) {
      if (new RegExp("\\b" + set + "\\b", "i").test(debugEnviron)) {
        var pid = 0;
        debugs[set] = function() {
          var msg = format.apply(null, arguments);
          console.error("%s %d: %s", set, pid, msg);
        };
      } else {
        debugs[set] = function() {
        };
      }
    }
    return debugs[set];
  }
  function inspect2(obj, opts) {
    var ctx = {
      seen: [],
      stylize: stylizeNoColor
    };
    if (arguments.length >= 3) ctx.depth = arguments[2];
    if (arguments.length >= 4) ctx.colors = arguments[3];
    if (isBoolean(opts)) {
      ctx.showHidden = opts;
    } else if (opts) {
      _extend(ctx, opts);
    }
    if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
    if (isUndefined(ctx.depth)) ctx.depth = 2;
    if (isUndefined(ctx.colors)) ctx.colors = false;
    if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
    if (ctx.colors) ctx.stylize = stylizeWithColor;
    return formatValue(ctx, obj, ctx.depth);
  }
  inspect2.colors = {
    "bold": [1, 22],
    "italic": [3, 23],
    "underline": [4, 24],
    "inverse": [7, 27],
    "white": [37, 39],
    "grey": [90, 39],
    "black": [30, 39],
    "blue": [34, 39],
    "cyan": [36, 39],
    "green": [32, 39],
    "magenta": [35, 39],
    "red": [31, 39],
    "yellow": [33, 39]
  };
  inspect2.styles = {
    "special": "cyan",
    "number": "yellow",
    "boolean": "yellow",
    "undefined": "grey",
    "null": "bold",
    "string": "green",
    "date": "magenta",
    // "name": intentionally not styling
    "regexp": "red"
  };
  function stylizeWithColor(str, styleType) {
    var style = inspect2.styles[styleType];
    if (style) {
      return "\x1B[" + inspect2.colors[style][0] + "m" + str + "\x1B[" + inspect2.colors[style][1] + "m";
    } else {
      return str;
    }
  }
  function stylizeNoColor(str, styleType) {
    return str;
  }
  function arrayToHash(array) {
    var hash = {};
    array.forEach(function(val, idx) {
      hash[val] = true;
    });
    return hash;
  }
  function formatValue(ctx, value, recurseTimes) {
    if (ctx.customInspect && value && isFunction(value.inspect) && // Filter out the util module, it's inspect function is special
    value.inspect !== inspect2 && // Also filter out any prototype objects using the circular check.
    !(value.constructor && value.constructor.prototype === value)) {
      var ret = value.inspect(recurseTimes, ctx);
      if (!isString(ret)) {
        ret = formatValue(ctx, ret, recurseTimes);
      }
      return ret;
    }
    var primitive = formatPrimitive(ctx, value);
    if (primitive) {
      return primitive;
    }
    var keys2 = Object.keys(value);
    var visibleKeys = arrayToHash(keys2);
    if (ctx.showHidden) {
      keys2 = Object.getOwnPropertyNames(value);
    }
    if (isError(value) && (keys2.indexOf("message") >= 0 || keys2.indexOf("description") >= 0)) {
      return formatError(value);
    }
    if (keys2.length === 0) {
      if (isFunction(value)) {
        var name = value.name ? ": " + value.name : "";
        return ctx.stylize("[Function" + name + "]", "special");
      }
      if (isRegExp(value)) {
        return ctx.stylize(RegExp.prototype.toString.call(value), "regexp");
      }
      if (isDate(value)) {
        return ctx.stylize(Date.prototype.toString.call(value), "date");
      }
      if (isError(value)) {
        return formatError(value);
      }
    }
    var base = "", array = false, braces = ["{", "}"];
    if (isArray(value)) {
      array = true;
      braces = ["[", "]"];
    }
    if (isFunction(value)) {
      var n = value.name ? ": " + value.name : "";
      base = " [Function" + n + "]";
    }
    if (isRegExp(value)) {
      base = " " + RegExp.prototype.toString.call(value);
    }
    if (isDate(value)) {
      base = " " + Date.prototype.toUTCString.call(value);
    }
    if (isError(value)) {
      base = " " + formatError(value);
    }
    if (keys2.length === 0 && (!array || value.length == 0)) {
      return braces[0] + base + braces[1];
    }
    if (recurseTimes < 0) {
      if (isRegExp(value)) {
        return ctx.stylize(RegExp.prototype.toString.call(value), "regexp");
      } else {
        return ctx.stylize("[Object]", "special");
      }
    }
    ctx.seen.push(value);
    var output;
    if (array) {
      output = formatArray(ctx, value, recurseTimes, visibleKeys, keys2);
    } else {
      output = keys2.map(function(key) {
        return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
      });
    }
    ctx.seen.pop();
    return reduceToSingleString(output, base, braces);
  }
  function formatPrimitive(ctx, value) {
    if (isUndefined(value))
      return ctx.stylize("undefined", "undefined");
    if (isString(value)) {
      var simple = "'" + JSON.stringify(value).replace(/^"|"$/g, "").replace(/'/g, "\\'").replace(/\\"/g, '"') + "'";
      return ctx.stylize(simple, "string");
    }
    if (isNumber(value))
      return ctx.stylize("" + value, "number");
    if (isBoolean(value))
      return ctx.stylize("" + value, "boolean");
    if (isNull(value))
      return ctx.stylize("null", "null");
  }
  function formatError(value) {
    return "[" + Error.prototype.toString.call(value) + "]";
  }
  function formatArray(ctx, value, recurseTimes, visibleKeys, keys2) {
    var output = [];
    for (var i = 0, l = value.length; i < l; ++i) {
      if (hasOwnProperty(value, String(i))) {
        output.push(formatProperty(
          ctx,
          value,
          recurseTimes,
          visibleKeys,
          String(i),
          true
        ));
      } else {
        output.push("");
      }
    }
    keys2.forEach(function(key) {
      if (!key.match(/^\d+$/)) {
        output.push(formatProperty(
          ctx,
          value,
          recurseTimes,
          visibleKeys,
          key,
          true
        ));
      }
    });
    return output;
  }
  function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
    var name, str, desc;
    desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
    if (desc.get) {
      if (desc.set) {
        str = ctx.stylize("[Getter/Setter]", "special");
      } else {
        str = ctx.stylize("[Getter]", "special");
      }
    } else {
      if (desc.set) {
        str = ctx.stylize("[Setter]", "special");
      }
    }
    if (!hasOwnProperty(visibleKeys, key)) {
      name = "[" + key + "]";
    }
    if (!str) {
      if (ctx.seen.indexOf(desc.value) < 0) {
        if (isNull(recurseTimes)) {
          str = formatValue(ctx, desc.value, null);
        } else {
          str = formatValue(ctx, desc.value, recurseTimes - 1);
        }
        if (str.indexOf("\n") > -1) {
          if (array) {
            str = str.split("\n").map(function(line) {
              return "  " + line;
            }).join("\n").substr(2);
          } else {
            str = "\n" + str.split("\n").map(function(line) {
              return "   " + line;
            }).join("\n");
          }
        }
      } else {
        str = ctx.stylize("[Circular]", "special");
      }
    }
    if (isUndefined(name)) {
      if (array && key.match(/^\d+$/)) {
        return str;
      }
      name = JSON.stringify("" + key);
      if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
        name = name.substr(1, name.length - 2);
        name = ctx.stylize(name, "name");
      } else {
        name = name.replace(/'/g, "\\'").replace(/\\"/g, '"').replace(/(^"|"$)/g, "'");
        name = ctx.stylize(name, "string");
      }
    }
    return name + ": " + str;
  }
  function reduceToSingleString(output, base, braces) {
    var length = output.reduce(function(prev, cur) {
      if (cur.indexOf("\n") >= 0) ;
      return prev + cur.replace(/\u001b\[\d\d?m/g, "").length + 1;
    }, 0);
    if (length > 60) {
      return braces[0] + (base === "" ? "" : base + "\n ") + " " + output.join(",\n  ") + " " + braces[1];
    }
    return braces[0] + base + " " + output.join(", ") + " " + braces[1];
  }
  function isArray(ar) {
    return Array.isArray(ar);
  }
  function isBoolean(arg) {
    return typeof arg === "boolean";
  }
  function isNull(arg) {
    return arg === null;
  }
  function isNumber(arg) {
    return typeof arg === "number";
  }
  function isString(arg) {
    return typeof arg === "string";
  }
  function isUndefined(arg) {
    return arg === void 0;
  }
  function isRegExp(re) {
    return isObject(re) && objectToString(re) === "[object RegExp]";
  }
  function isObject(arg) {
    return typeof arg === "object" && arg !== null;
  }
  function isDate(d) {
    return isObject(d) && objectToString(d) === "[object Date]";
  }
  function isError(e) {
    return isObject(e) && (objectToString(e) === "[object Error]" || e instanceof Error);
  }
  function isFunction(arg) {
    return typeof arg === "function";
  }
  function objectToString(o) {
    return Object.prototype.toString.call(o);
  }
  function _extend(origin, add) {
    if (!add || !isObject(add)) return origin;
    var keys2 = Object.keys(add);
    var i = keys2.length;
    while (i--) {
      origin[keys2[i]] = add[keys2[i]];
    }
    return origin;
  }
  function hasOwnProperty(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  }
  function BufferList() {
    this.head = null;
    this.tail = null;
    this.length = 0;
  }
  BufferList.prototype.push = function(v) {
    var entry = { data: v, next: null };
    if (this.length > 0) this.tail.next = entry;
    else this.head = entry;
    this.tail = entry;
    ++this.length;
  };
  BufferList.prototype.unshift = function(v) {
    var entry = { data: v, next: this.head };
    if (this.length === 0) this.tail = entry;
    this.head = entry;
    ++this.length;
  };
  BufferList.prototype.shift = function() {
    if (this.length === 0) return;
    var ret = this.head.data;
    if (this.length === 1) this.head = this.tail = null;
    else this.head = this.head.next;
    --this.length;
    return ret;
  };
  BufferList.prototype.clear = function() {
    this.head = this.tail = null;
    this.length = 0;
  };
  BufferList.prototype.join = function(s) {
    if (this.length === 0) return "";
    var p = this.head;
    var ret = "" + p.data;
    while (p = p.next) {
      ret += s + p.data;
    }
    return ret;
  };
  BufferList.prototype.concat = function(n) {
    if (this.length === 0) return Buffer2.alloc(0);
    if (this.length === 1) return this.head.data;
    var ret = Buffer2.allocUnsafe(n >>> 0);
    var p = this.head;
    var i = 0;
    while (p) {
      p.data.copy(ret, i);
      i += p.data.length;
      p = p.next;
    }
    return ret;
  };
  var isBufferEncoding = Buffer2.isEncoding || function(encoding) {
    switch (encoding && encoding.toLowerCase()) {
      case "hex":
      case "utf8":
      case "utf-8":
      case "ascii":
      case "binary":
      case "base64":
      case "ucs2":
      case "ucs-2":
      case "utf16le":
      case "utf-16le":
      case "raw":
        return true;
      default:
        return false;
    }
  };
  function assertEncoding(encoding) {
    if (encoding && !isBufferEncoding(encoding)) {
      throw new Error("Unknown encoding: " + encoding);
    }
  }
  function StringDecoder(encoding) {
    this.encoding = (encoding || "utf8").toLowerCase().replace(/[-_]/, "");
    assertEncoding(encoding);
    switch (this.encoding) {
      case "utf8":
        this.surrogateSize = 3;
        break;
      case "ucs2":
      case "utf16le":
        this.surrogateSize = 2;
        this.detectIncompleteChar = utf16DetectIncompleteChar;
        break;
      case "base64":
        this.surrogateSize = 3;
        this.detectIncompleteChar = base64DetectIncompleteChar;
        break;
      default:
        this.write = passThroughWrite;
        return;
    }
    this.charBuffer = new Buffer2(6);
    this.charReceived = 0;
    this.charLength = 0;
  }
  StringDecoder.prototype.write = function(buffer) {
    var charStr = "";
    while (this.charLength) {
      var available = buffer.length >= this.charLength - this.charReceived ? this.charLength - this.charReceived : buffer.length;
      buffer.copy(this.charBuffer, this.charReceived, 0, available);
      this.charReceived += available;
      if (this.charReceived < this.charLength) {
        return "";
      }
      buffer = buffer.slice(available, buffer.length);
      charStr = this.charBuffer.slice(0, this.charLength).toString(this.encoding);
      var charCode = charStr.charCodeAt(charStr.length - 1);
      if (charCode >= 55296 && charCode <= 56319) {
        this.charLength += this.surrogateSize;
        charStr = "";
        continue;
      }
      this.charReceived = this.charLength = 0;
      if (buffer.length === 0) {
        return charStr;
      }
      break;
    }
    this.detectIncompleteChar(buffer);
    var end = buffer.length;
    if (this.charLength) {
      buffer.copy(this.charBuffer, 0, buffer.length - this.charReceived, end);
      end -= this.charReceived;
    }
    charStr += buffer.toString(this.encoding, 0, end);
    var end = charStr.length - 1;
    var charCode = charStr.charCodeAt(end);
    if (charCode >= 55296 && charCode <= 56319) {
      var size = this.surrogateSize;
      this.charLength += size;
      this.charReceived += size;
      this.charBuffer.copy(this.charBuffer, size, 0, size);
      buffer.copy(this.charBuffer, 0, 0, size);
      return charStr.substring(0, end);
    }
    return charStr;
  };
  StringDecoder.prototype.detectIncompleteChar = function(buffer) {
    var i = buffer.length >= 3 ? 3 : buffer.length;
    for (; i > 0; i--) {
      var c = buffer[buffer.length - i];
      if (i == 1 && c >> 5 == 6) {
        this.charLength = 2;
        break;
      }
      if (i <= 2 && c >> 4 == 14) {
        this.charLength = 3;
        break;
      }
      if (i <= 3 && c >> 3 == 30) {
        this.charLength = 4;
        break;
      }
    }
    this.charReceived = i;
  };
  StringDecoder.prototype.end = function(buffer) {
    var res = "";
    if (buffer && buffer.length)
      res = this.write(buffer);
    if (this.charReceived) {
      var cr2 = this.charReceived;
      var buf = this.charBuffer;
      var enc = this.encoding;
      res += buf.slice(0, cr2).toString(enc);
    }
    return res;
  };
  function passThroughWrite(buffer) {
    return buffer.toString(this.encoding);
  }
  function utf16DetectIncompleteChar(buffer) {
    this.charReceived = buffer.length % 2;
    this.charLength = this.charReceived ? 2 : 0;
  }
  function base64DetectIncompleteChar(buffer) {
    this.charReceived = buffer.length % 3;
    this.charLength = this.charReceived ? 3 : 0;
  }
  Readable.ReadableState = ReadableState;
  var debug = debuglog("stream");
  inherits$1(Readable, EventEmitter);
  function prependListener2(emitter, event, fn) {
    if (typeof emitter.prependListener === "function") {
      return emitter.prependListener(event, fn);
    } else {
      if (!emitter._events || !emitter._events[event])
        emitter.on(event, fn);
      else if (Array.isArray(emitter._events[event]))
        emitter._events[event].unshift(fn);
      else
        emitter._events[event] = [fn, emitter._events[event]];
    }
  }
  function listenerCount(emitter, type) {
    return emitter.listeners(type).length;
  }
  function ReadableState(options, stream) {
    options = options || {};
    this.objectMode = !!options.objectMode;
    if (stream instanceof Duplex) this.objectMode = this.objectMode || !!options.readableObjectMode;
    var hwm = options.highWaterMark;
    var defaultHwm = this.objectMode ? 16 : 16 * 1024;
    this.highWaterMark = hwm || hwm === 0 ? hwm : defaultHwm;
    this.highWaterMark = ~~this.highWaterMark;
    this.buffer = new BufferList();
    this.length = 0;
    this.pipes = null;
    this.pipesCount = 0;
    this.flowing = null;
    this.ended = false;
    this.endEmitted = false;
    this.reading = false;
    this.sync = true;
    this.needReadable = false;
    this.emittedReadable = false;
    this.readableListening = false;
    this.resumeScheduled = false;
    this.defaultEncoding = options.defaultEncoding || "utf8";
    this.ranOut = false;
    this.awaitDrain = 0;
    this.readingMore = false;
    this.decoder = null;
    this.encoding = null;
    if (options.encoding) {
      this.decoder = new StringDecoder(options.encoding);
      this.encoding = options.encoding;
    }
  }
  function Readable(options) {
    if (!(this instanceof Readable)) return new Readable(options);
    this._readableState = new ReadableState(options, this);
    this.readable = true;
    if (options && typeof options.read === "function") this._read = options.read;
    EventEmitter.call(this);
  }
  Readable.prototype.push = function(chunk, encoding) {
    var state = this._readableState;
    if (!state.objectMode && typeof chunk === "string") {
      encoding = encoding || state.defaultEncoding;
      if (encoding !== state.encoding) {
        chunk = Buffer2.from(chunk, encoding);
        encoding = "";
      }
    }
    return readableAddChunk(this, state, chunk, encoding, false);
  };
  Readable.prototype.unshift = function(chunk) {
    var state = this._readableState;
    return readableAddChunk(this, state, chunk, "", true);
  };
  Readable.prototype.isPaused = function() {
    return this._readableState.flowing === false;
  };
  function readableAddChunk(stream, state, chunk, encoding, addToFront) {
    var er = chunkInvalid(state, chunk);
    if (er) {
      stream.emit("error", er);
    } else if (chunk === null) {
      state.reading = false;
      onEofChunk(stream, state);
    } else if (state.objectMode || chunk && chunk.length > 0) {
      if (state.ended && !addToFront) {
        var e = new Error("stream.push() after EOF");
        stream.emit("error", e);
      } else if (state.endEmitted && addToFront) {
        var _e = new Error("stream.unshift() after end event");
        stream.emit("error", _e);
      } else {
        var skipAdd;
        if (state.decoder && !addToFront && !encoding) {
          chunk = state.decoder.write(chunk);
          skipAdd = !state.objectMode && chunk.length === 0;
        }
        if (!addToFront) state.reading = false;
        if (!skipAdd) {
          if (state.flowing && state.length === 0 && !state.sync) {
            stream.emit("data", chunk);
            stream.read(0);
          } else {
            state.length += state.objectMode ? 1 : chunk.length;
            if (addToFront) state.buffer.unshift(chunk);
            else state.buffer.push(chunk);
            if (state.needReadable) emitReadable(stream);
          }
        }
        maybeReadMore(stream, state);
      }
    } else if (!addToFront) {
      state.reading = false;
    }
    return needMoreData(state);
  }
  function needMoreData(state) {
    return !state.ended && (state.needReadable || state.length < state.highWaterMark || state.length === 0);
  }
  Readable.prototype.setEncoding = function(enc) {
    this._readableState.decoder = new StringDecoder(enc);
    this._readableState.encoding = enc;
    return this;
  };
  var MAX_HWM = 8388608;
  function computeNewHighWaterMark(n) {
    if (n >= MAX_HWM) {
      n = MAX_HWM;
    } else {
      n--;
      n |= n >>> 1;
      n |= n >>> 2;
      n |= n >>> 4;
      n |= n >>> 8;
      n |= n >>> 16;
      n++;
    }
    return n;
  }
  function howMuchToRead(n, state) {
    if (n <= 0 || state.length === 0 && state.ended) return 0;
    if (state.objectMode) return 1;
    if (n !== n) {
      if (state.flowing && state.length) return state.buffer.head.data.length;
      else return state.length;
    }
    if (n > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n);
    if (n <= state.length) return n;
    if (!state.ended) {
      state.needReadable = true;
      return 0;
    }
    return state.length;
  }
  Readable.prototype.read = function(n) {
    debug("read", n);
    n = parseInt(n, 10);
    var state = this._readableState;
    var nOrig = n;
    if (n !== 0) state.emittedReadable = false;
    if (n === 0 && state.needReadable && (state.length >= state.highWaterMark || state.ended)) {
      debug("read: emitReadable", state.length, state.ended);
      if (state.length === 0 && state.ended) endReadable(this);
      else emitReadable(this);
      return null;
    }
    n = howMuchToRead(n, state);
    if (n === 0 && state.ended) {
      if (state.length === 0) endReadable(this);
      return null;
    }
    var doRead = state.needReadable;
    debug("need readable", doRead);
    if (state.length === 0 || state.length - n < state.highWaterMark) {
      doRead = true;
      debug("length less than watermark", doRead);
    }
    if (state.ended || state.reading) {
      doRead = false;
      debug("reading or ended", doRead);
    } else if (doRead) {
      debug("do read");
      state.reading = true;
      state.sync = true;
      if (state.length === 0) state.needReadable = true;
      this._read(state.highWaterMark);
      state.sync = false;
      if (!state.reading) n = howMuchToRead(nOrig, state);
    }
    var ret;
    if (n > 0) ret = fromList(n, state);
    else ret = null;
    if (ret === null) {
      state.needReadable = true;
      n = 0;
    } else {
      state.length -= n;
    }
    if (state.length === 0) {
      if (!state.ended) state.needReadable = true;
      if (nOrig !== n && state.ended) endReadable(this);
    }
    if (ret !== null) this.emit("data", ret);
    return ret;
  };
  function chunkInvalid(state, chunk) {
    var er = null;
    if (!isBuffer(chunk) && typeof chunk !== "string" && chunk !== null && chunk !== void 0 && !state.objectMode) {
      er = new TypeError("Invalid non-string/buffer chunk");
    }
    return er;
  }
  function onEofChunk(stream, state) {
    if (state.ended) return;
    if (state.decoder) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length) {
        state.buffer.push(chunk);
        state.length += state.objectMode ? 1 : chunk.length;
      }
    }
    state.ended = true;
    emitReadable(stream);
  }
  function emitReadable(stream) {
    var state = stream._readableState;
    state.needReadable = false;
    if (!state.emittedReadable) {
      debug("emitReadable", state.flowing);
      state.emittedReadable = true;
      if (state.sync) nextTick(emitReadable_, stream);
      else emitReadable_(stream);
    }
  }
  function emitReadable_(stream) {
    debug("emit readable");
    stream.emit("readable");
    flow(stream);
  }
  function maybeReadMore(stream, state) {
    if (!state.readingMore) {
      state.readingMore = true;
      nextTick(maybeReadMore_, stream, state);
    }
  }
  function maybeReadMore_(stream, state) {
    var len = state.length;
    while (!state.reading && !state.flowing && !state.ended && state.length < state.highWaterMark) {
      debug("maybeReadMore read 0");
      stream.read(0);
      if (len === state.length)
        break;
      else len = state.length;
    }
    state.readingMore = false;
  }
  Readable.prototype._read = function(n) {
    this.emit("error", new Error("not implemented"));
  };
  Readable.prototype.pipe = function(dest, pipeOpts) {
    var src = this;
    var state = this._readableState;
    switch (state.pipesCount) {
      case 0:
        state.pipes = dest;
        break;
      case 1:
        state.pipes = [state.pipes, dest];
        break;
      default:
        state.pipes.push(dest);
        break;
    }
    state.pipesCount += 1;
    debug("pipe count=%d opts=%j", state.pipesCount, pipeOpts);
    var doEnd = !pipeOpts || pipeOpts.end !== false;
    var endFn = doEnd ? onend2 : cleanup;
    if (state.endEmitted) nextTick(endFn);
    else src.once("end", endFn);
    dest.on("unpipe", onunpipe);
    function onunpipe(readable) {
      debug("onunpipe");
      if (readable === src) {
        cleanup();
      }
    }
    function onend2() {
      debug("onend");
      dest.end();
    }
    var ondrain = pipeOnDrain(src);
    dest.on("drain", ondrain);
    var cleanedUp = false;
    function cleanup() {
      debug("cleanup");
      dest.removeListener("close", onclose);
      dest.removeListener("finish", onfinish);
      dest.removeListener("drain", ondrain);
      dest.removeListener("error", onerror);
      dest.removeListener("unpipe", onunpipe);
      src.removeListener("end", onend2);
      src.removeListener("end", cleanup);
      src.removeListener("data", ondata);
      cleanedUp = true;
      if (state.awaitDrain && (!dest._writableState || dest._writableState.needDrain)) ondrain();
    }
    var increasedAwaitDrain = false;
    src.on("data", ondata);
    function ondata(chunk) {
      debug("ondata");
      increasedAwaitDrain = false;
      var ret = dest.write(chunk);
      if (false === ret && !increasedAwaitDrain) {
        if ((state.pipesCount === 1 && state.pipes === dest || state.pipesCount > 1 && indexOf2(state.pipes, dest) !== -1) && !cleanedUp) {
          debug("false write response, pause", src._readableState.awaitDrain);
          src._readableState.awaitDrain++;
          increasedAwaitDrain = true;
        }
        src.pause();
      }
    }
    function onerror(er) {
      debug("onerror", er);
      unpipe();
      dest.removeListener("error", onerror);
      if (listenerCount(dest, "error") === 0) dest.emit("error", er);
    }
    prependListener2(dest, "error", onerror);
    function onclose() {
      dest.removeListener("finish", onfinish);
      unpipe();
    }
    dest.once("close", onclose);
    function onfinish() {
      debug("onfinish");
      dest.removeListener("close", onclose);
      unpipe();
    }
    dest.once("finish", onfinish);
    function unpipe() {
      debug("unpipe");
      src.unpipe(dest);
    }
    dest.emit("pipe", src);
    if (!state.flowing) {
      debug("pipe resume");
      src.resume();
    }
    return dest;
  };
  function pipeOnDrain(src) {
    return function() {
      var state = src._readableState;
      debug("pipeOnDrain", state.awaitDrain);
      if (state.awaitDrain) state.awaitDrain--;
      if (state.awaitDrain === 0 && src.listeners("data").length) {
        state.flowing = true;
        flow(src);
      }
    };
  }
  Readable.prototype.unpipe = function(dest) {
    var state = this._readableState;
    if (state.pipesCount === 0) return this;
    if (state.pipesCount === 1) {
      if (dest && dest !== state.pipes) return this;
      if (!dest) dest = state.pipes;
      state.pipes = null;
      state.pipesCount = 0;
      state.flowing = false;
      if (dest) dest.emit("unpipe", this);
      return this;
    }
    if (!dest) {
      var dests = state.pipes;
      var len = state.pipesCount;
      state.pipes = null;
      state.pipesCount = 0;
      state.flowing = false;
      for (var _i = 0; _i < len; _i++) {
        dests[_i].emit("unpipe", this);
      }
      return this;
    }
    var i = indexOf2(state.pipes, dest);
    if (i === -1) return this;
    state.pipes.splice(i, 1);
    state.pipesCount -= 1;
    if (state.pipesCount === 1) state.pipes = state.pipes[0];
    dest.emit("unpipe", this);
    return this;
  };
  Readable.prototype.on = function(ev, fn) {
    var res = EventEmitter.prototype.on.call(this, ev, fn);
    if (ev === "data") {
      if (this._readableState.flowing !== false) this.resume();
    } else if (ev === "readable") {
      var state = this._readableState;
      if (!state.endEmitted && !state.readableListening) {
        state.readableListening = state.needReadable = true;
        state.emittedReadable = false;
        if (!state.reading) {
          nextTick(nReadingNextTick, this);
        } else if (state.length) {
          emitReadable(this);
        }
      }
    }
    return res;
  };
  Readable.prototype.addListener = Readable.prototype.on;
  function nReadingNextTick(self2) {
    debug("readable nexttick read 0");
    self2.read(0);
  }
  Readable.prototype.resume = function() {
    var state = this._readableState;
    if (!state.flowing) {
      debug("resume");
      state.flowing = true;
      resume(this, state);
    }
    return this;
  };
  function resume(stream, state) {
    if (!state.resumeScheduled) {
      state.resumeScheduled = true;
      nextTick(resume_, stream, state);
    }
  }
  function resume_(stream, state) {
    if (!state.reading) {
      debug("resume read 0");
      stream.read(0);
    }
    state.resumeScheduled = false;
    state.awaitDrain = 0;
    stream.emit("resume");
    flow(stream);
    if (state.flowing && !state.reading) stream.read(0);
  }
  Readable.prototype.pause = function() {
    debug("call pause flowing=%j", this._readableState.flowing);
    if (false !== this._readableState.flowing) {
      debug("pause");
      this._readableState.flowing = false;
      this.emit("pause");
    }
    return this;
  };
  function flow(stream) {
    var state = stream._readableState;
    debug("flow", state.flowing);
    while (state.flowing && stream.read() !== null) {
    }
  }
  Readable.prototype.wrap = function(stream) {
    var state = this._readableState;
    var paused = false;
    var self2 = this;
    stream.on("end", function() {
      debug("wrapped end");
      if (state.decoder && !state.ended) {
        var chunk = state.decoder.end();
        if (chunk && chunk.length) self2.push(chunk);
      }
      self2.push(null);
    });
    stream.on("data", function(chunk) {
      debug("wrapped data");
      if (state.decoder) chunk = state.decoder.write(chunk);
      if (state.objectMode && (chunk === null || chunk === void 0)) return;
      else if (!state.objectMode && (!chunk || !chunk.length)) return;
      var ret = self2.push(chunk);
      if (!ret) {
        paused = true;
        stream.pause();
      }
    });
    for (var i in stream) {
      if (this[i] === void 0 && typeof stream[i] === "function") {
        this[i] = /* @__PURE__ */ (function(method) {
          return function() {
            return stream[method].apply(stream, arguments);
          };
        })(i);
      }
    }
    var events = ["error", "close", "destroy", "pause", "resume"];
    forEach(events, function(ev) {
      stream.on(ev, self2.emit.bind(self2, ev));
    });
    self2._read = function(n) {
      debug("wrapped _read", n);
      if (paused) {
        paused = false;
        stream.resume();
      }
    };
    return self2;
  };
  Readable._fromList = fromList;
  function fromList(n, state) {
    if (state.length === 0) return null;
    var ret;
    if (state.objectMode) ret = state.buffer.shift();
    else if (!n || n >= state.length) {
      if (state.decoder) ret = state.buffer.join("");
      else if (state.buffer.length === 1) ret = state.buffer.head.data;
      else ret = state.buffer.concat(state.length);
      state.buffer.clear();
    } else {
      ret = fromListPartial(n, state.buffer, state.decoder);
    }
    return ret;
  }
  function fromListPartial(n, list, hasStrings) {
    var ret;
    if (n < list.head.data.length) {
      ret = list.head.data.slice(0, n);
      list.head.data = list.head.data.slice(n);
    } else if (n === list.head.data.length) {
      ret = list.shift();
    } else {
      ret = hasStrings ? copyFromBufferString(n, list) : copyFromBuffer(n, list);
    }
    return ret;
  }
  function copyFromBufferString(n, list) {
    var p = list.head;
    var c = 1;
    var ret = p.data;
    n -= ret.length;
    while (p = p.next) {
      var str = p.data;
      var nb = n > str.length ? str.length : n;
      if (nb === str.length) ret += str;
      else ret += str.slice(0, n);
      n -= nb;
      if (n === 0) {
        if (nb === str.length) {
          ++c;
          if (p.next) list.head = p.next;
          else list.head = list.tail = null;
        } else {
          list.head = p;
          p.data = str.slice(nb);
        }
        break;
      }
      ++c;
    }
    list.length -= c;
    return ret;
  }
  function copyFromBuffer(n, list) {
    var ret = Buffer2.allocUnsafe(n);
    var p = list.head;
    var c = 1;
    p.data.copy(ret);
    n -= p.data.length;
    while (p = p.next) {
      var buf = p.data;
      var nb = n > buf.length ? buf.length : n;
      buf.copy(ret, ret.length - n, 0, nb);
      n -= nb;
      if (n === 0) {
        if (nb === buf.length) {
          ++c;
          if (p.next) list.head = p.next;
          else list.head = list.tail = null;
        } else {
          list.head = p;
          p.data = buf.slice(nb);
        }
        break;
      }
      ++c;
    }
    list.length -= c;
    return ret;
  }
  function endReadable(stream) {
    var state = stream._readableState;
    if (state.length > 0) throw new Error('"endReadable()" called on non-empty stream');
    if (!state.endEmitted) {
      state.ended = true;
      nextTick(endReadableNT, state, stream);
    }
  }
  function endReadableNT(state, stream) {
    if (!state.endEmitted && state.length === 0) {
      state.endEmitted = true;
      stream.readable = false;
      stream.emit("end");
    }
  }
  function forEach(xs, f) {
    for (var i = 0, l = xs.length; i < l; i++) {
      f(xs[i], i);
    }
  }
  function indexOf2(xs, x) {
    for (var i = 0, l = xs.length; i < l; i++) {
      if (xs[i] === x) return i;
    }
    return -1;
  }
  Writable.WritableState = WritableState;
  inherits$1(Writable, EventEmitter);
  function nop() {
  }
  function WriteReq(chunk, encoding, cb) {
    this.chunk = chunk;
    this.encoding = encoding;
    this.callback = cb;
    this.next = null;
  }
  function WritableState(options, stream) {
    Object.defineProperty(this, "buffer", {
      get: deprecate(function() {
        return this.getBuffer();
      }, "_writableState.buffer is deprecated. Use _writableState.getBuffer instead.")
    });
    options = options || {};
    this.objectMode = !!options.objectMode;
    if (stream instanceof Duplex) this.objectMode = this.objectMode || !!options.writableObjectMode;
    var hwm = options.highWaterMark;
    var defaultHwm = this.objectMode ? 16 : 16 * 1024;
    this.highWaterMark = hwm || hwm === 0 ? hwm : defaultHwm;
    this.highWaterMark = ~~this.highWaterMark;
    this.needDrain = false;
    this.ending = false;
    this.ended = false;
    this.finished = false;
    var noDecode = options.decodeStrings === false;
    this.decodeStrings = !noDecode;
    this.defaultEncoding = options.defaultEncoding || "utf8";
    this.length = 0;
    this.writing = false;
    this.corked = 0;
    this.sync = true;
    this.bufferProcessing = false;
    this.onwrite = function(er) {
      onwrite(stream, er);
    };
    this.writecb = null;
    this.writelen = 0;
    this.bufferedRequest = null;
    this.lastBufferedRequest = null;
    this.pendingcb = 0;
    this.prefinished = false;
    this.errorEmitted = false;
    this.bufferedRequestCount = 0;
    this.corkedRequestsFree = new CorkedRequest(this);
  }
  WritableState.prototype.getBuffer = function writableStateGetBuffer() {
    var current = this.bufferedRequest;
    var out = [];
    while (current) {
      out.push(current);
      current = current.next;
    }
    return out;
  };
  function Writable(options) {
    if (!(this instanceof Writable) && !(this instanceof Duplex)) return new Writable(options);
    this._writableState = new WritableState(options, this);
    this.writable = true;
    if (options) {
      if (typeof options.write === "function") this._write = options.write;
      if (typeof options.writev === "function") this._writev = options.writev;
    }
    EventEmitter.call(this);
  }
  Writable.prototype.pipe = function() {
    this.emit("error", new Error("Cannot pipe, not readable"));
  };
  function writeAfterEnd(stream, cb) {
    var er = new Error("write after end");
    stream.emit("error", er);
    nextTick(cb, er);
  }
  function validChunk(stream, state, chunk, cb) {
    var valid = true;
    var er = false;
    if (chunk === null) {
      er = new TypeError("May not write null values to stream");
    } else if (!Buffer2.isBuffer(chunk) && typeof chunk !== "string" && chunk !== void 0 && !state.objectMode) {
      er = new TypeError("Invalid non-string/buffer chunk");
    }
    if (er) {
      stream.emit("error", er);
      nextTick(cb, er);
      valid = false;
    }
    return valid;
  }
  Writable.prototype.write = function(chunk, encoding, cb) {
    var state = this._writableState;
    var ret = false;
    if (typeof encoding === "function") {
      cb = encoding;
      encoding = null;
    }
    if (Buffer2.isBuffer(chunk)) encoding = "buffer";
    else if (!encoding) encoding = state.defaultEncoding;
    if (typeof cb !== "function") cb = nop;
    if (state.ended) writeAfterEnd(this, cb);
    else if (validChunk(this, state, chunk, cb)) {
      state.pendingcb++;
      ret = writeOrBuffer(this, state, chunk, encoding, cb);
    }
    return ret;
  };
  Writable.prototype.cork = function() {
    var state = this._writableState;
    state.corked++;
  };
  Writable.prototype.uncork = function() {
    var state = this._writableState;
    if (state.corked) {
      state.corked--;
      if (!state.writing && !state.corked && !state.finished && !state.bufferProcessing && state.bufferedRequest) clearBuffer(this, state);
    }
  };
  Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
    if (typeof encoding === "string") encoding = encoding.toLowerCase();
    if (!(["hex", "utf8", "utf-8", "ascii", "binary", "base64", "ucs2", "ucs-2", "utf16le", "utf-16le", "raw"].indexOf((encoding + "").toLowerCase()) > -1)) throw new TypeError("Unknown encoding: " + encoding);
    this._writableState.defaultEncoding = encoding;
    return this;
  };
  function decodeChunk(state, chunk, encoding) {
    if (!state.objectMode && state.decodeStrings !== false && typeof chunk === "string") {
      chunk = Buffer2.from(chunk, encoding);
    }
    return chunk;
  }
  function writeOrBuffer(stream, state, chunk, encoding, cb) {
    chunk = decodeChunk(state, chunk, encoding);
    if (Buffer2.isBuffer(chunk)) encoding = "buffer";
    var len = state.objectMode ? 1 : chunk.length;
    state.length += len;
    var ret = state.length < state.highWaterMark;
    if (!ret) state.needDrain = true;
    if (state.writing || state.corked) {
      var last = state.lastBufferedRequest;
      state.lastBufferedRequest = new WriteReq(chunk, encoding, cb);
      if (last) {
        last.next = state.lastBufferedRequest;
      } else {
        state.bufferedRequest = state.lastBufferedRequest;
      }
      state.bufferedRequestCount += 1;
    } else {
      doWrite(stream, state, false, len, chunk, encoding, cb);
    }
    return ret;
  }
  function doWrite(stream, state, writev, len, chunk, encoding, cb) {
    state.writelen = len;
    state.writecb = cb;
    state.writing = true;
    state.sync = true;
    if (writev) stream._writev(chunk, state.onwrite);
    else stream._write(chunk, encoding, state.onwrite);
    state.sync = false;
  }
  function onwriteError(stream, state, sync, er, cb) {
    --state.pendingcb;
    if (sync) nextTick(cb, er);
    else cb(er);
    stream._writableState.errorEmitted = true;
    stream.emit("error", er);
  }
  function onwriteStateUpdate(state) {
    state.writing = false;
    state.writecb = null;
    state.length -= state.writelen;
    state.writelen = 0;
  }
  function onwrite(stream, er) {
    var state = stream._writableState;
    var sync = state.sync;
    var cb = state.writecb;
    onwriteStateUpdate(state);
    if (er) onwriteError(stream, state, sync, er, cb);
    else {
      var finished = needFinish(state);
      if (!finished && !state.corked && !state.bufferProcessing && state.bufferedRequest) {
        clearBuffer(stream, state);
      }
      if (sync) {
        nextTick(afterWrite, stream, state, finished, cb);
      } else {
        afterWrite(stream, state, finished, cb);
      }
    }
  }
  function afterWrite(stream, state, finished, cb) {
    if (!finished) onwriteDrain(stream, state);
    state.pendingcb--;
    cb();
    finishMaybe(stream, state);
  }
  function onwriteDrain(stream, state) {
    if (state.length === 0 && state.needDrain) {
      state.needDrain = false;
      stream.emit("drain");
    }
  }
  function clearBuffer(stream, state) {
    state.bufferProcessing = true;
    var entry = state.bufferedRequest;
    if (stream._writev && entry && entry.next) {
      var l = state.bufferedRequestCount;
      var buffer = new Array(l);
      var holder = state.corkedRequestsFree;
      holder.entry = entry;
      var count = 0;
      while (entry) {
        buffer[count] = entry;
        entry = entry.next;
        count += 1;
      }
      doWrite(stream, state, true, state.length, buffer, "", holder.finish);
      state.pendingcb++;
      state.lastBufferedRequest = null;
      if (holder.next) {
        state.corkedRequestsFree = holder.next;
        holder.next = null;
      } else {
        state.corkedRequestsFree = new CorkedRequest(state);
      }
    } else {
      while (entry) {
        var chunk = entry.chunk;
        var encoding = entry.encoding;
        var cb = entry.callback;
        var len = state.objectMode ? 1 : chunk.length;
        doWrite(stream, state, false, len, chunk, encoding, cb);
        entry = entry.next;
        if (state.writing) {
          break;
        }
      }
      if (entry === null) state.lastBufferedRequest = null;
    }
    state.bufferedRequestCount = 0;
    state.bufferedRequest = entry;
    state.bufferProcessing = false;
  }
  Writable.prototype._write = function(chunk, encoding, cb) {
    cb(new Error("not implemented"));
  };
  Writable.prototype._writev = null;
  Writable.prototype.end = function(chunk, encoding, cb) {
    var state = this._writableState;
    if (typeof chunk === "function") {
      cb = chunk;
      chunk = null;
      encoding = null;
    } else if (typeof encoding === "function") {
      cb = encoding;
      encoding = null;
    }
    if (chunk !== null && chunk !== void 0) this.write(chunk, encoding);
    if (state.corked) {
      state.corked = 1;
      this.uncork();
    }
    if (!state.ending && !state.finished) endWritable(this, state, cb);
  };
  function needFinish(state) {
    return state.ending && state.length === 0 && state.bufferedRequest === null && !state.finished && !state.writing;
  }
  function prefinish(stream, state) {
    if (!state.prefinished) {
      state.prefinished = true;
      stream.emit("prefinish");
    }
  }
  function finishMaybe(stream, state) {
    var need = needFinish(state);
    if (need) {
      if (state.pendingcb === 0) {
        prefinish(stream, state);
        state.finished = true;
        stream.emit("finish");
      } else {
        prefinish(stream, state);
      }
    }
    return need;
  }
  function endWritable(stream, state, cb) {
    state.ending = true;
    finishMaybe(stream, state);
    if (cb) {
      if (state.finished) nextTick(cb);
      else stream.once("finish", cb);
    }
    state.ended = true;
    stream.writable = false;
  }
  function CorkedRequest(state) {
    var _this = this;
    this.next = null;
    this.entry = null;
    this.finish = function(err) {
      var entry = _this.entry;
      _this.entry = null;
      while (entry) {
        var cb = entry.callback;
        state.pendingcb--;
        cb(err);
        entry = entry.next;
      }
      if (state.corkedRequestsFree) {
        state.corkedRequestsFree.next = _this;
      } else {
        state.corkedRequestsFree = _this;
      }
    };
  }
  inherits$1(Duplex, Readable);
  var keys = Object.keys(Writable.prototype);
  for (v = 0; v < keys.length; v++) {
    method = keys[v];
    if (!Duplex.prototype[method]) Duplex.prototype[method] = Writable.prototype[method];
  }
  var method;
  var v;
  function Duplex(options) {
    if (!(this instanceof Duplex)) return new Duplex(options);
    Readable.call(this, options);
    Writable.call(this, options);
    if (options && options.readable === false) this.readable = false;
    if (options && options.writable === false) this.writable = false;
    this.allowHalfOpen = true;
    if (options && options.allowHalfOpen === false) this.allowHalfOpen = false;
    this.once("end", onend);
  }
  function onend() {
    if (this.allowHalfOpen || this._writableState.ended) return;
    nextTick(onEndNT, this);
  }
  function onEndNT(self2) {
    self2.end();
  }
  inherits$1(Transform, Duplex);
  function TransformState(stream) {
    this.afterTransform = function(er, data) {
      return afterTransform(stream, er, data);
    };
    this.needTransform = false;
    this.transforming = false;
    this.writecb = null;
    this.writechunk = null;
    this.writeencoding = null;
  }
  function afterTransform(stream, er, data) {
    var ts = stream._transformState;
    ts.transforming = false;
    var cb = ts.writecb;
    if (!cb) return stream.emit("error", new Error("no writecb in Transform class"));
    ts.writechunk = null;
    ts.writecb = null;
    if (data !== null && data !== void 0) stream.push(data);
    cb(er);
    var rs = stream._readableState;
    rs.reading = false;
    if (rs.needReadable || rs.length < rs.highWaterMark) {
      stream._read(rs.highWaterMark);
    }
  }
  function Transform(options) {
    if (!(this instanceof Transform)) return new Transform(options);
    Duplex.call(this, options);
    this._transformState = new TransformState(this);
    var stream = this;
    this._readableState.needReadable = true;
    this._readableState.sync = false;
    if (options) {
      if (typeof options.transform === "function") this._transform = options.transform;
      if (typeof options.flush === "function") this._flush = options.flush;
    }
    this.once("prefinish", function() {
      if (typeof this._flush === "function") this._flush(function(er) {
        done(stream, er);
      });
      else done(stream);
    });
  }
  Transform.prototype.push = function(chunk, encoding) {
    this._transformState.needTransform = false;
    return Duplex.prototype.push.call(this, chunk, encoding);
  };
  Transform.prototype._transform = function(chunk, encoding, cb) {
    throw new Error("Not implemented");
  };
  Transform.prototype._write = function(chunk, encoding, cb) {
    var ts = this._transformState;
    ts.writecb = cb;
    ts.writechunk = chunk;
    ts.writeencoding = encoding;
    if (!ts.transforming) {
      var rs = this._readableState;
      if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark) this._read(rs.highWaterMark);
    }
  };
  Transform.prototype._read = function(n) {
    var ts = this._transformState;
    if (ts.writechunk !== null && ts.writecb && !ts.transforming) {
      ts.transforming = true;
      this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
    } else {
      ts.needTransform = true;
    }
  };
  function done(stream, er) {
    if (er) return stream.emit("error", er);
    var ws = stream._writableState;
    var ts = stream._transformState;
    if (ws.length) throw new Error("Calling transform done when ws.length != 0");
    if (ts.transforming) throw new Error("Calling transform done when still transforming");
    return stream.push(null);
  }
  inherits$1(PassThrough, Transform);
  function PassThrough(options) {
    if (!(this instanceof PassThrough)) return new PassThrough(options);
    Transform.call(this, options);
  }
  PassThrough.prototype._transform = function(chunk, encoding, cb) {
    cb(null, chunk);
  };
  inherits$1(Stream, EventEmitter);
  Stream.Readable = Readable;
  Stream.Writable = Writable;
  Stream.Duplex = Duplex;
  Stream.Transform = Transform;
  Stream.PassThrough = PassThrough;
  Stream.Stream = Stream;
  function Stream() {
    EventEmitter.call(this);
  }
  Stream.prototype.pipe = function(dest, options) {
    var source = this;
    function ondata(chunk) {
      if (dest.writable) {
        if (false === dest.write(chunk) && source.pause) {
          source.pause();
        }
      }
    }
    source.on("data", ondata);
    function ondrain() {
      if (source.readable && source.resume) {
        source.resume();
      }
    }
    dest.on("drain", ondrain);
    if (!dest._isStdio && (!options || options.end !== false)) {
      source.on("end", onend2);
      source.on("close", onclose);
    }
    var didOnEnd = false;
    function onend2() {
      if (didOnEnd) return;
      didOnEnd = true;
      dest.end();
    }
    function onclose() {
      if (didOnEnd) return;
      didOnEnd = true;
      if (typeof dest.destroy === "function") dest.destroy();
    }
    function onerror(er) {
      cleanup();
      if (EventEmitter.listenerCount(this, "error") === 0) {
        throw er;
      }
    }
    source.on("error", onerror);
    dest.on("error", onerror);
    function cleanup() {
      source.removeListener("data", ondata);
      dest.removeListener("drain", ondrain);
      source.removeListener("end", onend2);
      source.removeListener("close", onclose);
      source.removeListener("error", onerror);
      dest.removeListener("error", onerror);
      source.removeListener("end", cleanup);
      source.removeListener("close", cleanup);
      dest.removeListener("close", cleanup);
    }
    source.on("end", cleanup);
    source.on("close", cleanup);
    dest.on("close", cleanup);
    dest.emit("pipe", source);
    return dest;
  };
  var is_object = function(obj) {
    return typeof obj === "object" && obj !== null && !Array.isArray(obj);
  };
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
          this[key] = isBuffer(value) ? value.toString(options.encoding) : value == null ? value : JSON.parse(JSON.stringify(value));
        }
      }
    }
  };
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
  var ResizeableBuffer = class {
    constructor(size = 100) {
      this.size = size;
      this.length = 0;
      this.buf = Buffer2.allocUnsafe(size);
    }
    prepend(val) {
      if (isBuffer(val)) {
        const length = this.length + val.length;
        if (length >= this.size) {
          this.resize();
          if (length >= this.size) {
            throw Error("INVALID_BUFFER_STATE");
          }
        }
        const buf = this.buf;
        this.buf = Buffer2.allocUnsafe(this.size);
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
      return Buffer2.from(this.buf.slice(0, this.length));
    }
    resize() {
      const length = this.length;
      this.size = this.size * 2;
      const buf = Buffer2.allocUnsafe(this.size);
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
  var np = 12;
  var cr$1 = 13;
  var nl$1 = 10;
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
      escapeIsQuote: isBuffer(options.escape) && isBuffer(options.quote) && Buffer2.compare(options.escape, options.quote) === 0,
      // columns can be `false`, `true`, `Array`
      expectedRecordLength: Array.isArray(options.columns) ? options.columns.length : void 0,
      field: new ResizeableBuffer(20),
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
      rawBuffer: new ResizeableBuffer(100),
      record: [],
      recordHasError: false,
      record_length: 0,
      recordDelimiterMaxLength: options.record_delimiter.length === 0 ? 0 : Math.max(...options.record_delimiter.map((v) => v.length)),
      trimChars: [Buffer2.from(" ", options.encoding)[0], Buffer2.from("	", options.encoding)[0]],
      wasQuoting: false,
      wasRowDelimiter: false,
      timchars: [
        Buffer2.from(Buffer2.from([cr$1], "utf8").toString(), options.encoding),
        Buffer2.from(Buffer2.from([nl$1], "utf8").toString(), options.encoding),
        Buffer2.from(Buffer2.from([np], "utf8").toString(), options.encoding),
        Buffer2.from(Buffer2.from([space], "utf8").toString(), options.encoding),
        Buffer2.from(Buffer2.from([tab], "utf8").toString(), options.encoding)
      ]
    };
  };
  var underscore = function(str) {
    return str.replace(/([A-Z])/g, function(_, match) {
      return "_" + match.toLowerCase();
    });
  };
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
        options.comment = Buffer2.from(options.comment, options.encoding);
      }
      if (!isBuffer(options.comment)) {
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
        return Buffer2.from(",", options.encoding);
      }
      if (typeof delimiter === "string") {
        delimiter = Buffer2.from(delimiter, options.encoding);
      }
      if (!isBuffer(delimiter) || delimiter.length === 0) {
        throw new CsvError("CSV_INVALID_OPTION_DELIMITER", [
          "Invalid option delimiter:",
          "delimiter must be a non empty string or buffer or array of string|buffer,",
          `got ${delimiter_json}`
        ], options);
      }
      return delimiter;
    });
    if (options.escape === void 0 || options.escape === true) {
      options.escape = Buffer2.from('"', options.encoding);
    } else if (typeof options.escape === "string") {
      options.escape = Buffer2.from(options.escape, options.encoding);
    } else if (options.escape === null || options.escape === false) {
      options.escape = null;
    }
    if (options.escape !== null) {
      if (!isBuffer(options.escape)) {
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
    } else if (Number.isInteger(options.max_record_size) && options.max_record_size >= 0) ;
    else if (typeof options.max_record_size === "string" && /\d+/.test(options.max_record_size)) {
      options.max_record_size = parseInt(options.max_record_size);
    } else {
      throw new Error(`Invalid Option: max_record_size must be a positive integer, got ${JSON.stringify(options.max_record_size)}`);
    }
    if (options.objname === void 0 || options.objname === null || options.objname === false) {
      options.objname = void 0;
    } else if (isBuffer(options.objname)) {
      if (options.objname.length === 0) {
        throw new Error(`Invalid Option: objname must be a non empty buffer`);
      }
      if (options.encoding === null) ;
      else {
        options.objname = options.objname.toString(options.encoding);
      }
    } else if (typeof options.objname === "string") {
      if (options.objname.length === 0) {
        throw new Error(`Invalid Option: objname must be a non empty string`);
      }
    } else if (typeof options.objname === "number") ;
    else {
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
        options.quote = Buffer2.from('"', options.encoding);
      } else if (typeof options.quote === "string") {
        options.quote = Buffer2.from(options.quote, options.encoding);
      }
      if (!isBuffer(options.quote)) {
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
    } else if (typeof options.record_delimiter === "string" || isBuffer(options.record_delimiter)) {
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
      if (typeof rd !== "string" && !isBuffer(rd)) {
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
        rd = Buffer2.from(rd, options.encoding);
      }
      return rd;
    });
    if (typeof options.relax_column_count === "boolean") ;
    else if (options.relax_column_count === void 0 || options.relax_column_count === null) {
      options.relax_column_count = false;
    } else {
      throw new Error(`Invalid Option: relax_column_count must be a boolean, got ${JSON.stringify(options.relax_column_count)}`);
    }
    if (typeof options.relax_column_count_less === "boolean") ;
    else if (options.relax_column_count_less === void 0 || options.relax_column_count_less === null) {
      options.relax_column_count_less = false;
    } else {
      throw new Error(`Invalid Option: relax_column_count_less must be a boolean, got ${JSON.stringify(options.relax_column_count_less)}`);
    }
    if (typeof options.relax_column_count_more === "boolean") ;
    else if (options.relax_column_count_more === void 0 || options.relax_column_count_more === null) {
      options.relax_column_count_more = false;
    } else {
      throw new Error(`Invalid Option: relax_column_count_more must be a boolean, got ${JSON.stringify(options.relax_column_count_more)}`);
    }
    if (typeof options.relax_quotes === "boolean") ;
    else if (options.relax_quotes === void 0 || options.relax_quotes === null) {
      options.relax_quotes = false;
    } else {
      throw new Error(`Invalid Option: relax_quotes must be a boolean, got ${JSON.stringify(options.relax_quotes)}`);
    }
    if (typeof options.skip_empty_lines === "boolean") ;
    else if (options.skip_empty_lines === void 0 || options.skip_empty_lines === null) {
      options.skip_empty_lines = false;
    } else {
      throw new Error(`Invalid Option: skip_empty_lines must be a boolean, got ${JSON.stringify(options.skip_empty_lines)}`);
    }
    if (typeof options.skip_records_with_empty_values === "boolean") ;
    else if (options.skip_records_with_empty_values === void 0 || options.skip_records_with_empty_values === null) {
      options.skip_records_with_empty_values = false;
    } else {
      throw new Error(`Invalid Option: skip_records_with_empty_values must be a boolean, got ${JSON.stringify(options.skip_records_with_empty_values)}`);
    }
    if (typeof options.skip_records_with_error === "boolean") ;
    else if (options.skip_records_with_error === void 0 || options.skip_records_with_error === null) {
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
  var isRecordEmpty = function(record) {
    return record.every((field) => field == null || field.toString && field.toString().trim() === "");
  };
  var cr = 13;
  var nl = 10;
  var boms = {
    // Note, the following are equals:
    // Buffer.from("\ufeff")
    // Buffer.from([239, 187, 191])
    // Buffer.from('EFBBBF', 'hex')
    "utf8": Buffer2.from([239, 187, 191]),
    // Note, the following are equals:
    // Buffer.from "\ufeff", 'utf16le
    // Buffer.from([255, 254])
    "utf16le": Buffer2.from([255, 254])
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
          recordDelimiterMaxLength === 0 ? Buffer2.from("\r\n", encoding).length : recordDelimiterMaxLength,
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
          buf = Buffer2.concat([previousBuf, nextBuf]);
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
          if ((chr === cr || chr === nl) && this.state.wasRowDelimiter === false) {
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
        const { columns, group_columns_by_name, encoding, info: info2, from: from2, relax_column_count, relax_column_count_less, relax_column_count_more, raw, skip_records_with_empty_values } = this.options;
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
        if (from2 === 1 || this.info.records >= from2) {
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
          Buffer2.from("\r\n", encoding),
          Buffer2.from("\n", encoding),
          Buffer2.from("\r", encoding)
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
  var Parser = class extends Transform {
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
      if (data === void 0 && (typeof argument === "string" || isBuffer(argument))) {
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
      const keys2 = Object.keys(parsed);
      if (keys2.length === 1 && keys2[0] === "trials" && Array.isArray(parsed.trials)) {
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
  function analyzeJoinKeys(parsedData, keys2) {
    if (parsedData.length === 0) {
      return { isUnique: true, duplicateCount: 0, duplicateValues: [], candidates: [], suggestedAdditionalKeys: null };
    }
    const compositeKeys = parsedData.map(
      (row) => keys2.map((k) => String(row[k] ?? "")).join("\0")
    );
    const keyCount = /* @__PURE__ */ new Map();
    for (const ck of compositeKeys) keyCount.set(ck, (keyCount.get(ck) ?? 0) + 1);
    const duplicateCount = [...keyCount.values()].reduce((n, c) => n + (c > 1 ? c - 1 : 0), 0);
    const isUnique = duplicateCount === 0;
    const duplicateValues = [];
    for (let i = 0; i < parsedData.length && duplicateValues.length < 5; i++) {
      if ((keyCount.get(compositeKeys[i]) ?? 0) > 1) {
        const vals = keys2.reduce((acc, k) => {
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
    const keySet = new Set(keys2);
    const allColumns = /* @__PURE__ */ new Set();
    for (const row of parsedData) for (const col of Object.keys(row)) allColumns.add(col);
    const candidateColumns = [...allColumns].filter(
      (col) => !isUnnamedHeader(col) && !keySet.has(col) && !SYSTEM_COLUMNS.has(col)
    );
    const candidates = candidateColumns.map((col) => {
      const extended = parsedData.map(
        (row) => [...keys2, col].map((k) => String(row[k] ?? "")).join("\0")
      );
      return { column: col, makesUnique: new Set(extended).size === parsedData.length };
    });
    if (candidates.some((c) => c.makesUnique)) {
      return { isUnique, duplicateCount, duplicateValues, candidates, suggestedAdditionalKeys: [] };
    }
    const workingKeys = [...keys2];
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
    const added = workingKeys.slice(keys2.length);
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
      const version2 = observation["plugin_version"] ? observation["plugin_version"] : null;
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
            await this.expandObjectFields(variable, value, pluginType, version2, joinValues, objectRow);
            const existingObjects = this.extractedObjects.get(variable) ?? [];
            existingObjects.push(objectRow);
            this.extractedObjects.set(variable, existingObjects);
          } else if (type === "array" || type === "object" && Array.isArray(value)) {
            await this.generateMetadata(variable, value, pluginType, version2);
            const existingVar = this.containsVariable(variable) ? this.getVariable(variable) : null;
            const existingType = existingVar?.value;
            if (existingType !== "string" && existingType !== "number" && existingType !== "boolean") {
              this.updateVariable(variable, "value", "array");
            }
            await this.accumulateArrayColumn(variable, value, joinValues, pluginType, version2);
          } else {
            await this.generateMetadata(variable, value, pluginType, version2);
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
    async generateMetadata(variable, value, pluginType, version2, extension) {
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
        const pluginInfo = await this.getPluginInfo(pluginType, variable, version2, extension);
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
    async expandObjectFields(parentName, obj, pluginType, version2, joinValues, row) {
      await this.generateMetadata(parentName, obj, pluginType, version2);
      for (const key of Object.keys(obj)) {
        const childName = `${parentName}.${key}`;
        const childValue = obj[key];
        if (row) row[childName] = childValue;
        if (childValue !== null && typeof childValue === "object" && !Array.isArray(childValue)) {
          await this.expandObjectFields(childName, childValue, pluginType, version2, joinValues, row);
        } else if (Array.isArray(childValue)) {
          await this.generateMetadata(childName, childValue, pluginType, version2);
          this.updateVariable(childName, "value", "array");
          await this.accumulateArrayColumn(childName, childValue, joinValues, pluginType, version2);
        } else {
          await this.generateMetadata(childName, childValue, pluginType, version2);
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
    async accumulateArrayColumn(columnName, arr, joinValues, pluginType, version2) {
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
          await this.expandElementFields(columnName, element, row, nestedJoin, pluginType, version2);
        } else {
          const valueName = `${columnName}.value`;
          row[valueName] = element;
          if (Array.isArray(element)) {
            await this.registerNodeVariable(valueName, element, "array", pluginType, version2);
            await this.accumulateArrayColumn(valueName, element, nestedJoin, pluginType, version2);
          } else {
            await this.registerScalarField(valueName, element, pluginType, version2);
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
    async expandElementFields(prefix, obj, row, nestedJoin, pluginType, version2) {
      for (const key of Object.keys(obj)) {
        const name = `${prefix}.${key}`;
        const value = obj[key];
        row[name] = value;
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
          await this.registerNodeVariable(name, value, "object", pluginType, version2);
          await this.expandElementFields(name, value, row, nestedJoin, pluginType, version2);
        } else if (Array.isArray(value)) {
          await this.registerNodeVariable(name, value, "array", pluginType, version2);
          await this.accumulateArrayColumn(name, value, nestedJoin, pluginType, version2);
        } else {
          await this.registerScalarField(name, value, pluginType, version2);
        }
      }
    }
    /** Registers an object/array node variable once (with its plugin description, if any). */
    async registerNodeVariable(name, value, type, pluginType, version2) {
      if (this.containsVariable(name) && this.getVariable(name).value !== "unknown") return;
      await this.generateMetadata(name, value, pluginType, version2);
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
    async registerScalarField(name, value, pluginType, version2) {
      if (value === null || value === void 0 || value === "" || value === "null") {
        if (!this.containsVariable(name)) {
          this.setVariable({ "@type": "PropertyValue", name, description: { default: "unknown" }, value: "unknown" });
        }
        return;
      }
      const type = typeof value;
      const needsRegister = !this.containsVariable(name) || this.getVariable(name).value === "unknown";
      if (needsRegister) {
        await this.generateMetadata(name, value, pluginType, version2);
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
    async getPluginInfo(pluginType, variableName, version2, extension) {
      return this.pluginCache.getPluginInfo(pluginType, variableName, version2, this.verbose, extension);
    }
  };
  return __toCommonJS(index_exports);
})();
this.JsPsychMetadata = this.JsPsychMetadata.default || this.JsPsychMetadata;
