import produceMetadata from '../../lib/metadata-production.js';


var sampleData = `[{
  "trial_type": "html-keyboard-response",
  "trial_index": 1,
  "time_elapsed": 776
}]`

// Golden output from the vendored @jspsych/metadata (functions/metadata/).
// NOTE: the data-derived fields below (trial_type.levels, the min/max values) are what make
// this a regression guard, not just a format check: produceMetadata pre-parses the JSON into
// an array before calling generate(). If a future `npm run sync:metadata` ever pulls a build
// whose generate() rejects a pre-parsed array (an earlier published version did — it silently
// returned only the empty default template), these levels/min/max would disappear and this
// toEqual would fail. Keep the derived values in the expectation.
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
        "@type": "PropertyValue",
        "description": "The name of the plugin used to run the trial.",
        "levels": ["html-keyboard-response"],
        "name": "trial_type",
        "value": "string"
      },

      {
        "@type": "PropertyValue",
        "description": "The index of the current trial across the whole experiment.",
        "maxValue": 1, "minValue": 1,
        "name": "trial_index",
        "value": "number"
      },

      {
        "@type": "PropertyValue",
        "description": "The number of milliseconds between the start of the experiment and when the trial ended.",
        "maxValue": 776,
        "minValue": 776,
        "name": "time_elapsed",
        "value": "number"
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

    // Build the expectation from a deep copy so we don't mutate the shared sampleMetadata
    // fixture used by the test above (the previous version aliased it).
    const optionMetadata = structuredClone(sampleMetadata);
    optionMetadata.randomField = "this is a field";

    expect(result).toEqual(optionMetadata);
  });
});
