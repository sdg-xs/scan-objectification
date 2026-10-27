/**
 * The pilot shell.
 *
 * Four states are declared here so the whole flow is visible from the start:
 * create project, upload, processing, and viewer. This task wires the create
 * and upload states to their APIs; job progress and the viewer arrive with
 * their own tasks.
 *
 * The capability link is the key. When a project is created the browser is
 * rewritten to `/p/<project-id>#key=<secret>` and the fragment is stripped
 * again straight away, so the secret does not sit in the address bar. It
 * stays in the tab's memory, and the "Copy Project Link" button rebuilds the
 * link from that memory when the user asks for it.
 */

import { apiFetch, readProjectLocation, readSecret, beginUpload, resumeUpload,
  uploadChunks, finalizeUpload, UploadError } from "./api";
import type { SavedUpload } from "./api";
import HashWorker from "./hash-worker?worker&inline";

type StateName = "create" | "upload" | "processing" | "viewer";

interface ShellState {
  readonly name: StateName;
  readonly heading: string;
  readonly body: string;
}

const SHELL_STATES: readonly ShellState[] = [
  {
    name: "create",
    heading: "1. Create a project",
    body:
      "A project is one USD scene. Creating it returns a private link that grants " +
      "access to that project only.",
  },
  {
    name: "upload",
    heading: "2. Upload a USD scene",
    body:
      "Choose a .usd, .usda, .usdc, or .usdz file, or a .zip bundle containing a " +
      "root stage and its local dependencies. The upload resumes after a reload.",
  },
  {
    name: "processing",
    heading: "3. Validate and convert",
    body:
      "A worker opens the staged stage, checks the Gaussian attributes, and builds " +
      "a streamable render derivative. Progress is shown here.",
  },
  {
    name: "viewer",
    heading: "4. View the scene",
    body:
      "The converted scene loads in a Three.js viewer. Navigation and source-prim " +
      "visibility arrive with the viewer task.",
  },
];

/** The project this tab holds the key for. */
interface ActiveProject {
  readonly projectId: string;
  readonly secret: string;
}

/** The body the project API answers a creation with. */
interface CreatedProject {
  readonly projectId: string;
  readonly capabilitySecret: string;
  readonly link: string;
  readonly stateVersion: number;
  readonly mediaEpoch: number;
}

/**
 * The warning the user has to see before they rely on the link.
 *
 * The server keeps a hash of the secret, not the link, so nothing can
 * restore a lost link. Losing it loses the project.
 */
const RECOVERY_WARNING =
  "This link is the only key to the project. The server stores a hash of it, not " +
  "the link itself, so the link cannot be recovered or re-sent. Save it somewhere " +
  "safe now: if you lose it, you lose access to the scene.";

let activeProject: ActiveProject | null = null;

/** Escape text that is about to be placed in the page markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The create section: a button, or the project that the button produced. */
function createMarkup(): string {
  const warning = `<p class="recovery-warning" id="recovery-warning">${escapeHtml(
    RECOVERY_WARNING,
  )}</p>`;

  if (activeProject === null) {
    return `
      <button type="button" id="create-project" class="primary">
        Create project
      </button>
      ${warning}
    `;
  }

  return `
    <p class="project-id">
      Project <code id="project-id">${escapeHtml(activeProject.projectId)}</code>
    </p>
    <button type="button" id="copy-project-link" class="primary">
      Copy Project Link
    </button>
    <p class="link-status" id="link-status" role="status"></p>
    ${warning}
  `;
}

function stateMarkup(state: ShellState): string {
  return `
    <section class="state" data-state="${state.name}">
      <h2>${state.heading}</h2>
      <p class="state-body">${state.body}</p>
      ${
        state.name === "create"
          ? createMarkup()
          : state.name === "upload" ? uploadMarkup()
          : `<p class="state-pending">Not available yet &mdash; wired in a later task.</p>`
      }
    </section>
  `;
}

