import fetch from "node-fetch";
import putFileOSF from "../put-file-osf.js";
import updateFileOSF from "../update-file-osf.js";
import { db } from "../app.js";
import { decrypt } from "../crypto-utils.js";
import { refreshAndUpdateUser } from "../refresh-token.js";
import { OSFFile, UserData } from "../interfaces.js";
import {
  StorageProvider,
  ResolvedAuth,
  ContainerRef,
  FileRef,
  FileMeta,
  WriteResult,
  DownloadResult,
  ProviderErrorCode,
  TokenResult,
} from "./types.js";

// The OSF container ref shape — only the filesLink is meaningful to this adapter.
export interface OSFContainerRef extends ContainerRef {
  provider: "osf";
  filesLink: string;
}

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function hasValidPAT(user_data: UserData): boolean {
  return user_data.osfTokenValid && !!user_data.osfToken;
}

function mapStatus(errorCode: number | null): ProviderErrorCode {
  switch (errorCode) {
    case 409:
      return "NAME_CONFLICT";
    case 401:
    case 403:
      return "AUTH_EXPIRED";
    case 429:
      return "RATE_LIMITED";
    case 507:
      return "QUOTA_EXCEEDED";
    default:
      return "UNAVAILABLE";
  }
}

export const osfProvider: StorageProvider = {
  id: "osf",
  authMethod: "oauth2",
  capabilities: {
    nativeSubfolders: true,
    supportsRegion: true,
    maxFileSizeBytes: null,
    quotaNote: null,
  },

  async resolveToken(user_data: UserData, owner: string): Promise<TokenResult> {
    if (user_data.usingPersonalToken) {
      if (!user_data.osfTokenValid) {
        return { success: false, error: "INVALID_OSF_TOKEN", detail: "The OSF token for this experiment is not valid" };
      }
      return { success: true, token: decrypt(user_data.osfToken) };
    }

    // OAuth path
    if (Date.now() > user_data.authTokenExpires) {
      const refreshResult = await refreshAndUpdateUser(owner, decrypt(user_data.refreshToken));

      if (!refreshResult.success) {
        // Fall back to PAT if available
        if (hasValidPAT(user_data)) {
          return { success: true, token: decrypt(user_data.osfToken) };
        }
        return { success: false, error: "INVALID_REFRESH_TOKEN", detail: refreshResult.error || "Refresh token is not valid" };
      }

      return { success: true, token: refreshResult.accessToken! };
    }

    return { success: true, token: decrypt(user_data.authToken) };
  },

  /**
   * Proactively refreshes OAuth tokens for users whose refresh tokens are
   * approaching expiration (default 2 weeks).
   *
   * This prevents token expiration for researchers with active experiments
   * who may not have logged in recently. Each successful refresh obtains
   * a new refresh token (via rotation), resetting the 1-month expiration window.
   */
  async refreshExpiringTokens(windowMs: number = TWO_WEEKS_MS): Promise<void> {
    const now = Date.now();
    const expirationThreshold = now + windowMs;

    // Find OAuth users whose refresh tokens expire within the next 2 weeks
    // OR have already passed their estimated expiration. We still attempt
    // to refresh "expired" tokens because the expiration is our estimate —
    // only a failed refresh confirms the token is truly dead.
    const usersSnapshot = await db
      .collection("users")
      .where("usingPersonalToken", "==", false)
      .where("refreshTokenExpires", "<=", expirationThreshold)
      .get();

    if (usersSnapshot.empty) {
      console.log("No tokens approaching expiration. Nothing to refresh.");
      return;
    }

    console.log(`Found ${usersSnapshot.size} user(s) with tokens approaching or past estimated expiration.`);

    let successCount = 0;
    let failCount = 0;

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data() as UserData;
      const userId = userDoc.id;

      if (!userData.refreshToken) {
        console.warn(`User ${userId} has no refresh token, skipping.`);
        continue;
      }

      try {
        const result = await refreshAndUpdateUser(userId, decrypt(userData.refreshToken));

        if (result.success) {
          console.log(`Successfully refreshed token for user ${userId}.`);
          successCount++;
        } else {
          console.error(`Failed to refresh token for user ${userId}: ${result.error}`);
          failCount++;
        }
      } catch (error) {
        console.error(`Error refreshing token for user ${userId}:`, error);
        failCount++;
      }
    }

    console.log(
      `Token refresh complete. Success: ${successCount}, Failed: ${failCount}`
    );
  },

  async createDataContainer(): Promise<ContainerRef> {
    throw new Error("osfProvider.createDataContainer is not implemented");
  },

  async writeSessionFile(
    auth: ResolvedAuth,
    container: ContainerRef,
    filename: string,
    data: string | Buffer,
    _meta: FileMeta
  ): Promise<WriteResult> {
    const osfContainer = container as OSFContainerRef;

    const result = await putFileOSF(osfContainer.filesLink, auth.token, data, filename);

    if (result.success) {
      const storedFilename = result.fileName ?? filename;
      return {
        success: true,
        fileRef: { name: storedFilename, id: result.fileId },
        storedFilename,
      };
    }

    return {
      success: false,
      error: mapStatus(result.errorCode),
      providerStatus: result.errorCode,
      providerMessage: result.errorText,
      retryAfter: result.retryAfter,
    };
  },

  async updateFile(
    auth: ResolvedAuth,
    container: ContainerRef,
    existingFileRef: FileRef,
    data: string | Buffer,
    _meta: FileMeta
  ): Promise<WriteResult> {
    const osfContainer = container as OSFContainerRef;

    // updateFileOSF throws on non-200 responses — let the throw propagate,
    // callers rely on this behavior.
    await updateFileOSF(osfContainer.filesLink, auth.token, data as string, existingFileRef.id as string);

    return {
      success: true,
      fileRef: existingFileRef,
      storedFilename: existingFileRef.name,
    };
  },

  async listFiles(auth: ResolvedAuth, container: ContainerRef): Promise<FileRef[]> {
    const osfContainer = container as OSFContainerRef;

    const osfResult = await fetch(`${osfContainer.filesLink}?meta=`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
    });

    const folder = (await osfResult.json()) as { data: OSFFile[] };
    const listOfFiles: OSFFile[] = folder["data"];

    return listOfFiles
      .filter((file) => file.attributes.kind === "file")
      .map((file) => ({ name: file.attributes.name, id: file.id }));
  },

  async downloadFile(
    auth: ResolvedAuth,
    container: ContainerRef,
    fileRef: FileRef
  ): Promise<DownloadResult> {
    const osfContainer = container as OSFContainerRef;

    const response = await fetch(`${osfContainer.filesLink}${fileRef.id}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });

    if (response.status !== 200) {
      return {
        success: false,
        error: mapStatus(response.status),
        providerStatus: response.status,
        providerMessage: response.statusText,
      };
    }

    const content = await response.text();
    return { success: true, content };
  },
};
