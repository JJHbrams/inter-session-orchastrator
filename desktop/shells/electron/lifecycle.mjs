export function drainChildStderr(child) {
  child.stderr?.resume();
}

export async function stopOwnedChild(child, { graceMs = 7000 } = {}) {
  if (!child) return { normal: true, forced: false, exitCode: null, signalCode: null };
  if (child.exitCode !== null || child.signalCode !== null) return { normal: child.exitCode === 0 && child.signalCode === null, forced: false, exitCode: child.exitCode, signalCode: child.signalCode };
  return new Promise(resolve => {
    let forced = false;
    let complete = false;
    let forcedExitTimer;
    const finish = () => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      clearTimeout(forcedExitTimer);
      child.removeListener('exit', finish);
      resolve({ normal: !forced && child.exitCode === 0 && child.signalCode === null, forced, exitCode: child.exitCode, signalCode: child.signalCode });
    };
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        forced = true;
        try { child.kill(); } catch {}
        forcedExitTimer = setTimeout(finish, 1000);
      }
    }, graceMs);
    child.once('exit', finish);
    const input = child.stdin;
    if (!input || input.destroyed || input.writable === false) { forced = true; try { child.kill(); } catch {} forcedExitTimer = setTimeout(finish, 1000); return; }
    input.once('error', () => {});
    try { input.write('{"type":"shutdown"}\n'); } catch {}
    try { input.end(); } catch {}
  });
}
