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

    expect(result.metadata).toEqual(sampleMetadata);
  });

  it('should generate metadata with provided options', async () => {
    const options = { randomField: "this is a field" };

    const result = await produceMetadata(sampleData, options);

    // Build the expectation from a deep copy so we don't mutate the shared sampleMetadata
    // fixture used by the test above (the previous version aliased it).
    const optionMetadata = structuredClone(sampleMetadata);
    optionMetadata.randomField = "this is a field";

    expect(result.metadata).toEqual(optionMetadata);
  });

  it('should report no extracted columns for flat data', async () => {
    const result = await produceMetadata(sampleData);

    expect(result.extractedArrays.size).toBe(0);
    expect(result.extractedObjects.size).toBe(0);
    expect(result.joinKeys).toEqual(['trial_index']);
  });

  it('should surface the parsed main rows for JSON data', async () => {
    const result = await produceMetadata(sampleData);

    expect(Array.isArray(result.mainRows)).toBe(true);
    expect(result.mainRows).toHaveLength(1);
    expect(result.mainRows[0]).toMatchObject({
      trial_type: 'html-keyboard-response',
      trial_index: 1,
      time_elapsed: 776,
    });
    // JSON submissions have no verbatim CSV to preserve.
    expect(result.mainContent).toBeUndefined();
  });

  it('should unwrap a nonstandard { "trials": [...] } submission like the CLI does', async () => {
    const wrapped = `{"trials": ${sampleData}}`;

    const bare = await produceMetadata(sampleData);
    const result = await produceMetadata(wrapped);

    // Parity with the library's parseJsonData: the wrapper is unwrapped, so
    // metadata and main rows match the bare-array submission exactly.
    expect(result.metadata).toEqual(bare.metadata);
    expect(result.mainRows).toEqual(bare.mainRows);
  });

  it('should parse CSV submissions into main rows', async () => {
    const csv = 'trial_index,rt\n0,250\n1,300';
    const result = await produceMetadata(csv);

    expect(result.mainRows).toHaveLength(2);
    // parseCSV treats every cell as a string (columns:true, no coercion).
    expect(result.mainRows[0]).toMatchObject({ trial_index: '0', rt: '250' });
    expect(result.mainRows[1]).toMatchObject({ trial_index: '1', rt: '300' });
    // The original text is surfaced verbatim so the main data CSV can keep
    // its exact bytes (column order, quoting).
    expect(result.mainContent).toBe(csv);
  });

  it('should extract nested object and array columns with per-row data', async () => {
    const nestedData = JSON.stringify([
      {
        trial_type: "survey-text",
        trial_index: 0,
        time_elapsed: 500,
        response: { Q0: "hello", Q1: "world" },
      },
      {
        trial_type: "mouse-tracking",
        trial_index: 1,
        time_elapsed: 900,
        mouse_tracking_data: [
          { x: 1, y: 2, t: 10 },
          { x: 3, y: 4, t: 20 },
        ],
      },
    ]);

    const result = await produceMetadata(nestedData);

    // The nested columns are expanded into dotted sub-variables...
    const variableNames = result.metadata.variableMeasured.map((v) => v.name);
    expect(variableNames).toEqual(expect.arrayContaining([
      'response.Q0', 'response.Q1',
      'mouse_tracking_data.x', 'mouse_tracking_data.y', 'mouse_tracking_data.t',
    ]));

    // ...and their per-row data is available for sidecar CSVs.
    expect([...result.extractedObjects.keys()]).toEqual(['response']);
    expect([...result.extractedArrays.keys()]).toEqual(['mouse_tracking_data']);

    const arrayRows = result.extractedArrays.get('mouse_tracking_data');
    expect(arrayRows).toHaveLength(2);
    expect(arrayRows[0]).toMatchObject({
      trial_index: 1,
      element_index: 0,
      'mouse_tracking_data.x': 1,
      'mouse_tracking_data.y': 2,
      'mouse_tracking_data.t': 10,
    });

    const objectRows = result.extractedObjects.get('response');
    expect(objectRows).toHaveLength(1);
    expect(objectRows[0]).toMatchObject({ trial_index: 0, 'response.Q0': 'hello', 'response.Q1': 'world' });
  });
});
