/**
 * One same-origin download action for every Windows-only desktop download
 * button. Do not expose GitHub or direct installer URLs in the page.
 */
export async function downloadFlixLeoWindows(): Promise<void> {
  try {
    const response = await fetch('/api/download/windows/status', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin'
    });
    if (!response.ok) throw new Error('download status unavailable');
    const status = await response.json() as { ready?: boolean };
    if (!status.ready) {
      window.alert('The signed FlixLeo Windows installer is being prepared. Please try again later.');
      return;
    }
    window.location.assign('/api/download/windows');
  } catch {
    window.alert('Unable to start the Windows app download right now. Please try again shortly.');
  }
}
