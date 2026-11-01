// Windows Script Host JScript; run by the managed Node updater via cscript.exe.
var shell = new ActiveXObject('WScript.Shell');
var env = shell.Environment('Process');
var filesystem = new ActiveXObject('Scripting.FileSystemObject');
var folders = ['Desktop', 'Programs'];
for (var i = 0; i < folders.length; i++) {
  var folder = shell.SpecialFolders(folders[i]);
  if (!folder || !filesystem.FolderExists(folder)) throw new Error('Windows shortcut folder unavailable.');
  var shortcut = shell.CreateShortcut(filesystem.BuildPath(folder, 'CryLo Daemon.lnk'));
  shortcut.TargetPath = env('CRYLO_COMMAND_PROCESSOR');
  shortcut.Arguments = '/d /c ""' + env('CRYLO_DAEMON_LAUNCHER') + '""';
  shortcut.WorkingDirectory = env('CRYLO_ROOT');
  shortcut.IconLocation = env('CRYLO_DAEMON_ICON');
  shortcut.Description = 'Start the local CryLo Layer 1 daemon';
  shortcut.Save();
}
var obsolete = filesystem.BuildPath(shell.SpecialFolders('Programs'), 'CryLo Daemon - Background.lnk');
if (filesystem.FileExists(obsolete)) filesystem.DeleteFile(obsolete, true);
