' qq-bridge control center without a console window.
' Opens the control center page in your browser. Use the "exit" button on the page to quit.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = here
sh.Run "cmd /d /c node src\launcher\control-center.mjs", 0, False
