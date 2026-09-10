import { describe, expect, it } from "vitest";
import { generateJoinCode, hashPin, timingSafeEquals, verifyPin } from "../crypto";

describe("timingSafeEquals", () => {
  it("accepts an exact match", () => {
    expect(timingSafeEquals("correct-horse", "correct-horse")).toBe(true);
  });

  it("rejects a mismatch of the same length", () => {
    expect(timingSafeEquals("correct-horse", "correct-house")).toBe(false);
  });

  it("rejects a different length without throwing", () => {
    // timingSafeEqual itself throws on unequal lengths; this must not.
    expect(timingSafeEquals("short", "considerably longer")).toBe(false);
    expect(timingSafeEquals("", "x")).toBe(false);
  });

  it("rejects a prefix, so a partial key is not enough", () => {
    expect(timingSafeEquals("correct", "correct-horse")).toBe(false);
  });
});

describe("PIN hashing", () => {
  it("accepts the right PIN and rejects a wrong one", () => {
    const stored = hashPin("4821");
    expect(verifyPin("4821", stored)).toBe(true);
    expect(verifyPin("4822", stored)).toBe(false);
    expect(verifyPin("", stored)).toBe(false);
  });

  it("salts, so the same PIN hashes differently every time", () => {
    expect(hashPin("4821")).not.toBe(hashPin("4821"));
  });

  it("never stores the PIN itself", () => {
    expect(hashPin("4821")).not.toContain("4821");
  });

  it("rejects a malformed stored value instead of throwing", () => {
    expect(verifyPin("4821", "")).toBe(false);
    expect(verifyPin("4821", "notascheme$abc$def")).toBe(false);
  });
});

describe("generateJoinCode", () => {
  it("is six characters from an unambiguous alphabet", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateJoinCode();
      expect(code).toHaveLength(6);
      // No 0/O or 1/I: join codes get read aloud.
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it("matches the database's own check constraint", () => {
    expect(generateJoinCode()).toMatch(/^[A-Z0-9]{6,10}$/);
  });
});
