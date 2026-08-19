/** Editor panel ids and the XHTML element helpers both editor modules build DOM with. */

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
export const PANEL_ID = "sidebar-context-menu-customizer-editor-panel";
export const ACTION_LIST_ID = `${PANEL_ID}-actions`;

export const htmlElement = <K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
) => document.createElementNS(XHTML_NAMESPACE, tagName) as HTMLElementTagNameMap[K];

export const button = (document: Document, label: string, className: string) => {
  const node = htmlElement(document, "button");
  node.type = "button";
  node.className = className;
  node.textContent = label;
  return node;
};
