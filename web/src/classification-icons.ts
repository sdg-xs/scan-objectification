const paths = {
  classify: ["M3 6 10 2l7 4-7 4-7-4Z M3 11l7 4 3-2 M3 16l7 4 3-2", "M15 17h7m-3-3 3 3-3 3"],
  unclassify: ["M3 6 10 2l7 4-7 4-7-4Z M3 11l7 4 3-2 M3 16l7 4 3-2", "M22 17h-7m3-3-3 3 3 3"],
  clear: ["M7 3H3v4m14-4h4v4M3 17v4h4m14-4v4h-4", "m8 8 8 8m0-8-8 8"],
  group: ["M3 7V5h6l2 2h10v13H3V7Z", "M12 11v6m-3-3h6"],
  layer: ["m3 6 8-4 8 4-8 4-8-4Z M3 11l8 4 3-1.5 M3 16l8 4 3-1.5", "M19 13v8m-4-4h8"],
  target: ["M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z", "M12 1v4m0 14v4M1 12h4m14 0h4"],
  remove: ["M4 7h16M9 7V3h6v4 M6 7l1 14h10l1-14M10 11v6m4-6v6"],
  eye: ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"],
  eyeOff: ["M3 3l18 18M9 5.5c1-.3 2-.5 3-.5 6 0 10 7 10 7s-1 2-3 4M6 7c-3 2-4 5-4 5s4 7 10 7c2 0 4-.7 5-1.5"],
  scan: ["M7 3H3v4m14-4h4v4M3 17v4h4m14-4v4h-4", "M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"],
  colors: ["M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4c-1-1 0-2 1-2h3c5 0 4-12-6-12Z", "M7 10h.01M9 6h.01M14 6h.01M18 10h.01"],
  folder: ["M3 7V5h6l2 2h10v13H3V7Z"],
} as const;

export type ClassificationIcon = keyof typeof paths;

export function classificationIcon(name: ClassificationIcon): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [attribute, value] of Object.entries({ viewBox: "0 0 24 24", width: "19", height: "19", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" }))
    svg.setAttribute(attribute, value);
  for (const data of paths[name]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    svg.append(path);
  }
  return svg;
}

/** Native title tooltips use the browser's delayed hover and escape clipping. */
export function classificationButton(button: HTMLButtonElement, icon: ClassificationIcon, label: string): void {
  button.classList.add("classification-icon-button");
  button.replaceChildren(classificationIcon(icon));
  button.title = label;
  button.setAttribute("aria-label", label);
}

export function classificationToggle(input: HTMLInputElement, icon: ClassificationIcon, label: string): void {
  const wrapper = input.closest("label");
  if (!wrapper) throw new Error("A classification toggle needs a label.");
  wrapper.classList.add("classification-toggle");
  wrapper.title = label;
  input.setAttribute("aria-label", label);
  wrapper.replaceChildren(input, classificationIcon(icon));
}
