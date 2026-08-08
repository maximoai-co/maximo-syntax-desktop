/**
 * Return whether a slash-command name should be shown for the text typed
 * after `/` in the composer.
 *
 * Slash-command names are often compound (for example, `update-config`), so
 * prefix-only matching makes useful commands impossible to find when the user
 * knows a later part of the name.
 */
export function matchesSlashCommandQuery(name: string, query: string): boolean {
  const normalizedName = name.trim().replace(/^\/+/, "").toLowerCase();
  const normalizedQuery = query.trim().replace(/^\/+/, "").toLowerCase();
  return normalizedQuery.length === 0 || normalizedName.includes(normalizedQuery);
}
