import { JsPsych, JsPsychPlugin, ParameterType, TrialType } from "jspsych";
declare const info: {
    readonly name: "pipe";
    readonly parameters: {
        /**
         * The 12-character experiment ID provided by pipe.jspsych.org.
         */
        readonly experiment_id: {
            readonly type: ParameterType.STRING;
            readonly default: any;
        };
        /**
         * The action to take. Can be `"save"`, `"saveBase64"`, or `"condition"`.
         * If `"save"`, the data will be saved to the OSF.
         * If `"saveBase64"`, the data should be a base64-encoded string and will be decoded to binary before being saved to the OSF.
         * If `"condition"`, this will get the next condition for the experiment and save it in the data for this trial.
         */
        readonly action: {
            readonly type: ParameterType.STRING;
            readonly default: any;
        };
        /**
         * Name of the file to create on the OSF. It should include the extension.
         * If the file already exists, no data will be saved.
         */
        readonly filename: {
            readonly type: ParameterType.STRING;
            readonly default: any;
        };
        /**
         * A string-based representation of the data to save.
         *
         * To save JSON, you can use `()=>jsPsych.data.get().json()`.
         * To save CSV, you can use `()=>jsPsych.data.get().csv()`.
         *
         * The use of a function is necessary to get the updated data at
         * the time of saving.
         */
        readonly data_string: {
            readonly type: ParameterType.STRING;
            readonly default: any;
        };
        /**
         * A string-based representation of the metadata to save if such metadata is not available for the experiment,
         * passed as a dynamic parameter.
         */
        readonly metadata_string: {
            readonly type: ParameterType.STRING;
            readonly default: any;
        };
    };
};
type Info = typeof info;
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
declare class PipePlugin implements JsPsychPlugin<Info> {
    private jsPsych;
    static info: {
        readonly name: "pipe";
        readonly parameters: {
            /**
             * The 12-character experiment ID provided by pipe.jspsych.org.
             */
            readonly experiment_id: {
                readonly type: ParameterType.STRING;
                readonly default: any;
            };
            /**
             * The action to take. Can be `"save"`, `"saveBase64"`, or `"condition"`.
             * If `"save"`, the data will be saved to the OSF.
             * If `"saveBase64"`, the data should be a base64-encoded string and will be decoded to binary before being saved to the OSF.
             * If `"condition"`, this will get the next condition for the experiment and save it in the data for this trial.
             */
            readonly action: {
                readonly type: ParameterType.STRING;
                readonly default: any;
            };
            /**
             * Name of the file to create on the OSF. It should include the extension.
             * If the file already exists, no data will be saved.
             */
            readonly filename: {
                readonly type: ParameterType.STRING;
                readonly default: any;
            };
            /**
             * A string-based representation of the data to save.
             *
             * To save JSON, you can use `()=>jsPsych.data.get().json()`.
             * To save CSV, you can use `()=>jsPsych.data.get().csv()`.
             *
             * The use of a function is necessary to get the updated data at
             * the time of saving.
             */
            readonly data_string: {
                readonly type: ParameterType.STRING;
                readonly default: any;
            };
            /**
             * A string-based representation of the metadata to save if such metadata is not available for the experiment,
             * passed as a dynamic parameter.
             */
            readonly metadata_string: {
                readonly type: ParameterType.STRING;
                readonly default: any;
            };
        };
    };
    constructor(jsPsych: JsPsych);
    trial(display_element: HTMLElement, trial: TrialType<Info>): void;
    private run;
    /**
     * Save data to the OSF using pipe.jspsych.org.
     *
     * @param expID The 12-character experiment ID provided by pipe.jspsych.org.
     * @param filename A unique filename to save the data to. It should include the extension.
     * @param data The data as a string. Any text-basd format (e.g., JSON, CSV, TXT) is acceptable.
     * @returns The response from the server.
     */
    static saveData(expID: string, filename: string, data: string, metadata: string): Promise<any>;
    /**
     * Save base64-encoded data to the OSF using pipe.jspsych.org.
     *
     * @param expID The 12-character experiment ID provided by pipe.jspsych.org.
     * @param filename A unique filename to save the data to. It should include the extension.
     * @param data The data as a base64-encoded string. It will be decoded by the server before being stored in the OSF.
     * @returns The response from the server.
     */
    static saveBase64Data(expID: string, filename: string, data: string): Promise<any>;
    /**
     * Get the condition assignment for the current participant using pipe.jspsych.org.
     *
     * @param expID The 12-character experiment ID provided by pipe.jspsych.org.
     * @returns The condition assignment as an integer.
     */
    static getCondition(expID: string): Promise<any>;
}
export default PipePlugin;
