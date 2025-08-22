import { jest } from '@jest/globals';
import { 
  getGoogleDriveAccessToken, 
  generateGoogleDriveAuthUrl, 
  exchangeCodeForTokens 
} from "../google-drive-auth.js";

// Mock environment variables
const originalEnv = process.env;

describe("Google Drive Authentication", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    
    // Set up test environment variables
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    process.env.GOOGLE_REDIRECT_URI = "https://test.com/callback";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("generateGoogleDriveAuthUrl", () => {
    test("should generate correct OAuth URL", () => {
      const authUrl = generateGoogleDriveAuthUrl();
      
      expect(authUrl).toContain("https://accounts.google.com/o/oauth2/v2/auth");
      expect(authUrl).toContain("client_id=test-client-id");
      expect(authUrl).toContain("redirect_uri=https://test.com/callback");
      expect(authUrl).toContain("scope=https://www.googleapis.com/auth/drive.file");
      expect(authUrl).toContain("response_type=code");
      expect(authUrl).toContain("access_type=offline");
    });

    test("should include all required scopes", () => {
      const authUrl = generateGoogleDriveAuthUrl();
      
      expect(authUrl).toContain("https://www.googleapis.com/auth/drive.file");
      expect(authUrl).toContain("https://www.googleapis.com/auth/drive.metadata.readonly");
    });
  });

  describe("exchangeCodeForTokens", () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    test("should successfully exchange code for tokens", async () => {
      const mockResponse = {
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        expires_in: 3600,
      };

      global.fetch.mockResolvedValueOnce({
        status: 200,
        json: async () => mockResponse,
      });

      const result = await exchangeCodeForTokens("test-auth-code");

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://oauth2.googleapis.com/token",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: expect.stringContaining("code=test-auth-code"),
        })
      );
    });

    test("should handle exchange failure", async () => {
      global.fetch.mockResolvedValueOnce({
        status: 400,
        statusText: "Bad Request",
      });

      await expect(exchangeCodeForTokens("invalid-code")).rejects.toThrow(
        "Code exchange failed: Failed to exchange code for tokens: Bad Request"
      );
    });

    test("should handle network errors", async () => {
      global.fetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(exchangeCodeForTokens("test-code")).rejects.toThrow(
        "Code exchange failed: Network error"
      );
    });
  });

  describe("getGoogleDriveAccessToken", () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    test("should successfully refresh access token", async () => {
      const mockResponse = {
        access_token: "new-access-token",
        expires_in: 3600,
      };

      global.fetch.mockResolvedValueOnce({
        status: 200,
        json: async () => mockResponse,
      });

      const result = await getGoogleDriveAccessToken("test-refresh-token");

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://oauth2.googleapis.com/token",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: expect.stringContaining("refresh_token=test-refresh-token"),
        })
      );
    });

    test("should handle refresh failure", async () => {
      global.fetch.mockResolvedValueOnce({
        status: 400,
        statusText: "Bad Request",
      });

      await expect(getGoogleDriveAccessToken("invalid-refresh-token")).rejects.toThrow(
        "Token refresh failed: Failed to refresh token: Bad Request"
      );
    });

    test("should handle network errors during refresh", async () => {
      global.fetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(getGoogleDriveAccessToken("test-refresh-token")).rejects.toThrow(
        "Token refresh failed: Network error"
      );
    });
  });
});
