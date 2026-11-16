import { isAbsolute } from 'node:path';

export const DIRECTORY_PICKER_CHANNEL = 'session-rooms:choose-directory';

function trustedMainFrame(event, activeWindow, trustedOrigin) {
  const sender = event?.sender;
  const frame = event?.senderFrame;
  if (!activeWindow || sender !== activeWindow.webContents || frame !== activeWindow.webContents.mainFrame) return false;
  try {
    return new URL(frame.url).origin === trustedOrigin && new URL(sender.getURL()).origin === trustedOrigin;
  } catch {
    return false;
  }
}

function requestedDefaultPath(payload) {
  if (payload === undefined) return undefined;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => key !== 'defaultPath')) throw new Error('DIRECTORY_PICKER_INVALID_REQUEST');
  if (payload.defaultPath === undefined) return undefined;
  if (typeof payload.defaultPath !== 'string') throw new Error('DIRECTORY_PICKER_INVALID_REQUEST');
  return payload.defaultPath;
}

async function existingDirectory(path, stat) {
  if (!path || !isAbsolute(path)) return false;
  try {
    return Boolean((await stat(path)).isDirectory());
  } catch {
    return false;
  }
}

export function createDirectoryPickerHandler({ getActiveWindow, getTrustedOrigin, showOpenDialog, stat }) {
  let selecting = false;
  return async (event, payload) => {
    const activeWindow = getActiveWindow();
    const trustedOrigin = getTrustedOrigin();
    if (!trustedMainFrame(event, activeWindow, trustedOrigin)) throw new Error('DIRECTORY_PICKER_UNTRUSTED_SENDER');
    const defaultPath = requestedDefaultPath(payload);
    if (selecting) throw new Error('DIRECTORY_PICKER_BUSY');
    selecting = true;
    try {
      const usableDefaultPath = defaultPath && await existingDirectory(defaultPath, stat) ? defaultPath : undefined;
      const result = await showOpenDialog(activeWindow, { properties: ['openDirectory'], ...(usableDefaultPath ? { defaultPath: usableDefaultPath } : {}) });
      const path = result?.filePaths?.[0];
      if (result?.canceled || !path) return { cancelled: true, path: null };
      if (!await existingDirectory(path, stat)) throw new Error('DIRECTORY_PICKER_INVALID_SELECTION');
      return { cancelled: false, path };
    } finally {
      selecting = false;
    }
  };
}
