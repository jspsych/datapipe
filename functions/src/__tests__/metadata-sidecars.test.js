import buildSidecars from '../../lib/metadata-sidecars.js';

const extraction = () => ({
  extractedArrays: new Map([
    ['mouse_tracking_data', [
      { trial_index: 1, element_index: 0, x: 1, y: 2, t: 10 },
      { trial_index: 1, element_index: 1, x: 3, y: 4, t: 20 },
    ]],
  ]),
  extractedObjects: new Map([
    ['response', [
      { trial_index: 0, 'response.Q0': 'hello', 'response.Q1': 'world' },
    ]],
  ]),
  joinKeys: ['trial_index'],
});

// The main table rows produceMetadata surfaces; buildSidecars only serialises
// nested columns, so the exact main rows don't affect the sidecar assertions.
const mainRows = () => ([
  { trial_index: 0, trial_type: 'survey-text' },
  { trial_index: 1, trial_type: 'mouse-tracking' },
]);

describe('buildSidecars', () => {
  it('returns no sidecars when nothing was extracted', () => {
    const sidecars = buildSidecars('data.json', {
      extractedArrays: new Map(),
      extractedObjects: new Map(),
      joinKeys: ['trial_index'],
    }, mainRows());
    expect(sidecars).toEqual([]);
  });

  it('builds one Psych-DS-named CSV per extracted column', () => {
    const sidecars = buildSidecars('abc123.json', extraction(), mainRows());

    expect(sidecars).toHaveLength(2);
    const filenames = sidecars.map((s) => s.filename);
    // Names come from the library's own Psych-DS helpers; pin the convention
    // (keyword-value pairs ending in _data.csv), not the exact spelling.
    for (const filename of filenames) {
      expect(filename).toMatch(/_data\.csv$/);
      expect(filename).toContain('measure-');
    }
    expect(new Set(filenames).size).toBe(2);
  });

  it('writes array rows with join keys and element_index leading', () => {
    const sidecars = buildSidecars('abc123.json', extraction(), mainRows());
    const arraySidecar = sidecars[0];

    const [header, ...rows] = arraySidecar.content.trim().split('\n');
    expect(header.startsWith('trial_index,element_index')).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('1,0');
    expect(arraySidecar.content).toContain('10');
  });

  it('writes object rows keyed by the join keys with dotted columns', () => {
    const sidecars = buildSidecars('abc123.json', extraction(), mainRows());
    const objectSidecar = sidecars[1];

    const [header, ...rows] = objectSidecar.content.trim().split('\n');
    expect(header.startsWith('trial_index')).toBe(true);
    expect(header).toContain('response.Q0');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('hello');
  });

  it('places sidecars in the same one-level subfolder as the data file', () => {
    const sidecars = buildSidecars('session1/abc123.json', extraction(), mainRows());
    for (const sidecar of sidecars) {
      expect(sidecar.filename.startsWith('session1/')).toBe(true);
      expect(sidecar.filename.slice('session1/'.length)).not.toContain('/');
    }
  });

  it('handles filenames without an extension', () => {
    const sidecars = buildSidecars('test', extraction(), mainRows());
    expect(sidecars).toHaveLength(2);
    for (const sidecar of sidecars) {
      expect(sidecar.filename).toMatch(/_data\.csv$/);
    }
  });

  it('disambiguates columns that normalize to the same filename', () => {
    const rows = [{ trial_index: 0, a: 1 }];
    const sidecars = buildSidecars('abc.json', {
      extractedArrays: new Map([['my_column', rows], ['my column', rows]]),
      extractedObjects: new Map(),
      joinKeys: ['trial_index'],
    }, mainRows());
    expect(sidecars).toHaveLength(2);
    expect(new Set(sidecars.map((s) => s.filename)).size).toBe(2);
  });
});
