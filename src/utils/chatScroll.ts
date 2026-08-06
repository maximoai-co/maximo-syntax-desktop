export const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64;

export function isScrollElementNearBottom(element: HTMLElement, threshold: number = AUTO_SCROLL_BOTTOM_THRESHOLD_PX): boolean {
  const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distance <= threshold;
}
