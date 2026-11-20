@echo off
rem ===========================================================================
rem  Update Flow (BdRFlow fork) on Windows - one click.
rem
rem  Pulls the latest fork code from GitHub, builds the NSIS installer and
rem  installs it silently to INSTALL_DIR. Every step stops with a clear message
rem  if it fails. A log of each run is written to %BUILD_ROOT%\logs.
rem
rem  It never touches the separate "Flow Beta" app.
rem ===========================================================================
setlocal EnableExtensions EnableDelayedExpansion

rem ---- Settings (change these if your folders move) -------------------------
set "BUILD_ROOT=E:\BdRFlow-build"
set "REPO_DIR=%BUILD_ROOT%\BdRFlow"
set "REPO_URL=https://github.com/Kinslauer/BdRFlow.git"
set "BRANCH=main"
set "INSTALL_DIR=E:\Flow"
set "VCVARS=%BUILD_ROOT%\vs\VC\Auxiliary\Build\vcvars64.bat"
rem ---------------------------------------------------------------------------

rem cmd reads a .bat file while it runs, so "git pull" changing this file mid-run
rem would break it. Run from a temporary copy instead.
if /i not "%~1"=="--from-copy" (
    if not exist "%BUILD_ROOT%\tmp" mkdir "%BUILD_ROOT%\tmp" >nul 2>&1
    copy /y "%~f0" "%BUILD_ROOT%\tmp\update-flow-running.bat" >nul || (
        echo Could not copy the script to "%BUILD_ROOT%\tmp". Is drive E: connected?
        pause
        exit /b 1
    )
    "%BUILD_ROOT%\tmp\update-flow-running.bat" --from-copy %*
    exit /b !ERRORLEVEL!
)
set "FORCE=0"
if /i "%~2"=="--force" set "FORCE=1"

title Updating Flow
set "STATE_FILE=%BUILD_ROOT%\last-installed-commit.txt"
set "LOCK_FILE=%BUILD_ROOT%\tmp\update-flow.lock"
if not exist "%BUILD_ROOT%\logs" mkdir "%BUILD_ROOT%\logs"
for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "STAMP=%%T"
set "LOG=%BUILD_ROOT%\logs\update-%STAMP%.log"

rem ---- Build environment: keep everything big on E: (C: is nearly full) ------
set "CARGO_TARGET_DIR=%BUILD_ROOT%\target"
set "CARGO_HOME=%BUILD_ROOT%\cargo-home"
set "TEMP=%BUILD_ROOT%\tmp"
set "TMP=%BUILD_ROOT%\tmp"
set "npm_config_store_dir=E:\.pnpm-store"
set "npm_config_cache_dir=%BUILD_ROOT%\pnpm-cache"
set "npm_config_confirm_modules_purge=false"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

echo.
echo  ==========================================
echo    Flow updater  (log: %LOG%)
echo  ==========================================
echo.

rem ---- Only one update at a time ---------------------------------------------
if exist "%LOCK_FILE%" (
    powershell -NoProfile -Command "if (((Get-Date) - (Get-Item '%LOCK_FILE%').LastWriteTime).TotalHours -lt 3) { exit 1 }"
    if errorlevel 1 (
        call :fail "Another update looks like it is already running. If it is not, delete %LOCK_FILE% and try again."
        exit /b 1
    )
)
> "%LOCK_FILE%" echo %STAMP%

rem ---- 1. Check tools ---------------------------------------------------------
call :step "1/6  Checking tools"
set "GIT="
for /f "delims=" %%G in ('where git 2^>nul') do if not defined GIT set "GIT=%%G"
if not defined GIT if exist "%ProgramFiles%\Git\cmd\git.exe" set "GIT=%ProgramFiles%\Git\cmd\git.exe"
if not defined GIT if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set "GIT=%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
if not defined GIT ( call :fail "Git was not found. Install Git for Windows from https://git-scm.com and try again." & exit /b 1 )
where pnpm.cmd >nul 2>&1 || ( call :fail "pnpm was not found. Install Node.js, then run: npm install -g pnpm" & exit /b 1 )
where cargo >nul 2>&1 || ( call :fail "Rust (cargo) was not found. Install it from https://rustup.rs" & exit /b 1 )
for %%D in ("%GIT%") do set "PATH=%%~dpD;%PATH%"
call :log "git: %GIT%"

