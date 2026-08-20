/**
 * Input Monitoring must be requested from Maximo Syntax.app so System Settings
 * can show the branded row. Loading a Node addon compiled against a different
 * ABI, or creating a CGEvent tap during app boot, can prevent launch. Keep this
 * hook a no-op until a host tap can be installed after the window is showing.
 */
export function requestHostInputMonitoring(_extraPaths: string[] = []): boolean {
  return false;
}
