// Import the function to test
import processMetadata from "../metadata-process.js";

// Mock the fetch function
global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({ data: [{ attributes: { name: 'dataset_description.json' }, id: 'osfstorage/123' }] }),
  })
);

describe('processMetadata', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  it('returns metadataId when default metadata file is found', async () => {
    const osfComponent = 'testComponent';
    const osfToken = 'testToken';

    

    const result = await processMetadata(osfComponent, osfToken);

    expect(result).toEqual({ success: true, errorCode: null, errorText: null, metadataId: '123' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns error when metadata file is not found', async () => {
    fetch.mockImplementationOnce(() => Promise.resolve({
      json: () => Promise.resolve({ data: [{ attributes: { name: 'other-file.json' }, id: 'osfstorage/123' }] }),
    }));

    const osfComponent = 'testComponent';
    const osfToken = 'testToken';

    const result = await processMetadata(osfComponent, osfToken);

    expect(result).toEqual({ success: false, errorCode: 404, errorText: 'Metadata file not found', metadataString: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});