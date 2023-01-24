/**
 * @jest-environment node
 */

describe.skip("getCondition", () => {
  it("should return a condition", async () => {
    const response = await fetch(
      "https://us-central1-datapipe-test.cloudfunctions.net/apiCondition",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "*/*",
        },
        body: JSON.stringify({
          experimentID: "4GbxQiLvfkDv",
        }),
      }
    );
    const condition = await response.text();
    expect(condition).toBe("condition");
  });
});
