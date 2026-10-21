import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch, readProjectLocation, readSecret } from "./api";

/** A 43 character URL-safe secret, the shape `token_urlsafe(32)` produces. */
const SECRET = "V1StQ1NhRjlFN0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqaw";

/** A distinct project id per test, so the module memory never leaks. */
function projectId(seed: number): string {
  return `0000${String(seed).padStart(4, "0")}-4000-8000-000000000000`;
}

interface BrowserStub {
  readonly replaceState: ReturnType<typeof vi.fn>;
  readonly session: Map<string, string>;
  readonly local: Map<string, string>;
}

function stubBrowser(
  url: string,
  session: Map<string, string> = new Map<string, string>(),
): BrowserStub {
  const parsed = new URL(url);
  const replaceState = vi.fn();
  const local = new Map<string, string>();

  vi.stubGlobal("window", {
    location: {
      origin: parsed.origin,
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
    },
    history: { replaceState },
  });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => {
      session.set(key, value);
    },
    removeItem: (key: string) => {
      session.delete(key);
    },
    clear: () => session.clear(),
    key: () => null,
    length: session.size,
  });
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: (key: string, value: string) => {
      local.set(key, value);
    },
    removeItem: () => undefined,
    clear: () => local.clear(),
    key: () => null,
    length: local.size,
  });

  return { replaceState, session, local };
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("{}", { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readProjectLocation", () => {
  it("parses the capability link and removes the fragment from the address bar", () => {
    const id = projectId(1);
    const browser = stubBrowser(`http://localhost:8767/p/${id}#key=${SECRET}`);

    const location = readProjectLocation();

    expect(location.projectId).toBe(id);
    expect(location.secret).toBe(SECRET);
    expect(browser.replaceState).toHaveBeenCalledTimes(1);
    const target = browser.replaceState.mock.calls[0][2];
    expect(target).toBe(`/p/${id}`);
    expect(String(target)).not.toContain("#");
  });

  it("keeps the secret in module memory and session storage only", () => {
    const id = projectId(2);
    const browser = stubBrowser(`http://localhost:8767/p/${id}#key=${SECRET}`);

    readProjectLocation();

    expect(readSecret(id)).toBe(SECRET);
    expect(browser.session.get(`nemy.capability.${id}`)).toBe(SECRET);
    expect(browser.local.size).toBe(0);
  });

  it("returns no key for malformed input", () => {
    const malformed = [
      `http://localhost:8767/p/${projectId(10)}`,
      `http://localhost:8767/p/${projectId(11)}#token=${SECRET}`,
      `http://localhost:8767/p/${projectId(12)}#key=`,
      `http://localhost:8767/p/${projectId(13)}#key=short`,
      `http://localhost:8767/p/${projectId(14)}#key=${SECRET}%20`,
      "http://localhost:8767/",
    ];

    for (const url of malformed) {
      const browser = stubBrowser(url);
      const location = readProjectLocation();

      expect(location.secret).toBeNull();
      expect(browser.session.size).toBe(0);
    }
  });

  it("rejects a project id that is not a uuid", () => {
    stubBrowser(`http://localhost:8767/p/not-a-uuid#key=${SECRET}`);

    const location = readProjectLocation();

    expect(location.projectId).toBeNull();
    expect(location.secret).toBeNull();
  });

  it("recovers the secret from session storage after a reload", () => {
    const id = projectId(3);
    const session = new Map<string, string>();
    stubBrowser(`http://localhost:8767/p/${id}#key=${SECRET}`, session);
    readProjectLocation();

    // A reload: the fragment is gone, the tab's session storage remains.
    stubBrowser(`http://localhost:8767/p/${id}`, session);
    const location = readProjectLocation();

    expect(location.projectId).toBe(id);
    expect(location.secret).toBeNull();
    expect(readSecret(id)).toBe(SECRET);
  });
});

describe("apiFetch", () => {
  it("adds the bearer header to a same-origin api call", async () => {
    const id = projectId(4);
    stubBrowser(`http://localhost:8767/p/${id}#key=${SECRET}`);
    readProjectLocation();
    const fetchMock = stubFetch();

    await apiFetch(`/api/projects/${id}`);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/projects/${id}`);
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${SECRET}`);
  });

  it("never puts the secret in a url", async () => {
    const id = projectId(5);
    stubBrowser(`http://localhost:8767/p/${id}#key=${SECRET}`);
    readProjectLocation();
    const fetchMock = stubFetch();

    await apiFetch(`/api/projects/${id}`);

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain(SECRET);
    expect(String(url)).not.toContain("key=");
  });

  it("does not add the bearer header to a cross-origin api call", async () => {
    const id = projectId(6);
    stubBrowser(`http://localhost:8767/p/${id}#key=${SECRET}`);
    readProjectLocation();
    const fetchMock = stubFetch();

    await apiFetch("https://example.com/api/projects");
    await apiFetch("//example.com/api/projects");

    for (const call of fetchMock.mock.calls) {
      expect(new Headers(call[1]?.headers).get("Authorization")).toBeNull();
    }
  });

  it("does not add the bearer header to a media request", async () => {
    const id = projectId(7);
    stubBrowser(`http://localhost:8767/p/${id}#key=${SECRET}`);
    readProjectLocation();
    const fetchMock = stubFetch();

    await apiFetch(`/media/${id}/scene/prim-000.rad`);

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get("Authorization")).toBeNull();
  });
});
