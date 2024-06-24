import produceMetadata from '../metadata-production.js';
import jsPsychMetadata from '@jspsych/metadata';
// import sampleData from './sample-data.json';
// import sampleMetadata from './sample-metadata.json';

//jest.mock('@jspsych/metadata');

var sampleData = [{
  "trial_type": "html-keyboard-response",
  "trial_index": 1,
  "time_elapsed": 776
}]

var sampleMetadata =
  {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "author": [],
    "description": "Dataset generated using JsPsych",
    "name": "title",
    "schemaVersion": "Psych-DS 0.4.0",
    "variableMeasured": [
      {
        "description": "The name of the plugin used to run the trial.",
        "levels": ["html-keyboard-response"],
        "name": "trial_type",
        "type": "PropertyValue",
        "value": "string"
      },

      {
        "description": "The index of the current trial across the whole experiment.",
        "maxValue": 1, "minValue": 1,
        "name": "trial_index",
        "type": "PropertyValue",
        "value": "numeric"
      },

      {
        "description": "The number of milliseconds between the start of the experiment and when the trial ended.",
        "maxValue": 776,
        "minValue": 776,
        "name": "time_elapsed",
        "type": "PropertyValue",
        "value": "numeric"
      }
    ]
  }



describe('produceMetadata', () => {
  it('should generate metadata with default options if none are provided', async () => {

    const result = await produceMetadata(sampleData);

    expect(result).toEqual(sampleMetadata);
  });

  it('should generate metadata with provided options', async () => {
    const options = { randomField: "this is a field" };

    const result = await produceMetadata(sampleData, options);
    
    //console.log(result);

    const optionMetadata = sampleMetadata;
    optionMetadata.randomField = "this is a field"

    expect(result).toEqual(optionMetadata);
  });
});