function render(): void {
  const app = document.querySelector<HTMLElement>("#app");
  if (app === null) {
    return;
  }
  app.innerHTML = `
    <p class="local-pilot">
      <strong>Local pilot.</strong> Everything stays on this machine. There is no
      account, and the project link is the only key to your scene.
    </p>
    ${SHELL_STATES.map(stateMarkup).join("")}
  `;

  document
    .querySelector<HTMLFormElement>("#upload-form")
    ?.addEventListener("submit", event => {
      event.preventDefault();
      void uploadScene();
    });
  document
    .querySelector<HTMLButtonElement>("#create-project")
    ?.addEventListener("click", () => {
      void createProject();
    });
  document
    .querySelector<HTMLButtonElement>("#copy-project-link")
    ?.addEventListener("click", () => {
      copyProjectLink();
    });
}

function uploadMarkup(): string {
  if (activeProject === null) return "<p>Create or open a project to upload a scene.</p>";
  return `<form id="upload-form">
    <p><label>Scene file <input id="scene-file" type="file" accept=".usd,.usda,.usdc,.usdz,.zip" required></label></p>
    <p><label>Root stage inside ZIP <input id="root-stage" type="text" placeholder="folder/root.usda"></label></p>
    <p>Select the same file to resume. Its contents are verified before resuming.</p>
    <button class="primary" id="upload-button" type="submit">Upload or resume</button>
    <p id="upload-status" role="status" aria-live="polite"></p>
    <progress id="upload-progress" value="0" max="1" aria-label="Upload progress"></progress>
  </form>`;
}

function hashInWorker(file: File, progress: (bytes: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    // Vite inlines this worker as a Blob URL; the existing worker CSP allows it.
    const worker = new HashWorker();
    worker.onmessage = ({data}: MessageEvent<{bytes?: number; digest?: string; error?: string}>) => {
      if (data.bytes !== undefined) progress(data.bytes);
      if (data.digest !== undefined) { worker.terminate(); resolve(data.digest); }
      if (data.error !== undefined) { worker.terminate(); reject(new Error(data.error)); }
    };
    worker.onerror = () => { worker.terminate(); reject(new Error("The hashing worker could not run.")); };
    worker.postMessage(file);
  });
}

async function uploadScene(): Promise<void> {
  const project = activeProject;
  const file = document.querySelector<HTMLInputElement>("#scene-file")?.files?.[0];
  if (project === null || file === undefined) return;
  const rootInput = document.querySelector<HTMLInputElement>("#root-stage")?.value.trim() ?? "";
  const rootStage = file.name.toLowerCase().endsWith(".zip") ? rootInput || null : null;
  const button = document.querySelector<HTMLButtonElement>("#upload-button")!;
  const status = document.querySelector<HTMLElement>("#upload-status")!;
  const meter = document.querySelector<HTMLProgressElement>("#upload-progress")!;
  const report = (phase: string, bytes: number): void => {
    status.textContent = `${phase}: ${bytes.toLocaleString()} / ${file.size.toLocaleString()} bytes`;
    meter.max = file.size || 1;
    meter.value = bytes;
  };
  const key = `nemy.upload.${project.projectId}`;
  button.disabled = true;
  try {
    if (file.size === 0) throw new Error("Choose a nonempty scene file.");
    if (file.size > 8 * 1024 ** 3) throw new Error("The file exceeds the pilot's 8 GiB upload limit.");
    if (file.name.toLowerCase().endsWith(".zip") && rootStage === null) throw new Error("Enter the root stage path inside the ZIP.");
    report("Hashing", 0);
    const digest = await hashInWorker(file, bytes => report("Hashing", bytes));
    let saved: SavedUpload | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as SavedUpload | null; } catch { /* Storage may be unavailable. */ }
    let uploadId = resumeUpload(saved, file, digest, rootStage);
    const metadata = {filename: file.name, totalSize: file.size, sha256: digest, rootStage};
    if (uploadId === null) uploadId = (await beginUpload(project.projectId, metadata)).uploadId;
    try { sessionStorage.setItem(key, JSON.stringify({...metadata, uploadId})); } catch { /* This request can still finish. */ }
    report("Uploaded", 0);
    await uploadChunks(project.projectId, uploadId, file, bytes => report("Uploaded", bytes));
    status.textContent = "Verifying and staging the scene…";
    const result = await finalizeUpload(project.projectId, uploadId);
    status.textContent = `Upload complete. Validation and conversion queued (job ${result.jobId}).`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "The upload could not finish. Reselect the file to resume.";
    // A definitive finalize failure (digest mismatch, bad bundle, over-quota
    // expansion) marks the attempt failed but keeps its chunks, so resuming
    // it would re-fail forever. Drop the saved entry so the next submit
    // starts a fresh attempt. Missing chunks (409) stay resumable.
    if (error instanceof UploadError && (error.status === 400 || error.status === 413)) {
      try { sessionStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
    }
  } finally {
    button.disabled = false;
  }
}

