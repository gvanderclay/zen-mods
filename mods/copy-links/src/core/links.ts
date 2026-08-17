export interface ShareableLink {
  readonly url: string;
  readonly title: string;
}

export const linksAsPlainText = (links: readonly ShareableLink[]): string =>
  links.map(link => link.url).join("\n");

export const copyLinksMenuState = (shareableCount: number) => ({
  disabled: shareableCount < 1,
  labelCount: Math.max(1, shareableCount),
});