rem ---- 2. Get the latest code -------------------------------------------------
call :step "2/6  Getting the latest code from GitHub"
if not exist "%REPO_DIR%\.git" (
    call :log "No checkout at %REPO_DIR%, cloning it."
    git clone --branch %BRANCH% "%REPO_URL%" "%REPO_DIR%" >>"%LOG%" 2>&1 || ( call :fail "Could not download the code from GitHub. Check your internet connection." & exit /b 1 )
)
cd /d "%REPO_DIR%" || ( call :fail "Could not open %REPO_DIR%." & exit /b 1 )
git fetch origin %BRANCH% >>"%LOG%" 2>&1 || ( call :fail "Could not reach GitHub (git fetch failed). Check your internet connection." & exit /b 1 )

rem Local edits in the build copy would block the update: put them aside safely.
set "DIRTY="
for /f "delims=" %%S in ('git status --porcelain --untracked-files=no') do set "DIRTY=1"
if defined DIRTY (
    call :log "Local changes found in %REPO_DIR%; saving them with git stash."
    git -c user.name=flow-updater -c user.email=flow-updater@localhost stash push -m "update-flow auto-stash %STAMP%" >>"%LOG%" 2>&1 || ( call :fail "There are local changes in %REPO_DIR% that could not be set aside." & exit /b 1 )
    echo    Note: local edits in the build folder were saved with "git stash".
)
git checkout %BRANCH% >>"%LOG%" 2>&1 || ( call :fail "Could not switch to the %BRANCH% branch." & exit /b 1 )
git merge --ff-only origin/%BRANCH% >>"%LOG%" 2>&1 || ( call :fail "The build copy has its own commits and cannot simply be updated. Ask Claude to sort out %REPO_DIR%." & exit /b 1 )
for /f %%C in ('git rev-parse --short HEAD') do set "COMMIT=%%C"
for /f "delims=" %%M in ('git log -1 --format^=%%s') do set "SUBJECT=%%M"
echo    Latest: !COMMIT!  !SUBJECT!
call :log "HEAD is !COMMIT!"

set "LAST="
if exist "%STATE_FILE%" set /p LAST=<"%STATE_FILE%"
if "%FORCE%"=="0" if "!LAST!"=="!COMMIT!" if exist "%INSTALL_DIR%\flow.exe" (
    echo.
    echo    Flow is already up to date ^(!COMMIT!^).
    choice /c YN /n /t 15 /d N /m "   Rebuild and reinstall anyway? [Y/N, N in 15s] "
    if errorlevel 2 (
        del "%LOCK_FILE%" >nul 2>&1
        echo    Nothing to do.
        timeout /t 5 >nul
        exit /b 0
    )
)

rem ---- 3. Install dependencies -----------------------------------------------
call :step "3/6  Installing dependencies (pnpm install)"
call :run "call pnpm.cmd install --frozen-lockfile" || (
    call :log "Frozen install failed; retrying a normal install."
    call :run "call pnpm.cmd install" || ( call :fail "pnpm install failed. See the log for details." & exit /b 1 )
)

rem ---- 4. Build ---------------------------------------------------------------
call :step "4/6  Building Flow (this takes about 30-40 minutes)"
if not exist "%VCVARS%" call :find_vcvars
if exist "%VCVARS%" call "%VCVARS%" >>"%LOG%" 2>&1
where cl >nul 2>&1 || ( call :fail "The Visual Studio C++ build tools were not found (looked for %VCVARS%)." & exit /b 1 )