/** Report a failure to the user without losing the page. */
function showError(message: string): void {
  const status = document.querySelector<HTMLElement>("#link-status");
  if (status !== null) {
    status.textContent = message;
    return;
  }
  const app = document.querySelector<HTMLElement>("#app");
  if (app !== null) {
    const notice = document.createElement("p");
    notice.className = "recovery-warning";
    notice.textContent = message;
    app.prepend(notice);
  }
}

/**
 * Create a project and take the browser to it.
 *
 * The browser is rewritten to the full capability link and the fragment is
 * taken off again immediately. The secret survives only in this tab's
 * memory, which is what the copy button reads.
 */
async function createProject(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>("#create-project");
  if (button !== null) {
    button.disabled = true;
  }

  try {
    const response = await apiFetch("/api/projects", { method: "POST" });
    if (!response.ok) {
      throw new Error(`the server answered ${response.status}`);
    }
    const created = (await response.json()) as CreatedProject;
    // Put the capability link in the address bar, then take the secret out
    // of it: a fragment left in the address bar ends up in the browser
    // history and in every `Referer` header the page sends. `readProjectLocation`
    // reads the fragment, keeps the secret in memory and in this tab's
    // session storage, and strips the fragment in one step.
    window.history.replaceState(
      null,
      "",
      `/p/${created.projectId}#key=${created.capabilitySecret}`,
    );
    readProjectLocation();
    activeProject = {
      projectId: created.projectId,
      secret: readSecret(created.projectId) ?? created.capabilitySecret,
    };
  } catch (error) {
    showError(
      `The project could not be created: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    if (button !== null) {
      button.disabled = false;
    }
    return;
  }

  render();
}

/** Copy the capability link, rebuilt from the secret held in memory. */
function copyProjectLink(): void {
  if (activeProject === null) {
    return;
  }
  const link = `${window.location.origin}/p/${activeProject.projectId}#key=${activeProject.secret}`;
  const status = document.querySelector<HTMLElement>("#link-status");

  const done = (message: string): void => {
    if (status !== null) {
      status.textContent = message;
    }
  };

  const clipboard = navigator.clipboard;
  if (clipboard === undefined) {
    done(`Copy this link by hand: ${link}`);
    return;
  }
  void clipboard.writeText(link).then(
    () => done("Project link copied to the clipboard."),
    () => done(`Copy this link by hand: ${link}`),
  );
}

/**
 * Adopt the project the browser was opened on.
 *
 * A link pasted into the address bar arrives with its fragment, and a reload
 * of the same tab arrives without one but with the tab's session storage
 * still holding the secret.
 */
function adoptCurrentProject(): void {
  const location = readProjectLocation();
  if (location.projectId === null) {
    return;
  }
  const secret = location.secret ?? readSecret(location.projectId);
  if (secret === null) {
    return;
  }
  activeProject = { projectId: location.projectId, secret };
}

adoptCurrentProject();
render();
