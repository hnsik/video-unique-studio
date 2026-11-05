[Setup]
AppId=VideoDownloaderStudio
AppName=Video Downloader Studio
AppVersion=1.1.1
DefaultDirName={localappdata}\Programs\VideoDownloaderStudio
DefaultGroupName=Video Downloader Studio
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=release
OutputBaseFilename=Video-Downloader-Studio-Setup-1.1.1-x64
SetupIconFile=app.ico
UninstallDisplayIcon={app}\VideoDownloaderStudio.exe
Compression=lzma2
SolidCompression=yes
CloseApplications=yes
[Files]
Source: "dist\VideoDownloaderStudio\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{autodesktop}\Video Downloader Studio"; Filename: "{app}\VideoDownloaderStudio.exe"; IconFilename: "{app}\VideoDownloaderStudio.exe"
Name: "{group}\Video Downloader Studio"; Filename: "{app}\VideoDownloaderStudio.exe"
[Run]
Filename: "{app}\VideoDownloaderStudio.exe"; Description: "Start Video Downloader Studio"; Flags: nowait postinstall skipifsilent
