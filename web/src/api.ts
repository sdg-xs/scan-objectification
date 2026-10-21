/**
 * The browser client for capability-link projects.
 *
 * A project is reachable only through its capability link,
 * `/p/<project-id>#key=<secret>`. The secret *is* the key, so it is kept out
 * of the URL the moment it has been read: the fragment is stripped from the
 * address bar and the secret is kept in module memory and in the tab's
 * `sessionStorage`, so a reload of the same tab still works.
 *
 * `localStorage` is never used. A secret that outlives the tab would outlive
 * the project it opens, and the pilot's rule is that a link is the only key:
 * closing the tab should end the browser's hold on it.
 *
 * The secret is sent in the `Authorization` header and never in a URL. A URL
 * ends up in the address bar, in the browser history, in the server's access
 * log, and in every `Referer` header on the way out.
 */

/** The `sessionStorage` key that holds a project's secret. */
const CAPABILITY_STORAGE_PREFIX = "nemy.capability.";

/**
 * The shortest secret that is accepted.
 *
 * The server issues `secrets.token_urlsafe(32)`, which is 43 URL-safe
 * characters. A fragment that is shorter than that cannot be a secret the
 * server ever issued, so it is refused rather than sent to the API. Longer
 * values are accepted because the length is the server's business, not the
 * browser's: the server rejects anything it did not issue.
 */
const SECRET_MIN_LENGTH = 43;

/** The longest fragment that is still worth reading as a secret. */
const SECRET_MAX_LENGTH = 512;

/** The characters a URL-safe secret is made of. */
const SECRET_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * The shape of a project id.
 *
 * The server issues a canonical UUIDv4, `8-4-4-4-12` hex groups. The
 * browser also accepts the shorter `8-4-4-12` form, which is the same
 * identifier with one group dropped. Both are hex-and-hyphen only, so a
 * path segment that is not an identifier at all - `not-a-uuid` - is still
 * refused. The version and variant bits are deliberately not checked here:
 * the browser only needs to recognise an identifier, and the server is the
 * side that decides what a project id may be.
 */
const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}(?:-[0-9a-f]{4})?-[0-9a-f]{12}$/i;

/** The path of a capability link. */
const PROJECT_PATH_PATTERN = /^\/p\/([^/]+)\/?$/;

/** The secret of a project, kept in memory for the life of this tab. */
const secrets = new Map<string, string>();

interface ProjectLocation {
  readonly projectId: string | null;
  readonly secret: string | null;
}

/**
 * The browser's session storage, when there is one.
 *
 * A page can run without storage (private modes, blocked cookies, a test
 * environment), so this is looked up defensively instead of being assumed.
 */
function sessionStore(): Storage | null {
  const candidate = (globalThis as unknown as { sessionStorage?: Storage })
    .sessionStorage;
  return candidate ?? null;
}

/** The browser window, when there is one. */
function currentWindow(): Window | null {
  const candidate = (globalThis as unknown as { window?: Window }).window;
  return candidate ?? null;
}

/** The project id in a path such as `/p/<project-id>`, or `null`. */
function projectIdFromPath(pathname: string): string | null {
  const match = PROJECT_PATH_PATTERN.exec(pathname);
  if (match === null) {
    return null;
  }
  const candidate = match[1];
  if (!PROJECT_ID_PATTERN.test(candidate)) {
    return null;
  }
  return candidate;
}

/**
 * The secret in a fragment such as `#key=<secret>`, or `null`.
 *
 * The fragment is read as it appears in the address bar. A secret is made of
 * URL-safe characters only, none of which a browser percent-encodes, so the
 * raw form is the secret. Anything else - a different key, an empty value, a
 * value that is too short, a value carrying a stray space - is not a secret.
 */
function secretFromHash(hash: string): string | null {
  if (!hash.startsWith("#")) {
    return null;
  }
  const body = hash.slice(1);
  const separator = body.indexOf("=");
  if (separator < 0) {
    return null;
  }
  if (body.slice(0, separator) !== "key") {
    return null;
  }
  const value = body.slice(separator + 1);
  if (value.length < SECRET_MIN_LENGTH || value.length > SECRET_MAX_LENGTH) {
    return null;
  }
  if (!SECRET_PATTERN.test(value)) {
    return null;
  }
  return value;
}

/** Keep a secret in memory and in the tab's session storage. */
function remember(projectId: string, secret: string): void {
  secrets.set(projectId, secret);
  const store = sessionStore();
  if (store === null) {
    return;
  }
  try {
    store.setItem(CAPABILITY_STORAGE_PREFIX + projectId, secret);
  } catch {
    // Storage that refuses the write must not break the page: the secret
    // stays in module memory, which is enough for this tab's lifetime.
  }
}

/**
 * Read the capability link the browser is on.
 *
 * The fragment is removed from the address bar as soon as it has been read,
 * so the secret does not sit in the address bar or in the browser's history
 * entry. The secret itself is kept in memory and in `sessionStorage`.
 *
 * A malformed link yields no secret, and a path that is not a project link
 * yields no project at all.
 */
export function readProjectLocation(): ProjectLocation {
  const view = currentWindow();
  const location = view?.location;
  if (location === undefined) {
    return { projectId: null, secret: null };
  }

  const projectId = projectIdFromPath(location.pathname);
  if (projectId === null) {
    return { projectId: null, secret: null };
  }

  const secret = secretFromHash(location.hash);
  if (location.hash !== "") {
    // Strip the fragment whether or not it held a usable secret.
    view?.history.replaceState(null, "", `/p/${projectId}`);
  }
  if (secret !== null) {
    remember(projectId, secret);
  }
  return { projectId, secret };
}

/**
 * The secret of a project, from memory or from this tab's session storage.
 *
 * Returns `null` when the tab has never seen the secret, which is what a
 * link opened in a different tab looks like.
 */
export function readSecret(projectId: string): string | null {
  const cached = secrets.get(projectId);
  if (cached !== undefined) {
    return cached;
  }
  const store = sessionStore();
  if (store === null) {
    return null;
  }
  try {
    return store.getItem(CAPABILITY_STORAGE_PREFIX + projectId);
  } catch {
    return null;
  }
}

/**
 * The secret to send with a request, or `null` when none may be sent.
 *
 * The secret only ever goes to this origin's own API. A cross-origin URL, a
 * protocol-relative URL, and a media request are all left without the
 * header: the secret opens exactly one project and must not be handed to
 * anything else.
 */
function secretForRequest(url: string): string | null {
  const view = currentWindow();
  const origin = view?.location?.origin;
  if (origin === undefined) {
    return null;
  }

  let resolved: URL;
  try {
    resolved = new URL(url, origin);
  } catch {
    return null;
  }
  if (resolved.origin !== origin) {
    return null;
  }
  if (!resolved.pathname.startsWith("/api/")) {
    return null;
  }

  const projectId = projectIdFromPath(view?.location?.pathname ?? "");
  if (projectId === null) {
    return null;
  }
  return readSecret(projectId);
}

/**
 * Fetch a URL, adding the capability header when the URL asks for it.
 *
 * The URL is passed through unchanged: the secret travels in the header, and
 * never in the URL.
 */
export async function apiFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const secret = secretForRequest(url);
  if (secret !== null) {
    headers.set("Authorization", `Bearer ${secret}`);
  }
  return fetch(url, { ...init, headers });
}
