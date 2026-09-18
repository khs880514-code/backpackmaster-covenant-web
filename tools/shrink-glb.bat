@echo off
chcp 65001 >/dev/null 2>&1
setlocal EnableDelayedExpansion
title TEN HITS - GLB 용량 줄이기

echo.
echo  ===========================================
echo   TEN HITS  -  GLB 파일 용량 줄이기
echo  ===========================================
echo.

rem --- Node.js 확인 -------------------------------------------------
where node >/dev/null 2>&1
if errorlevel 1 (
  echo  [!] Node.js 가 설치되어 있지 않습니다.
  echo.
  echo      https://nodejs.org  에서 왼쪽 LTS 버튼을 눌러 받으신 뒤,
  echo      설치가 끝나면 이 파일을 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)

rem --- 처리할 파일 모으기: 끌어다 놓은 것, 없으면 이 폴더의 모든 glb ---
set "FILES="
if not "%~1"=="" (
  for %%F in (%*) do set "FILES=!FILES! "%%~fF""
) else (
  for %%F in ("%~dp0*.glb") do (
    echo %%~nxF | findstr /i /c:".small.glb" >/dev/null || set "FILES=!FILES! "%%~fF""
  )
)

if "!FILES!"=="" (
  echo  [!] 줄일 .glb 파일이 없습니다.
  echo.
  echo      이 배치 파일과 같은 폴더에 .glb 를 두거나,
  echo      .glb 파일을 이 배치 파일 위로 끌어다 놓으세요.
  echo.
  pause
  exit /b 1
)

rem --- 작업 폴더 준비 (한 번만 설치되고 다음부터는 재사용) -----------
set "WORK=%TEMP%\ten-hits-shrink"
if not exist "%WORK%" mkdir "%WORK%"
pushd "%WORK%"

if not exist "%WORK%\node_modules" (
  echo  처음 실행이라 필요한 도구를 내려받습니다. 몇 분 걸립니다...
  echo.
  call npm install --silent --no-fund --no-audit --no-package-lock @gltf-transform/core@^4.5.0 @gltf-transform/extensions@^4.5.0 @gltf-transform/functions@^4.5.0 meshoptimizer sharp@^0.35.4
  if errorlevel 1 (
    echo.
    echo  [!] 도구 설치에 실패했습니다. 인터넷 연결을 확인하고 다시 실행해 주세요.
    popd
    pause
    exit /b 1
  )
)

echo  최신 스크립트를 받는 중...
curl -sS -o "%WORK%\shrink-glb.mjs" "https://raw.githubusercontent.com/khs880514-code/backpackmaster-covenant-web/claude/production-g-lgo5o8/tools/shrink-glb.mjs"
if not exist "%WORK%\shrink-glb.mjs" (
  echo  [!] 스크립트를 받지 못했습니다. 인터넷 연결을 확인해 주세요.
  popd
  pause
  exit /b 1
)

echo.
node "%WORK%\shrink-glb.mjs" !FILES!
popd

echo.
echo  ===========================================
echo   끝났습니다.
echo   원본 옆에 생긴  *.small.glb  파일을 올려 주세요.
echo   원본은 그대로 있습니다.
echo  ===========================================
echo.
pause
