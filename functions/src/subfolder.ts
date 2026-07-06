import { OSFFile } from './interfaces';

/**
 * Resolves a single folder level inside an OSF osfstorage location and returns
 * that folder's WaterButler link. `parentUrl` is either the storage root URL
 * (exp_data.osfFilesLink) or a parent folder's link; the child folder named
 * `name` is listed and returned, or created if it does not exist.
 *
 * The returned link is itself a valid `parentUrl`, so calls chain to walk a
 * nested path one level at a time (WaterButler has no atomic deep-path create):
 *   const dataUrl = await resolveFolder(root,   token, 'data');
 *   const rawUrl  = await resolveFolder(dataUrl, token, 'raw');
 *
 * Folder creation treats a 409 Conflict as success: under concurrent
 * submissions two requests can both find the folder missing and race to create
 * it, so the loser re-lists and returns the folder the winner made.
 */
export default async function resolveFolder(
  parentUrl: string,
  osfToken: string,
  name: string,
): Promise<string> {
  const existing = await findChildFolder(parentUrl, osfToken, name);
  if (existing) return existing;

  const created = await fetch(`${parentUrl}?${new URLSearchParams({ kind: 'folder', name }).toString()}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${osfToken}`,
    },
  });

  if (created.ok) {
    const body = await created.json();
    const move = body?.data?.links?.move;
    if (!move) {
      throw new Error(`OSF subfolder creation response missing expected 'data.links.move' path`);
    }
    return move;
  }

  // Another concurrent submission created the folder between our list and PUT.
  if (created.status === 409) {
    const raced = await findChildFolder(parentUrl, osfToken, name);
    if (raced) return raced;
    throw new Error(`OSF folder '${name}' conflicted on creation but was not found on re-list`);
  }

  throw new Error(`Failed to create subfolder '${name}' in OSF (status ${created.status}: ${created.statusText})`);
}

/**
 * Lists the children of `parentUrl` and returns the `move` link of the child
 * folder named `name`, or null when no such folder exists. Matches on both name
 * and kind so a file sharing a folder's name is never mistaken for it.
 */
async function findChildFolder(parentUrl: string, osfToken: string, name: string): Promise<string | null> {
  const osfResult = await fetch(`${parentUrl}?meta=`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${osfToken}`,
    },
  });

  if (!osfResult.ok) {
    throw new Error(`Failed to list files in OSF folder (status ${osfResult.status}: ${osfResult.statusText})`);
  }

  const folder = await osfResult.json();
  const listOfFiles = folder['data'];

  if (!Array.isArray(listOfFiles)) {
    throw new Error("OSF component response did not contain a 'data' array");
  }

  const matches: OSFFile[] = listOfFiles.filter(
    (file) => file.attributes.name === name && file.attributes.kind === 'folder',
  );

  return matches.length === 0 ? null : matches[0].links.move;
}
