interface HideableElement extends Element {
  hidden: boolean;
}

export const supersedeMenuAction = (element: Element) => {
  const node = element as HideableElement;
  const originalHidden = node.hidden;

  const apply = () => {
    node.hidden = true;
  };
  apply();

  return {
    apply,
    restore() {
      node.hidden = originalHidden;
    },
  };
};
