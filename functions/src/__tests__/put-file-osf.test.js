import putFileOSF from '../../lib/put-file-osf.js';

const ROOT = 'https://files.osf.io/v1/resources/abc/providers/osfstorage/';
const TOKEN = 'test-token';

// The WaterButler link a folder resolves to; used both as the returned link and
// as the parent URL for the next level down.
const move = (name) => `https://files.osf.io/v1/folder/${name}/`;

// GET ?meta= listing containing the named child folders.
const listing = (folderNames) => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({
    data: folderNames.map((n) => ({ attributes: { name: n, kind: 'folder' }, links: { move: move(n) } })),
  }),
});
// Successful folder-create PUT.
const folderCreated = (name) => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({ data: { links: { move: move(name) } } }),
});
// Folder-create PUT that conflicts (another submission made it first).
const conflict = () => Promise.resolve({ ok: false, status: 409, statusText: 'Conflict' });
// File-upload PUT outcomes (put-file-osf checks status === 201, not ok).
const fileOk = () => Promise.resolve({ status: 201 });
const fileFail = (status, statusText, retryAfter = null) => Promise.resolve({
  status,
  statusText,
  headers: { get: (h) => (h === 'Retry-After' ? retryAfter : null) },
});

const callUrls = () => fetch.mock.calls.map((c) => c[0]);

beforeEach(() => {
  global.fetch = jest.fn();
});

describe('putFileOSF', () => {
  it('uploads a bare filename straight to the storage root', async () => {
    fetch.mockReturnValueOnce(fileOk());

    const result = await putFileOSF(ROOT, TOKEN, 'hello', 'subject01.csv');

    expect(result).toEqual({ success: true, errorCode: null, errorText: null });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${ROOT}?kind=file&name=subject01.csv`);
    expect(opts.method).toBe('PUT');
    expect(opts.body).toBe('hello');
  });

  it('uploads into an existing one-level subfolder', async () => {
    fetch
      .mockReturnValueOnce(listing(['session1', 'other']))
      .mockReturnValueOnce(fileOk());

    const result = await putFileOSF(ROOT, TOKEN, 'data', 'session1/abc.json');

    expect(result.success).toBe(true);
    expect(callUrls()).toEqual([
      `${ROOT}?meta=`,
      `${move('session1')}?kind=file&name=abc.json`,
    ]);
  });

  it('creates a missing one-level subfolder before uploading', async () => {
    fetch
      .mockReturnValueOnce(listing([]))
      .mockReturnValueOnce(folderCreated('session1'))
      .mockReturnValueOnce(fileOk());

    await putFileOSF(ROOT, TOKEN, 'data', 'session1/abc.json');

    expect(callUrls()).toEqual([
      `${ROOT}?meta=`,
      `${ROOT}?kind=folder&name=session1`,
      `${move('session1')}?kind=file&name=abc.json`,
    ]);
    expect(fetch.mock.calls[1][1].method).toBe('PUT');
  });

  it('walks and creates a two-level path (data/raw/)', async () => {
    fetch
      .mockReturnValueOnce(listing([]))            // root has no data/
      .mockReturnValueOnce(folderCreated('data'))
      .mockReturnValueOnce(listing([]))            // data/ has no raw/
      .mockReturnValueOnce(folderCreated('raw'))
      .mockReturnValueOnce(fileOk());

    await putFileOSF(ROOT, TOKEN, '{}', 'data/raw/abc123.json');

    expect(callUrls()).toEqual([
      `${ROOT}?meta=`,
      `${ROOT}?kind=folder&name=data`,
      `${move('data')}?meta=`,
      `${move('data')}?kind=folder&name=raw`,
      `${move('raw')}?kind=file&name=abc123.json`,
    ]);
  });

  it('walks an existing two-level path without creating folders', async () => {
    fetch
      .mockReturnValueOnce(listing(['data']))
      .mockReturnValueOnce(listing(['raw']))
      .mockReturnValueOnce(fileOk());

    await putFileOSF(ROOT, TOKEN, '{}', 'data/raw/abc123.json');

    expect(callUrls()).toEqual([
      `${ROOT}?meta=`,
      `${move('data')}?meta=`,
      `${move('raw')}?kind=file&name=abc123.json`,
    ]);
  });

  it('treats a 409 on folder creation as already-exists and re-resolves', async () => {
    fetch
      .mockReturnValueOnce(listing([]))            // not found on first list
      .mockReturnValueOnce(conflict())             // create loses the race
      .mockReturnValueOnce(listing(['session1']))  // re-list finds the winner's folder
      .mockReturnValueOnce(fileOk());

    const result = await putFileOSF(ROOT, TOKEN, 'data', 'session1/abc.json');

    expect(result.success).toBe(true);
    expect(callUrls()).toEqual([
      `${ROOT}?meta=`,
      `${ROOT}?kind=folder&name=session1`,
      `${ROOT}?meta=`,
      `${move('session1')}?kind=file&name=abc.json`,
    ]);
  });

  it('returns the OSF error when the file upload fails', async () => {
    fetch.mockReturnValueOnce(fileFail(409, 'Conflict'));

    const result = await putFileOSF(ROOT, TOKEN, 'data', 'dup.json');

    expect(result).toEqual({ success: false, errorCode: 409, errorText: 'Conflict', retryAfter: null });
  });

  it('parses Retry-After on a throttled upload', async () => {
    fetch.mockReturnValueOnce(fileFail(503, 'Service Unavailable', '30'));

    const result = await putFileOSF(ROOT, TOKEN, 'data', 'x.json');

    expect(result).toEqual({ success: false, errorCode: 503, errorText: 'Service Unavailable', retryAfter: 30 });
  });

  it('throws when a folder listing request fails', async () => {
    fetch.mockReturnValueOnce(Promise.resolve({ ok: false, status: 500, statusText: 'Server Error' }));

    await expect(putFileOSF(ROOT, TOKEN, 'd', 'session1/a.json')).rejects.toThrow(/Failed to list files/);
  });

  it('throws when a 409 folder conflict cannot be re-resolved', async () => {
    fetch
      .mockReturnValueOnce(listing([]))
      .mockReturnValueOnce(conflict())
      .mockReturnValueOnce(listing([])); // still not there on re-list

    await expect(putFileOSF(ROOT, TOKEN, 'd', 'session1/a.json')).rejects.toThrow(/conflicted on creation/);
  });
});
