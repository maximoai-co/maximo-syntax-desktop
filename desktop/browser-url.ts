/** Removes accidental repeated HTTP(S) schemes before URL parsing. */
export function collapseDuplicateBrowserScheme(value: string | undefined): string {
  return (value ?? "").trim().replace(/^(https?:\/\/)(?:https?:\/\/)+/iu, "$1");
}
