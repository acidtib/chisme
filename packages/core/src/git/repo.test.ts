import { describe, expect, test } from "bun:test";
import { slugFromRemoteUrl } from "./repo.ts";

describe("slugFromRemoteUrl", () => {
  test("scp syntax with .git", () => {
    expect(slugFromRemoteUrl("git@github.com:owner/repo.git")).toBe("owner/repo");
  });

  test("scp syntax without .git", () => {
    expect(slugFromRemoteUrl("git@github.com:owner/repo")).toBe("owner/repo");
  });

  test("https with .git", () => {
    expect(slugFromRemoteUrl("https://github.com/owner/repo.git")).toBe("owner/repo");
  });

  test("https without .git", () => {
    expect(slugFromRemoteUrl("https://github.com/owner/repo")).toBe("owner/repo");
  });

  test("ssh:// url form", () => {
    expect(slugFromRemoteUrl("ssh://git@github.com/owner/repo.git")).toBe("owner/repo");
  });

  test("nested groups keep only the last two segments", () => {
    expect(slugFromRemoteUrl("https://gitlab.com/group/subgroup/repo.git")).toBe("subgroup/repo");
    expect(slugFromRemoteUrl("git@gitlab.com:group/subgroup/repo.git")).toBe("subgroup/repo");
  });

  test("trailing slash is stripped", () => {
    expect(slugFromRemoteUrl("https://github.com/owner/repo/")).toBe("owner/repo");
  });

  test("uppercase .GIT suffix is stripped", () => {
    expect(slugFromRemoteUrl("git@github.com:owner/repo.GIT")).toBe("owner/repo");
  });

  test("surrounding whitespace is ignored", () => {
    expect(slugFromRemoteUrl("  git@github.com:owner/repo.git \n")).toBe("owner/repo");
  });

  test("returns null when fewer than two path segments", () => {
    expect(slugFromRemoteUrl("https://github.com/repo")).toBeNull();
    expect(slugFromRemoteUrl("https://github.com")).toBeNull();
    expect(slugFromRemoteUrl("git@github.com:repo")).toBeNull();
  });
});
