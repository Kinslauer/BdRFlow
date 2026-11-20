@echo off
rem Desktop launcher: runs the newest copy of the updater.
if exist "E:\BdRFlow-build\BdRFlow\scripts\windows\update-flow.bat" (
    "E:\BdRFlow-build\BdRFlow\scripts\windows\update-flow.bat" %*
) else (
    "E:\BdRFlow-build\update-flow.bat" %*
)
