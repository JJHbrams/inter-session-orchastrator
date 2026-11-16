#ifndef PayloadDir
  #error PayloadDir must point to the validated portable package directory.
#endif
#ifndef OutputDir
  #error OutputDir must be supplied by the release wrapper.
#endif
#ifndef AppVersion
  #error AppVersion must be supplied by the release wrapper.
#endif
#ifndef WindowsVersion
  #error WindowsVersion must be supplied by the release wrapper.
#endif
#ifndef SetupFilename
  #error SetupFilename must be supplied by the release wrapper.
#endif

[Setup]
AppId={{D674A270-D9A5-4F31-A37B-A6BB53D7C7B2}
AppName=Session Rooms
AppVersion={#AppVersion}
AppPublisher=Session Rooms
DefaultDirName={localappdata}\Programs\Session Rooms
DisableDirPage=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename={#SetupFilename}
SetupIconFile={#PayloadDir}\resources\runtime\app\apps\desktop\assets\brand\session-rooms.ico
UninstallDisplayIcon={app}\SessionRooms-Electron.exe
VersionInfoVersion={#WindowsVersion}
VersionInfoProductVersion={#WindowsVersion}
VersionInfoProductName=Session Rooms
VersionInfoDescription=Session Rooms Setup
Compression=lzma2/fast
SolidCompression=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; Flags: unchecked

[Icons]
Name: "{autoprograms}\Session Rooms"; Filename: "{app}\SessionRooms-Electron.exe"
Name: "{autodesktop}\Session Rooms"; Filename: "{app}\SessionRooms-Electron.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\SessionRooms-Electron.exe"; Description: "{cm:LaunchProgram,Session Rooms}"; Flags: nowait postinstall skipifsilent
