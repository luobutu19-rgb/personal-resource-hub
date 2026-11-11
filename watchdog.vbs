Option Explicit
' Watchdog: keep "My Resource Station" alive. Starts it hidden if not responding.
Dim sh, fso, root, logs, nodeExe, f
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
logs = root & "\logs"
If Not fso.FolderExists(logs) Then fso.CreateFolder(logs)
Set f = fso.OpenTextFile(logs & "\watchdog.log", 8, True)

nodeExe = sh.ExpandEnvironmentStrings("%USERPROFILE%") & _
  "\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node.exe"

sh.CurrentDirectory = root
f.WriteLine Now & "  watchdog started, node=" & nodeExe

Dim startedAt
startedAt = False

Do
  If Not ServiceUp() Then
    f.WriteLine Now & "  service down, starting"
    startedAt = Now
    ' True = wait until node exits, so we notice a crash and restart
    sh.Run """" & nodeExe & """ """ & root & "\server\index.js""", 0, True
    f.WriteLine Now & "  node exited (was up since " & startedAt & ")"
    WScript.Sleep 3000
  End If
  WScript.Sleep 10000
Loop

Function ServiceUp()
  Dim xhr
  ServiceUp = False
  On Error Resume Next
  Set xhr = CreateObject("MSXML2.XMLHTTP")
  xhr.Open "GET", "http://127.0.0.1:5178/", False
  xhr.Send
  If Err.Number = 0 Then
    If xhr.Status >= 200 And xhr.Status < 500 Then ServiceUp = True
  End If
  Err.Clear
  On Error Goto 0
End Function
