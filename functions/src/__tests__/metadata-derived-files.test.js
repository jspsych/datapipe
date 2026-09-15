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

  // --- the untouched majority -------------------------------------------
  //
  // A name with no "/", "\" or "~" is passed through byte-for-byte. This is
  // the case for effectively every real submission, and it is what keeps the
  // stored filename recognisable to the researcher who chose it.

  it.each([
    'abc123.json',
    'my-file_2.json',
    'subject-01.csv',
    '50%.json',
    'a b (copy).json',
    'ünïcödé.json',
    '.hidden',
    'no-extension',
  ])('passes %s through byte-identical', (name) => {
    expect(rawDataPath(name)).toBe(`data/raw/${name}`);
  });

  // --- the flattened minority -------------------------------------------

  it('collapses researcher subfolders to hyphens and appends a disambiguating hash', () => {
    expect(rawDataPath('condition-A/abc123.json')).toBe('data/raw/condition-A-abc123~612613de.json');
    expect(rawDataPath('a/b/abc123.json')).toBe('data/raw/a-b-abc123~65b435d0.json');
  });

  it('inserts the hash before the extension, not after it', () => {
    expect(rawDataPath('condition-A/data.json')).toMatch(/^data\/raw\/condition-A-data~[0-9a-f]{8}\.json$/);
  });

  it('appends the hash at the end when the name has no extension', () => {
    expect(rawDataPath('nested/dir/archive')).toBe('data/raw/nested-dir-archive~c97f4ec2');
  });

  it('treats a leading dot as part of the name, not as an extension', () => {
    // ".psychds-ignore"-shaped names have their dot at index 0; the hash must
    // still land at the end rather than splitting the name in two.
    expect(rawDataPath('dir/.hidden')).toMatch(/^data\/raw\/dir-\.hidden~[0-9a-f]{8}$/);
  });

  it('is deterministic across calls', () => {
    expect(rawDataPath('condition-A/data.json')).toBe(rawDataPath('condition-A/data.json'));
  });

  it('normalises backslashes and repeated separators in the readable part', () => {
    expect(rawDataPath('a\\b.json')).toMatch(/^data\/raw\/a-b~[0-9a-f]{8}\.json$/);
    expect(rawDataPath('a//b.json')).toMatch(/^data\/raw\/a-b~[0-9a-f]{8}\.json$/);
  });

  // --- injectivity -------------------------------------------------------
  //
  // The property that matters: two DISTINCT submitted names must never reach
  // the same raw path, because that path is the collision-cache claim and a
  // shared claim means a legitimate submission is rejected as a duplicate.

  it('keeps two same-leaf-name submissions from different subfolders collision-free', () => {
    expect(rawDataPath('condition-A/data.json')).not.toBe(rawDataPath('condition-B/data.json'));
  });

  it('keeps a prefixed name distinct from its flattened look-alike', () => {
    // The regression that motivated the hash: under a bare "/" -> "-"
    // collapse these two produced the same path, so the second one to arrive
    // was rejected as a duplicate. The look-alike carries no "~", the
    // flattened name always does, so they can never meet.
    expect(rawDataPath('condition-A/data.json')).not.toBe(rawDataPath('condition-A-data.json'));
    expect(rawDataPath('condition-A-data.json')).toBe('data/raw/condition-A-data.json');
  });

  it('disambiguates separator variants that collapse to the same readable name', () => {
    const variants = ['a/b.json', 'a\\b.json', 'a//b.json', 'a/\\b.json'];
    expect(new Set(variants.map(rawDataPath)).size).toBe(variants.length);
  });

  it('disambiguates a submitted name that already contains the hash marker', () => {
    // "a~b.json" contains no separator but does contain "~", so it takes the
    // suffixed branch too -- otherwise it could pass through unchanged and
    // land on some slashed name's flattened output.
    expect(rawDataPath('a~b.json')).toBe('data/raw/a~b~fca59991.json');
    expect(rawDataPath('a~b.json')).not.toBe(rawDataPath('a/b.json'));
  });

  it('never lets a passed-through name collide with a flattened one', () => {
    // Structural guarantee, stated as a test: pass-through outputs contain no
    // "~" and flattened outputs always contain one, so the two sets are
    // disjoint by construction rather than by luck.
    const passedThrough = ['condition-A-data.json', 'a-b.json', 'abc123.json', '50%.json'];
    const flattened = ['condition-A/data.json', 'a/b.json', 'a\\b.json', 'x/abc123.json'];

    for (const name of passedThrough) expect(rawDataPath(name)).not.toContain('~');
    for (const name of flattened) expect(rawDataPath(name)).toContain('~');
  });

  it('maps a broad set of adversarial names to distinct paths', () => {
    const names = [
      'data.json',
      'condition-A/data.json',
      'condition-A-data.json',
      'condition-B/data.json',
      'a/b/data.json',
      'a/b-data.json',
      'a-b/data.json',
      'a-b-data.json',
      'a\\b\\data.json',
      'a//b//data.json',
      'a~b~data.json',
      '50%.json',
      '50%2F.json',
      'data',
      'dir/data',
    ];
    expect(new Set(names.map(rawDataPath)).size).toBe(names.length);
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

  it('encodes researcher subfolders into distinct, flat data/ filenames', () => {
    const flat = buildDerivedFiles('abc123.json', source());
    const nested = buildDerivedFiles('session1/abc123.json', source());

    expect(nested.map((f) => f.filename)).not.toEqual(flat.map((f) => f.filename));
    for (const file of nested.filter((f) => f.filename !== '.psychds-ignore')) {
      expect(file.filename).toContain('session1');
      expect(file.filename).not.toContain('/session1/');
    }
  });

  it('two submissions with the same leaf name in different subfolders no longer collide', () => {
    const a = buildDerivedFiles('condition-A/data.json', source());
    const b = buildDerivedFiles('condition-B/data.json', source());

    const aNames = new Set(a.map((f) => f.filename));
    const bNames = new Set(b.map((f) => f.filename));
    for (const name of aNames) {
      if (name === '.psychds-ignore') continue; // shared file, not a collision
      expect(bNames.has(name)).toBe(false);
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
