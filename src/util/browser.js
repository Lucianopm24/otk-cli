/**
 * Best-effort browser opener. The CLI never *requires* it: the login URL is
 * always printed so the user can click or copy it.
 * Strategies are tried sequentially until one successfully spawns.
 */

import { spawn } from 'node:child_process';

export async function openBrowser(url, options = {}) {
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
      const spawned = await new Promise((resolve) => {
        let child;
        try {
          child = spawnImpl(command, args, { stdio: 'ignore', detached: true });
        } catch {
          resolve(false);
          return;
        }
        if (!child || typeof child.once !== 'function') {
          // nothing to listen on (unusual spawn implementation): assume it worked
          child?.unref?.();
          resolve(true);
          return;
        }
        child.once('spawn', () => {
          child.unref?.();
          resolve(true);
        });
        child.once('error', () => {
          resolve(false);
        });
      });
      if (spawned) return true;
    } catch {
      /* try the next strategy */
    }
  }
  return false;
}
