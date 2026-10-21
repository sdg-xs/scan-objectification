/**
 * The pilot shell.
 *
 * Four states are declared here so the whole flow is visible from the start:
 * create project, upload, processing, and viewer. Only the create button
 * exists so far; a later task wires it to the project API and the remaining
 * states to the upload, job, and viewer modules.
 */

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

function stateMarkup(state: ShellState): string {
  return `
    <section class="state" data-state="${state.name}">
      <h2>${state.heading}</h2>
      <p class="state-body">${state.body}</p>
      ${
        state.name === "create"
          ? `<button type="button" id="create-project" class="primary" disabled>
               Create project (wired in a later task)
             </button>`
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
}

render();
