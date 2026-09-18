/**
 * Best-effort browser opener. The CLI never *requires* it: the login URL is
 * always printed so the user can click or copy it.
 */

import { spawn } from 'node:child_process';

export function openBrowser(url, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const spawnImpl = options.spawnImpl || spawn;
  const attempts = [];

  if (env.WSL_DISTRO_NAME) attempts.push(['wslview', [url]]);
  if (platform === 'win32') {
    attempts.push(['cmd', ['/c', 'start', '', url]]);
    attempts.push(['rundll32', ['url.dll,FileProtocolHandler', url]]);
  } else if (platform === 'darwin') {
    attempts.push(['open', [url]]);
  } else {
    attempts.push(['xdg-open', [url]]);
    attempts.push(['gio', ['open', url]]);
  }
  if (env.WSL_DISTRO_NAME && platform !== 'win32') attempts.push(['cmd.exe', ['/c', 'start', '', url]]);

  for (const [command, args] of attempts) {
    try {
      const child = spawnImpl(command, args, { stdio: 'ignore', detached: true });
      child?.on?.('error', () => {});
      child?.unref?.();
      return true;
    } catch {
      /* try the next strategy */
    }
  }
  return false;
}