set "BUILD_CMD=call pnpm.cmd tauri build --config src-tauri/tauri.local.conf.json --bundles nsis"
call :run "%BUILD_CMD%"
if errorlevel 1 (
    rem The PC has run out of memory during the Rust compile before. Retry with
    rem fewer parallel jobs; cargo keeps finished work, so the retry is quicker.
    set /a JOBS=%NUMBER_OF_PROCESSORS% / 2
    if !JOBS! LSS 1 set "JOBS=1"
    set "CARGO_BUILD_JOBS=!JOBS!"
    echo.
    echo    The build failed once ^(often low memory^). Retrying with !JOBS! parallel jobs...
    call :log "Retrying build with CARGO_BUILD_JOBS=!JOBS!"
    call :run "%BUILD_CMD%" || ( call :fail "The build failed twice. Close other big programs and try again, or send the log to Claude." & exit /b 1 )
)

set "INSTALLER="
for /f "delims=" %%F in ('dir /b /o-d "%CARGO_TARGET_DIR%\release\bundle\nsis\*-setup.exe" 2^>nul') do if not defined INSTALLER set "INSTALLER=%CARGO_TARGET_DIR%\release\bundle\nsis\%%F"
if not defined INSTALLER ( call :fail "The build finished but no installer was found in %CARGO_TARGET_DIR%\release\bundle\nsis." & exit /b 1 )
call :log "Installer: !INSTALLER!"

rem ---- 5. Install -------------------------------------------------------------
call :step "5/6  Installing to %INSTALL_DIR%"
rem Close only the Flow running from INSTALL_DIR, never Flow Beta.
powershell -NoProfile -Command "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like '%INSTALL_DIR%\*' } | ForEach-Object { Write-Host ('   Closing ' + $_.Path); $_.CloseMainWindow() | Out-Null; if (-not $_.WaitForExit(8000)) { Stop-Process -Id $_.Id -Force } }"
start "" /wait "!INSTALLER!" /S /D=%INSTALL_DIR%
set "INSTALL_EXIT=!ERRORLEVEL!"
call :log "Installer exit code !INSTALL_EXIT!"
if not "!INSTALL_EXIT!"=="0" ( call :fail "The installer reported an error (code !INSTALL_EXIT!)." & exit /b 1 )
if not exist "%INSTALL_DIR%\flow.exe" ( call :fail "The installer ran, but %INSTALL_DIR%\flow.exe is missing." & exit /b 1 )
> "%STATE_FILE%" echo !COMMIT!

rem ---- 6. Done ----------------------------------------------------------------
call :step "6/6  Done"
del "%LOCK_FILE%" >nul 2>&1
echo.
echo    Flow is updated to !COMMIT! and installed in %INSTALL_DIR%.
echo    Starting Flow...
start "" "%INSTALL_DIR%\flow.exe"
echo.
echo    This window closes in 20 seconds.
timeout /t 20 >nul
exit /b 0

rem ===========================================================================
:step
echo.
echo  ^>^> %~1
>>"%LOG%" echo.
>>"%LOG%" echo ==== %~1 ====
exit /b 0

:log
>>"%LOG%" echo %~1
exit /b 0

rem Run a command, showing its output and saving it to the log.
:run
>>"%LOG%" echo $ %~1
powershell -NoProfile -Command "& cmd /d /c '%~1 2>&1' | ForEach-Object { Write-Host $_; Add-Content -LiteralPath '%LOG%' -Value $_ }; exit $LASTEXITCODE"
exit /b %ERRORLEVEL%

:find_vcvars
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" exit /b 0
for /f "usebackq delims=" %%V in (`""%VSWHERE%" -latest -products * -property installationPath"`) do set "VCVARS=%%V\VC\Auxiliary\Build\vcvars64.bat"
exit /b 0

:fail
del "%LOCK_FILE%" >nul 2>&1
>>"%LOG%" echo FAILED: %~1
echo.
echo  ******************************************************************
echo   UPDATE FAILED
echo   %~1
echo.
echo   Your installed Flow was not changed.
echo   Log: %LOG%
echo  ******************************************************************
echo.
pause
exit /b 1
