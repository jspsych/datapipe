import updateMetadata from '../../lib/metadata-update.js';

const defaultBlock = {
    "name": "title",
    "schemaVersion": "Psych-DS 0.4.0",
    "description": "Dataset generated using JsPsych",
    "author": [],
  "variableMeasured": [
      {
        "type": "PropertyValue",
        "name": "trial_type",
        "description": "Plugin type that has been used to run trials",
        "value": "string"
      },
      {
        "type": "PropertyValue",
        "name": "trial_index",
        "description": "Position of trial in the timeline",
        "value": "numeric"
      },
      {
        "type": "PropertyValue",
        "name": "internal_node_id",
        "description": "Internal measurements of node",
        "value": "interval"
      }]
    } 

describe('updateMetadata', () => {
  it('should not update any default fields in the existing metadata', async () => {
    const existingMetadata = { "variableMeasured": [{ name: 'var1' }, { name: 'var2' }] };
    const newMetadata = defaultBlock ;

    const result = await updateMetadata(existingMetadata, newMetadata);

    expect(result).toEqual({ variableMeasured: [{ name: 'var1' }, { name: 'var2' }] });
  });
  it('should update the existing metadata with the new metadata', async () => {
    const existingMetadata = { "variableMeasured": [{ name: 'var1' }, { name: 'var2' }] };
    const newMetadata = { "variableMeasured": [{ name: 'var3' }] };

    const result = await updateMetadata(existingMetadata, newMetadata);

    expect(result).toEqual({ variableMeasured: [{ name: 'var1' }, { name: 'var2' }, { name: 'var3' }] });
  });

  it('should throw an error if the metadata cannot be parsed', async () => {
    const existingMetadata = 'invalid';
    const newMetadata = { variableMeasured: [{ name: 'var3' }] };

    await expect(updateMetadata(existingMetadata, newMetadata)).rejects.toThrow('Invalid metadata format');
  });

  it('should update the minValue of an existing variable with the minValue of a new variable', async () => {
    const existingMetadata = { variableMeasured: [{ name: 'var3', minValue: 3 }] };
    const newMetadata = { variableMeasured: [{ name: 'var3', minValue: 1 }] };

    const result = await updateMetadata(existingMetadata, newMetadata);
    
    expect(result).toEqual({ variableMeasured: [{ name: 'var3', minValue: 1 }] });
  });

  it('should not update the minValue if the new minValue is greater than the existing minValue', async () => {
    const existingMetadata = { variableMeasured: [{ name: 'var3', minValue: 5 }] };
    const newMetadata = { variableMeasured: [{ name: 'var3', minValue: 7 }] };

    const result = await updateMetadata(existingMetadata, newMetadata);

    expect(result).toEqual({ variableMeasured: [{ name: 'var3', minValue: 5 }] });
  });

  it('should update the maxValue of an existing variable with the maxValue of a new variable', async () => {
    const existingMetadata = { variableMeasured: [{ name: 'var3', maxValue: 5 }] };
    const newMetadata = { variableMeasured: [{ name: 'var3', maxValue: 7 }] };

    const result = await updateMetadata(existingMetadata, newMetadata);

    expect(result).toEqual({ variableMeasured: [{ name: 'var3', maxValue: 7 }] });
  });

  it('should not update the maxValue if the new maxValue is less than the existing maxValue', async () => {
    const existingMetadata = { variableMeasured: [{ name: 'var3', maxValue: 3 }] };
    const newMetadata = { variableMeasured: [{ name: 'var3', maxValue: 1 }] };

    const result = await updateMetadata(existingMetadata, newMetadata);

    expect(result).toEqual({ variableMeasured: [{ name: 'var3', maxValue: 3 }] });
  });

  it('should update the levels of an existing variable with the levels of a new variable', async () => {
    const existingMetadata = {variableMeasured: [{ name: 'var3', levels: ['level1', 'level2'] }]};
    const newMetadata = {variableMeasured: [{ name: 'var3', levels: ['level3'] }]};

    const result = await updateMetadata(existingMetadata, newMetadata);

    expect(result).toEqual({variableMeasured: [{ name: 'var3', levels: ['level1', 'level2', 'level3'] }]});
  });

  it('should not duplicate levels when updating', async () => {
    const existingMetadata = {variableMeasured: [{ name: 'var3', levels: ['level1', 'level2'] }]};
    const newMetadata = {variableMeasured: [{ name: 'var3', levels: ['level3', 'level2'] }]};

    const result = await updateMetadata(existingMetadata, newMetadata);

    expect(result).toEqual({variableMeasured: [{ name: 'var3', levels: ['level1', 'level2', 'level3'] }]});
  });
  it('variableMeasured should be the last property', async () => {
    const existingMetadata = {schemaVersion: "Psych-DS 0.4.0", "@type" : "Dataset", author: [], name: "title", variableMeasured: [{ name: 'var3', levels: ['level1', 'level2'] }]};
    const newMetadata = {schemaVersion: "Psych-DS 0.4.0", "@type" : "Dataset", author: [], name: "title",variableMeasured: [{ name: 'var3', levels: ['level3', 'level2'] }]};

    const result = await updateMetadata(existingMetadata, newMetadata);

    expect(result).toEqual({schemaVersion: "Psych-DS 0.4.0", "@type" : "Dataset", author: [], name: "title", variableMeasured: [{ name: 'var3', levels: ['level1', 'level2', 'level3'] }]});
  });
});