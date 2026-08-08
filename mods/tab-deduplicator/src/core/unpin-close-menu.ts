export interface UnpinCloseMenuFacts {
  supported: boolean;
  hasContextTab: boolean;
  live: boolean;
  pinned: boolean;
  essential: boolean;
  multiselected: boolean;
}

export interface UnpinCloseMenuState {
  label: string;
  hidden: boolean;
  disabled: boolean;
}

export const unpinCloseMenuState = ({
  supported,
  hasContextTab,
  live,
  pinned,
  essential,
  multiselected,
}: UnpinCloseMenuFacts): UnpinCloseMenuState => {
  const visible =
    supported && hasContextTab && live && pinned && !essential && !multiselected;
  return {
    label: "Unpin and close pinned tab…",
    hidden: !visible,
    disabled: !visible,
  };
};
