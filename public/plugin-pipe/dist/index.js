import { ParameterType } from 'jspsych';

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise, SuppressedError, Symbol */


function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

const info = {
    name: "pipe",
    parameters: {
        /**
         * The 12-character experiment ID provided by pipe.jspsych.org.
         */
        experiment_id: {
            type: ParameterType.STRING,
            default: undefined,
        },
        /**
         * The action to take. Can be `"save"`, `"saveBase64"`, or `"condition"`.
         * If `"save"`, the data will be saved to the OSF.
         * If `"saveBase64"`, the data should be a base64-encoded string and will be decoded to binary before being saved to the OSF.
         * If `"condition"`, this will get the next condition for the experiment and save it in the data for this trial.
         */
        action: {
            type: ParameterType.STRING,
            default: undefined,
        },
        /**
         * Name of the file to create on the OSF. It should include the extension.
         * If the file already exists, no data will be saved.
         */
        filename: {
            type: ParameterType.STRING,
            default: null,
        },
        /**
         * A string-based representation of the data to save.
         *
         * To save JSON, you can use `()=>jsPsych.data.get().json()`.
         * To save CSV, you can use `()=>jsPsych.data.get().csv()`.
         *
         * The use of a function is necessary to get the updated data at
         * the time of saving.
         */
        data_string: {
            type: ParameterType.STRING,
            default: null,
        },
        /**
         * A string-based representation of the metadata to save if such metadata is not available for the experiment,
         * passed as a dynamic parameter.
         */
        metadataOptions: {
            type: ParameterType.OBJECT,
            default: null,
        },
        /**
         * An html message to be displayed above the loading graphics in the experiment during data save.
         */
        wait_message: {
            type: ParameterType.HTML_STRING,
            default: `<p>Saving data. Please do not close this page.</p>`
        }
    },
};
/**
 * **jsPsychPipe**
 *
 * This plugin facilitates communication with DataPipe (https://pipe.jspsych.org), a tool for
 * sending data from jsPsych experiments to the OSF (https://osf.io/). You will need a DataPipe
 * account to use this plugin.
 *
 * @author Josh de Leeuw
 * @see {@link https://DOCUMENTATION_URL DOCUMENTATION LINK TEXT}
 */
class PipePlugin {
    constructor(jsPsych) {
        this.jsPsych = jsPsych;
    }
    trial(display_element, trial) {
        this.run(display_element, trial);
    }
    run(display_element, trial) {
        return __awaiter(this, void 0, void 0, function* () {
            // show circular progress bar
            const progressCSS = `

      div.message {
        font-size: 25px;
        position: relative;
        bottom: 100px;
      }
      .spinner {
        animation: rotate 2s linear infinite;
        z-index: 2;
        position: absolute;
        top: 50%;
        left: 50%;
        margin: -25px 0 0 -25px;
        width: 50px;
        height: 50px;
      }
        
      .spinner .path {
        stroke: rgb(25,25,25);
        stroke-linecap: round;
        animation: dash 1.5s ease-in-out infinite;
      }

      @keyframes rotate {
        100% {
          transform: rotate(360deg);
        }
      }
      
      @keyframes dash {
        0% {
          stroke-dasharray: 1, 150;
          stroke-dashoffset: 0;
        }
        50% {
          stroke-dasharray: 90, 150;
          stroke-dashoffset: -35;
        }
        100% {
          stroke-dasharray: 90, 150;
          stroke-dashoffset: -124;
        }
      }
    `;
            const progressHTML = `
      <div class=message>${trial.wait_message}</div>
      <style>${progressCSS}</style>
      <svg class="spinner" viewBox="0 0 50 50">
        <circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle>
      </svg>`;
            display_element.innerHTML = progressHTML;
            let result;
            if (trial.action === "save") {
                result = yield PipePlugin.saveData(trial.experiment_id, trial.filename, trial.data_string, trial.metadataOptions);
            }
            if (trial.action === "saveBase64") {
                result = yield PipePlugin.saveBase64Data(trial.experiment_id, trial.filename, trial.data_string);
            }
            if (trial.action === "condition") {
                result = yield PipePlugin.getCondition(trial.experiment_id);
            }
            display_element.innerHTML = "";
            // data saving
            var trial_data = {
                result: result,
                success: result.error ? false : true,
            };
            // end trial
            this.jsPsych.finishTrial(trial_data);
        });
    }
    /**
     * Save data to the OSF using pipe.jspsych.org.
     *
     * @param expID The 12-character experiment ID provided by pipe.jspsych.org.
     * @param filename A unique filename to save the data to. It should include the extension.
     * @param data The data as a string. Any text-basd format (e.g., JSON, CSV, TXT) is acceptable.
     * @returns The response from the server.
     */
    static saveData(expID_1, filename_1, data_1) {
        return __awaiter(this, arguments, void 0, function* (expID, filename, data, options = null) {
            if (!expID || !filename || !data) {
                throw new Error("Missing required parameter(s).");
            }
            let response;
            try {
                response = yield fetch("http://127.0.0.1:5005/api/data/", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "*/*",
                    },
                    body: JSON.stringify({
                        experimentID: expID,
                        filename: filename,
                        data: data,
                        options: options
                    }),
                });
            }
            catch (error) {
                return error;
            }
            return yield response.json();
        });
    }
    /**
     * Save base64-encoded data to the OSF using pipe.jspsych.org.
     *
     * @param expID The 12-character experiment ID provided by pipe.jspsych.org.
     * @param filename A unique filename to save the data to. It should include the extension.
     * @param data The data as a base64-encoded string. It will be decoded by the server before being stored in the OSF.
     * @returns The response from the server.
     */
    static saveBase64Data(expID, filename, data) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!expID || !filename || !data) {
                throw new Error("Missing required parameter(s).");
            }
            let response;
            try {
                response = yield fetch("http://127.0.0.1:5005/api/base64/", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "*/*",
                    },
                    body: JSON.stringify({
                        experimentID: expID,
                        filename: filename,
                        data: data,
                    }),
                });
            }
            catch (error) {
                return error;
            }
            return yield response.json();
        });
    }
    /**
     * Get the condition assignment for the current participant using pipe.jspsych.org.
     *
     * @param expID The 12-character experiment ID provided by pipe.jspsych.org.
     * @returns The condition assignment as an integer.
     */
    static getCondition(expID) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!expID) {
                throw new Error("Missing required parameter(s).");
            }
            let response;
            try {
                response = yield fetch("http://127.0.0.1:5005/api/condition/", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "*/*",
                    },
                    body: JSON.stringify({
                        experimentID: expID,
                    }),
                });
            }
            catch (error) {
                return error;
            }
            const result = yield response.json();
            return result.condition;
        });
    }
}
PipePlugin.info = info;

export { PipePlugin as default };
//# sourceMappingURL=index.js.map
