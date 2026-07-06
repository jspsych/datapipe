import buildDerivedFiles, { rawDataPath } from '../../lib/metadata-derived-files.js';

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

const noExtraction = () => ({
  extractedArrays: new Map(),
  extractedObjects: new Map(),
  joinKeys: ['trial_index'],
});

const mainRows = () => ([
  { trial_index: 0, trial_type: 'survey-text' },
  { trial_index: 1, trial_type: 'mouse-tracking' },
]);

const source = (overrides = {}) => ({ ...extraction(), mainRows: mainRows(), ...overrides });

describe('rawDataPath', () => {
  it('places the original file under data/raw/', () => {
    expect(rawDataPath('abc123.json')).toBe('data/raw/abc123.json');
  });

  it('flattens researcher subfolders', () => {
    expect(rawDataPath('condition-A/abc123.json')).toBe('data/raw/abc123.json');
    expect(rawDataPath('a/b/abc123.json')).toBe('data/raw/abc123.json');
  });
});

describe('buildDerivedFiles', () => {
  it('always emits the main data CSV and .psychds-ignore, even with nothing extracted', () => {
    const files = buildDerivedFiles('abc123.json', source(noExtraction()));

    expect(files.map((f) => f.filename)).toEqual([
      'data/subject-abc123_data.csv',
      '.psychds-ignore',
    ]);
    const main = files[0];
    expect(main.content).toContain('trial_index');
    expect(main.content).toContain('survey-text');
  });

  it('excludes raw/ and itself from validation via .psychds-ignore', () => {
    const files = buildDerivedFiles('abc123.json', source(noExtraction()));
    const ignore = files.find((f) => f.filename === '.psychds-ignore');
    expect(ignore.content).toContain('**/raw/');
    expect(ignore.content).toContain('.psychds-ignore');
  });

  it('builds one Psych-DS-named sidecar CSV per extracted column, under data/', () => {
    const files = buildDerivedFiles('abc123.json', source());

    // main + 2 sidecars + ignore
    expect(files).toHaveLength(4);
    const sidecars = files.filter((f) => f.filename.includes('measure-'));
    expect(sidecars).toHaveLength(2);
    // Names come from the library's own Psych-DS helpers; pin the convention
    // (data/ placement, keyword-value pairs ending in _data.csv), not the spelling.
    for (const sidecar of sidecars) {
      expect(sidecar.filename).toMatch(/^data\/[^/]+_data\.csv$/);
    }
    expect(new Set(files.map((f) => f.filename)).size).toBe(4);
  });

  it('writes array rows with join keys and element_index leading', () => {
    const files = buildDerivedFiles('abc123.json', source());
    const arraySidecar = files.find((f) => f.filename.includes('mouseTracking'));

    const [header, ...rows] = arraySidecar.content.trim().split('\n');
    expect(header.startsWith('trial_index,element_index')).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('1,0');
    expect(arraySidecar.content).toContain('10');
  });

  it('writes object rows keyed by the join keys with dotted columns', () => {
    const files = buildDerivedFiles('abc123.json', source());
    const objectSidecar = files.find((f) => f.filename.includes('response'));

    const [header, ...rows] = objectSidecar.content.trim().split('\n');
    expect(header.startsWith('trial_index')).toBe(true);
    expect(header).toContain('response.Q0');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('hello');
  });

  it('flattens researcher subfolders into the same flat data/ layout', () => {
    const flat = buildDerivedFiles('abc123.json', source());
    const nested = buildDerivedFiles('session1/abc123.json', source());

    expect(nested.map((f) => f.filename)).toEqual(flat.map((f) => f.filename));
    for (const file of nested) {
      expect(file.filename).not.toContain('session1');
    }
  });

  it('keeps a CSV submission byte-verbatim via mainContent', () => {
    const csv = 'rt,trial_index\n250,0\n300,1\n';
    const files = buildDerivedFiles('abc.csv', source({ ...noExtraction(), mainContent: csv }));

    const main = files.find((f) => f.filename.endsWith('subject-abc_data.csv'));
    expect(main.content).toBe(csv);
  });

  it('handles filenames without an extension', () => {
    const files = buildDerivedFiles('test', source());
    expect(files.map((f) => f.filename)).toContain('data/subject-test_data.csv');
  });

  it('disambiguates columns that normalize to the same filename', () => {
    const rows = [{ trial_index: 0, a: 1 }];
    const files = buildDerivedFiles('abc.json', source({
      extractedArrays: new Map([['my_column', rows], ['my column', rows]]),
      extractedObjects: new Map(),
    }));
    const sidecars = files.filter((f) => f.filename.includes('measure-'));
    expect(sidecars).toHaveLength(2);
    expect(new Set(sidecars.map((s) => s.filename)).size).toBe(2);
  });
});
