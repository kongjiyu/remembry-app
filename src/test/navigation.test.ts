import { normalizeInternalHref } from "@/lib/navigation";

describe("normalizeInternalHref", () => {
  // Basic trailing slash

  it("adds trailing slash to root path", () => {
    expect(normalizeInternalHref("/")).toBe("/");
  });

  it("adds trailing slash to simple path", () => {
    expect(normalizeInternalHref("/dashboard")).toBe("/dashboard/");
  });

  it("adds trailing slash to nested path", () => {
    expect(normalizeInternalHref("/events")).toBe("/events/");
  });

  it("adds trailing slash to deep path", () => {
    expect(normalizeInternalHref("/projects/detail")).toBe("/projects/detail/");
  });

  it("keeps trailing slash if already present", () => {
    expect(normalizeInternalHref("/dashboard/")).toBe("/dashboard/");
  });

  it("keeps trailing slash on nested path", () => {
    expect(normalizeInternalHref("/events/new/")).toBe("/events/new/");
  });

  // Query string preservation

  it("preserves single query param", () => {
    expect(normalizeInternalHref("/events/new?mode=record")).toBe("/events/new/?mode=record");
  });

  it("preserves multiple query params", () => {
    expect(normalizeInternalHref("/events/detail?id=abc")).toBe("/events/detail/?id=abc");
  });

  it("preserves query params with special characters", () => {
    expect(normalizeInternalHref("/events/detail?id=abc&projectName=my%20project")).toBe(
      "/events/detail/?id=abc&projectName=my%20project"
    );
  });

  it("preserves query params on already-slashed path", () => {
    expect(normalizeInternalHref("/events/new/?mode=record")).toBe("/events/new/?mode=record");
  });

  // Hash preservation

  it("preserves hash", () => {
    expect(normalizeInternalHref("/events/new#top")).toBe("/events/new/#top");
  });

  it("preserves hash on already-slashed path", () => {
    expect(normalizeInternalHref("/events/new/#top")).toBe("/events/new/#top");
  });

  // Query + hash preservation

  it("preserves query and hash together", () => {
    expect(normalizeInternalHref("/events/new?mode=record#top")).toBe("/events/new/?mode=record#top");
  });

  it("preserves query and hash on already-slashed path", () => {
    expect(normalizeInternalHref("/events/new/?mode=record#top")).toBe("/events/new/?mode=record#top");
  });

  // Already-normalized paths (no change expected)

  it("returns root slash unchanged", () => {
    expect(normalizeInternalHref("/")).toBe("/");
  });

  it("returns already-normalized simple path unchanged", () => {
    expect(normalizeInternalHref("/projects/")).toBe("/projects/");
  });

  it("returns already-normalized path with query unchanged", () => {
    expect(normalizeInternalHref("/events/?id=1")).toBe("/events/?id=1");
  });

  // External / special URLs (passthrough — no trailing slash added)

  it("returns external URL unchanged", () => {
    expect(normalizeInternalHref("https://example.com/page")).toBe("https://example.com/page");
  });

  it("returns mailto unchanged", () => {
    expect(normalizeInternalHref("mailto:test@example.com")).toBe("mailto:test@example.com");
  });

  it("returns hash-only link unchanged", () => {
    expect(normalizeInternalHref("#section")).toBe("#section");
  });

  it("returns data URL unchanged", () => {
    expect(normalizeInternalHref("data:text/plain;base64,SGVsbG8=")).toBe("data:text/plain;base64,SGVsbG8=");
  });
});
