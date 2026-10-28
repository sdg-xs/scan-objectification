const paths = {
  classify: ["M3 6 10 2l7 4-7 4-7-4Z M3 11l7 4 3-2 M3 16l7 4 3-2", "M15 17h7m-3-3 3 3-3 3"],
  unclassify: ["M3 6 10 2l7 4-7 4-7-4Z M3 11l7 4 3-2 M3 16l7 4 3-2", "M22 17h-7m3-3-3 3 3 3"],
  move: ["M3 5h7v7H3V5Z M14 12h7v7h-7", "M8 17h10m-4-4 4 4-4 4"],
  clear: ["M7 3H3v4m14-4h4v4M3 17v4h4m14-4v4h-4", "m8 8 8 8m0-8-8 8"],
  group: ["M3 7V5h6l2 2h10v13H3V7Z", "M12 11v6m-3-3h6"],
  layer: ["m3 6 8-4 8 4-8 4-8-4Z M3 11l8 4 3-1.5 M3 16l8 4 3-1.5", "M19 13v8m-4-4h8"],
  target: ["M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z", "M12 1v4m0 14v4M1 12h4m14 0h4"],
  remove: ["M4 7h16M9 7V3h6v4 M6 7l1 14h10l1-14M10 11v6m4-6v6"],
  eye: ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"],
  eyeOff: ["M3 3l18 18M9 5.5c1-.3 2-.5 3-.5 6 0 10 7 10 7s-1 2-3 4M6 7c-3 2-4 5-4 5s4 7 10 7c2 0 4-.7 5-1.5"],
  colors: ["M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4c-1-1 0-2 1-2h3c5 0 4-12-6-12Z", "M7 10h.01M9 6h.01M14 6h.01M18 10h.01"],
  folder: ["M3 7V5h6l2 2h10v13H3V7Z"],
  chevronUp: ["m6 15 6-6 6 6"],
  mesh: ["m4 8 8-5 8 5v10l-8 4-8-4V8Z M4 8l8 5 8-5M12 13v9 M4 18l8-15 8 15H4Z"],
  classifiedMesh: ["m3 8 7-4 7 4v9l-7 4-7-4V8Z M3 8l7 4 7-4M10 12v9", "m14 17 3 3 5-6"],
  layerItem: ["m3 17 7-10h11L14 17H3Z"],
  layerGroup: ["M5 5H3v17h16v-2M8 2H6v17h16V2h-3", "m9 7 3-3h7l-3 3H9Z M9 11h9M9 15h9"],
  activeLayer: ["M7 3H3v4m14-4h4v4M3 17v4h4m14-4v4h-4", "m6 15 5-6h8l-5 6H6Z"],
  unclassified: ["M3 3h7v7H3Z", "M3 14h7v7H3Z", "M17.5 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z M17.5 14a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"],
  classifiedRoot: ["M3 3h7v7H3Z", "M3 14h7v7H3Z", "M17.5 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z M17.5 14a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z", "m3 5 2 2 5-5m-7 15 2 2 5-5"],
} as const;

export type ClassificationIcon = keyof typeof paths;

export function classificationIcon(name: ClassificationIcon): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [attribute, value] of Object.entries({ viewBox: "0 0 24 24", width: "19", height: "19", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" }))
    svg.setAttribute(attribute, value);
  for (const [index, data] of paths[name].entries()) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    if (name === "layerItem" || (name === "activeLayer" && index === 1) ||
        ((name === "unclassified" || name === "classifiedRoot") && (index === 1 || index === 2)))
      path.setAttribute("fill", "currentColor");
    if (name === "classifiedRoot" && index === 3) path.setAttribute("stroke", "#379369");
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
