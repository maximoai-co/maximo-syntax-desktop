export const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64;
export const AUTO_SCROLL_RESUME_THRESHOLD_PX = 4;

export function isScrollElementNearBottom(element: HTMLElement, threshold: number = AUTO_SCROLL_BOTTOM_THRESHOLD_PX): boolean {
  const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distance <= threshold;
}

/**
 * Existing bottom-follow tolerates small layout shifts, but once the user has
 * taken ownership it only resumes at the actual live edge. An explicit
 * transcript interaction remains locked even if a disclosure's layout happens
 * to generate a scroll event near the bottom.
 */
export function shouldStickToScrollBottom(element: HTMLElement, wasFollowing: boolean, interactionLocked: boolean): boolean {
  if (interactionLocked) return false;
  return isScrollElementNearBottom(
    element,
    wasFollowing ? AUTO_SCROLL_BOTTOM_THRESHOLD_PX : AUTO_SCROLL_RESUME_THRESHOLD_PX,
  );
}
