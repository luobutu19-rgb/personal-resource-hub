Option Explicit
' Start "My Resource Station" silently at user logon (no console window).
Dim sh, fso, root, nodeExe
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)

nodeExe = sh.ExpandEnvironmentStrings("%USERPROFILE%") & _
  "\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node.exe"

sh.CurrentDirectory = root
' 0 = hidden window, False = do not wait
sh.Run """" & nodeExe & """ """ & root & "\server\index.js""", 0, False
