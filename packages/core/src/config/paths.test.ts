import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { databasePath, dataDir } from "./paths.ts";

describe("dataDir", () => {
  const saved = process.env.CHISME_DATA_DIR;
  beforeEach(() => {
    delete process.env.CHISME_DATA_DIR;
  });
  afterEach(() => {
    if (saved == null) delete process.env.CHISME_DATA_DIR;
    else process.env.CHISME_DATA_DIR = saved;
  });

  test("CHISME_DATA_DIR overrides the platform default", () => {
    process.env.CHISME_DATA_DIR = "/tmp/chisme-test";
    expect(dataDir()).toBe("/tmp/chisme-test");
  });

  test("databasePath puts chisme.db inside the data dir", () => {
    process.env.CHISME_DATA_DIR = "/tmp/chisme-test";
    expect(databasePath()).toBe(join("/tmp/chisme-test", "chisme.db"));
  });

  test("falls back to a non-empty platform path without the override", () => {
    const dir = dataDir();
    expect(dir.length).toBeGreaterThan(0);
    expect(dir.endsWith("chisme")).toBe(true);
  });
});
