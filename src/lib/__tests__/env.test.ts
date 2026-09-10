import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { missingConfiguration } from "../env";

const REQUIRED = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SESSION_SECRET"];

describe("missingConfiguration", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of REQUIRED) {
      original[name] = process.env[name];
      process.env[name] = `value-for-${name}`;
    }
  });

  afterEach(() => {
    for (const name of REQUIRED) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name] as string;
    }
  });

  it("reports nothing when everything is set", () => {
    expect(missingConfiguration()).toEqual([]);
  });

  it("names each variable that is unset", () => {
    delete process.env.SESSION_SECRET;
    expect(missingConfiguration()).toEqual(["SESSION_SECRET"]);

    delete process.env.SUPABASE_URL;
    expect(missingConfiguration()).toEqual(["SUPABASE_URL", "SESSION_SECRET"]);
  });

  it("treats an empty string as unset", () => {
    process.env.SESSION_SECRET = "";
    expect(missingConfiguration()).toEqual(["SESSION_SECRET"]);
  });

  it("catches a value with whitespace on either end", () => {
    // What pasting into a form field on a touchscreen tends to produce.
    process.env.SUPABASE_URL = "https://abcdefgh.supabase.co ";
    expect(missingConfiguration()).toEqual(["SUPABASE_URL"]);

    process.env.SUPABASE_URL = "\nhttps://abcdefgh.supabase.co";
    expect(missingConfiguration()).toEqual(["SUPABASE_URL"]);
  });

  it("allows spaces inside a value, which secrets can contain", () => {
    process.env.SESSION_SECRET = "a b c";
    expect(missingConfiguration()).toEqual([]);
  });
});
