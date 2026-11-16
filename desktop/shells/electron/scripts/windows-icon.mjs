import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const WINDOWS_PRODUCT_NAME = 'Session Rooms';
export const WINDOWS_FILE_DESCRIPTION = 'Session Rooms Desktop';
export function toWindowsVersion(appVersion) {
  if (!/^\d+\.\d+\.\d+$/.test(appVersion)) throw new Error(`app version must be major.minor.patch: ${appVersion}`);
  return `${appVersion}.0`;
}
export function readIcoFrameHashes(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) throw new Error('icon is not an ICO file');
  const count = bytes.readUInt16LE(4), tableEnd = 6 + count * 16;
  if (!count || tableEnd > bytes.length) throw new Error('icon has an invalid ICO directory');
  const frames = [];
  for (let i = 0; i < count; i += 1) { const offset = 6 + i * 16, size = bytes.readUInt32LE(offset + 8), start = bytes.readUInt32LE(offset + 12); if (!size || start < tableEnd || start + size > bytes.length) throw new Error('icon has an invalid ICO frame'); frames.push(sha256(bytes.subarray(start, start + size))); }
  return frames.sort();
}
export function assertEmbeddedIcon(sourceFrameHashes, groups) {
  const expected = [...sourceFrameHashes].sort().join(',');
  if (!Array.isArray(groups) || !groups.length) throw new Error('EXE has no RT_GROUP_ICON resource');
  const matching = groups[0];
  if (!Array.isArray(matching.frames) || [...matching.frames].sort().join(',') !== expected) throw new Error('EXE primary RT_ICON resources do not match the source ICO frames');
  return { groupId: matching.id, frameCount: sourceFrameHashes.length, frameHashes: [...sourceFrameHashes].sort() };
}
async function rceditExecutable() { const entry = fileURLToPath(import.meta.resolve('rcedit')); const executable = resolve(dirname(entry), '..', 'bin', process.arch === 'ia32' ? 'rcedit.exe' : 'rcedit-x64.exe'); await access(executable, constants.R_OK); return executable; }
export async function embedWindowsIcon(executable, icon) { await run(await rceditExecutable(), [executable, '--set-icon', icon], { windowsHide: true }); }
export async function stampWindowsVersion(executable, appVersion) {
  const windowsVersion = toWindowsVersion(appVersion), rcedit = await rceditExecutable();
  await run(rcedit, [executable,
    '--set-file-version', windowsVersion,
    '--set-product-version', windowsVersion,
    '--set-version-string', 'FileVersion', windowsVersion,
    '--set-version-string', 'ProductVersion', windowsVersion,
    '--set-version-string', 'ProductName', WINDOWS_PRODUCT_NAME,
    '--set-version-string', 'FileDescription', WINDOWS_FILE_DESCRIPTION,
  ], { windowsHide: true });
  return windowsVersion;
}
const quotePowerShell = value => value.replaceAll("'", "''");
export async function verifyWindowsVersionResources(executable, appVersion) {
  const windowsVersion = toWindowsVersion(appVersion);
  const script = `$ErrorActionPreference='Stop'; $info=[System.Diagnostics.FileVersionInfo]::GetVersionInfo('${quotePowerShell(executable)}'); [pscustomobject]@{FileVersion=$info.FileVersion;ProductVersion=$info.ProductVersion;ProductName=$info.ProductName;FileDescription=$info.FileDescription}|ConvertTo-Json -Compress`;
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  let actual;
  try { actual = JSON.parse(stdout); } catch { throw new Error(`could not read Windows version resources for ${executable}`); }
  const expected = { fileVersion: windowsVersion, productVersion: windowsVersion, productName: WINDOWS_PRODUCT_NAME, fileDescription: WINDOWS_FILE_DESCRIPTION };
  if (actual.FileVersion !== expected.fileVersion || actual.ProductVersion !== expected.productVersion || actual.ProductName !== expected.productName || actual.FileDescription !== expected.fileDescription) throw new Error(`Windows version resources do not match ${JSON.stringify({ expected, actual })}`);
  return expected;
}
const readbackScript = String.raw`$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class IconResourceReader { const uint F=2; delegate bool E(IntPtr m,IntPtr t,IntPtr n,IntPtr p); [DllImport("kernel32",EntryPoint="LoadLibraryExW",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadLibraryEx(string p,IntPtr h,uint f); [DllImport("kernel32")] static extern bool FreeLibrary(IntPtr m); [DllImport("kernel32")] static extern bool EnumResourceNames(IntPtr m,IntPtr t,E c,IntPtr p); [DllImport("kernel32")] static extern IntPtr FindResource(IntPtr m,IntPtr n,IntPtr t); [DllImport("kernel32")] static extern IntPtr LoadResource(IntPtr m,IntPtr r); [DllImport("kernel32")] static extern uint SizeofResource(IntPtr m,IntPtr r); [DllImport("kernel32")] static extern IntPtr LockResource(IntPtr r); static IntPtr I(int x){return new IntPtr(x);} static byte[] R(IntPtr m,IntPtr n,int t){IntPtr r=FindResource(m,n,I(t));if(r==IntPtr.Zero)throw new Exception("resource missing");uint z=SizeofResource(m,r);IntPtr d=LockResource(LoadResource(m,r));if(z==0||d==IntPtr.Zero)throw new Exception("resource unreadable");byte[] b=new byte[z];Marshal.Copy(d,b,0,(int)z);return b;} public static string Run(string p){IntPtr m=LoadLibraryEx(p,IntPtr.Zero,F);if(m==IntPtr.Zero)throw new Exception("LoadLibraryEx failed: "+Marshal.GetLastWin32Error());var g=new List<string>();try{EnumResourceNames(m,I(14),delegate(IntPtr a,IntPtr b,IntPtr n,IntPtr d){long id=n.ToInt64();if(id<0||id>65535)return true;byte[] x=R(a,n,14);if(x.Length<6)throw new Exception("invalid RT_GROUP_ICON");int c=BitConverter.ToUInt16(x,4);if(x.Length!=6+c*14)throw new Exception("invalid RT_GROUP_ICON entries");var f=new List<string>();for(int i=0;i<c;i++)f.Add(Convert.ToBase64String(R(a,I(BitConverter.ToUInt16(x,6+i*14+12)),3)));g.Add(id+"|"+String.Join(",",f));return true;},IntPtr.Zero);return String.Join("\n",g);}finally{FreeLibrary(m);}} }
'@
[IconResourceReader]::Run('__EXECUTABLE__')`;
export async function verifyEmbeddedWindowsIcon(executable, icon) { const [source, output] = await Promise.all([readFile(icon), run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(readbackScript.replace('__EXECUTABLE__', executable.replaceAll("'", "''")), 'utf16le').toString('base64')], { windowsHide: true })]); const groups = output.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => { const [id, frames] = line.split('|'); return { id: Number(id), frames: frames.split(',').map(frame => sha256(Buffer.from(frame, 'base64'))) }; }); return assertEmbeddedIcon(readIcoFrameHashes(source), groups); }
