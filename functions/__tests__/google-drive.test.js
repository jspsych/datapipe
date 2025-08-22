import { jest } from '@jest/globals';
import putFileGoogleDrive from "../put-file-google-drive.js";

// Mock fetch for testing
global.fetch = jest.fn();

describe("Google Drive Integration", () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  test("putFileGoogleDrive should handle successful file upload", async () => {
    // Mock successful search (no existing file)
    fetch.mockResolvedValueOnce({
      status: 200,
      json: async () => ({ files: [] }),
    });

    // Mock successful upload
    fetch.mockResolvedValueOnce({
      status: 200,
      json: async () => ({ id: "test-file-id" }),
    });

    const result = await putFileGoogleDrive(
      "test-folder-id",
      "test-file.txt",
      "test data content",
      "test-access-token"
    );

    expect(result.success).toBe(true);
    expect(result.errorCode).toBeNull();
    expect(result.errorText).toBeNull();
  });

  test("putFileGoogleDrive should handle existing file conflict", async () => {
    // Mock search finding existing file
    fetch.mockResolvedValueOnce({
      status: 200,
      json: async () => ({ files: [{ id: "existing-file-id" }] }),
    });

    const result = await putFileGoogleDrive(
      "test-folder-id",
      "test-file.txt",
      "test data content",
      "test-access-token"
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(409);
    expect(result.errorText).toBe("Conflict - File already exists");
  });

  test("putFileGoogleDrive should handle search failure", async () => {
    // Mock search failure
    fetch.mockResolvedValueOnce({
      status: 500,
      statusText: "Internal Server Error",
    });

    const result = await putFileGoogleDrive(
      "test-folder-id",
      "test-file.txt",
      "test data content",
      "test-access-token"
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(500);
    expect(result.errorText).toContain("Failed to search for existing file");
  });

  test("putFileGoogleDrive should handle upload failure", async () => {
    // Mock successful search
    fetch.mockResolvedValueOnce({
      status: 200,
      json: async () => ({ files: [] }),
    });

    // Mock upload failure
    fetch.mockResolvedValueOnce({
      status: 400,
      text: async () => "Bad Request",
    });

    const result = await putFileGoogleDrive(
      "test-folder-id",
      "test-file.txt",
      "test data content",
      "test-access-token"
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(400);
    expect(result.errorText).toContain("Upload failed");
  });

  test("putFileGoogleDrive should handle network errors gracefully", async () => {
    // Mock network error
    fetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await putFileGoogleDrive(
      "test-folder-id",
      "test-file.txt",
      "test data content",
      "test-access-token"
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(500);
    expect(result.errorText).toContain("Internal error");
  });
});
