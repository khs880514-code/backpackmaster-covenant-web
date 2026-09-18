# TEN HITS - GLB 용량 줄이기
#
# 내려받을 파일이 없습니다. PowerShell 창에 아래 한 줄을 붙여넣으면 됩니다:
#
#   irm https://raw.githubusercontent.com/khs880514-code/backpackmaster-covenant-web/claude/production-g-lgo5o8/tools/shrink-glb.ps1 | iex
#
# GitHub은 .bat 파일을 text/plain 으로 내려보내기 때문에 Windows가 .txt 를 붙여
# 메모장 파일이 되어 버립니다. 이 방식은 파일을 저장하지 않으므로 그 문제가 없습니다.

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Branch = 'claude/production-g-lgo5o8'
$Base = "https://raw.githubusercontent.com/khs880514-code/backpackmaster-covenant-web/$Branch/tools"
$Work = Join-Path $env:TEMP 'ten-hits-shrink'

Write-Host ''
Write-Host ' ===========================================' -ForegroundColor Cyan
Write-Host '  TEN HITS  -  GLB 파일 용량 줄이기' -ForegroundColor Cyan
Write-Host ' ===========================================' -ForegroundColor Cyan
Write-Host ''

# --- Node.js 확인 ---------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ' [!] Node.js 가 설치되어 있지 않습니다.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '     https://nodejs.org  에서 왼쪽 LTS 버튼을 눌러 설치한 뒤,'
  Write-Host '     PowerShell 창을 새로 열고 다시 붙여넣어 주세요.'
  Write-Host ''
  return
}

# --- 파일 받기: 창으로 끌어다 놓으면 경로가 들어옵니다 --------------------
Write-Host ' 줄일 .glb 파일을 이 창으로 끌어다 놓고 Enter 를 누르세요.' -ForegroundColor Green
Write-Host ' 여러 개를 한 번에 끌어다 놓아도 됩니다.'
Write-Host ' 다 넣었으면 아무것도 없이 Enter 를 한 번 더 누르세요.'
Write-Host ''

$files = @()
while ($true) {
  $line = Read-Host ' 파일'
  if ([string]::IsNullOrWhiteSpace($line)) { break }

  # 여러 개를 한 번에 끌어다 놓으면 한 줄에 이어져 들어옵니다. 경로에 공백이
  # 있으면 따옴표가 붙고, 없으면 그냥 공백으로만 이어지므로 따옴표에 기댈 수
  # 없습니다. 드라이브 문자(C:\) 나 네트워크 경로(\\) 앞에서 자릅니다.
  $paths = @([regex]::Split(($line -replace '"', ''), '(?=(?:[A-Za-z]:\\|\\\\))') |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -ne '' })
  if ($paths.Count -eq 0) { $paths = @($line.Trim()) }

  foreach ($path in $paths) {
    if (Test-Path -LiteralPath $path) {
      $files += (Resolve-Path -LiteralPath $path).Path
      Write-Host ("   + " + (Split-Path $path -Leaf)) -ForegroundColor DarkGray
    } else {
      Write-Host "   ? 찾을 수 없습니다: $path" -ForegroundColor Yellow
    }
  }
}

# 작업자가 내보낸 파일은 .glb 일 수도, .glb.raw 일 수도 있습니다.
$files = @($files | Where-Object { $_ -match '\.(glb|glb\.raw|raw)$' } | Select-Object -Unique)
if ($files.Count -eq 0) {
  Write-Host ''
  Write-Host ' [!] 처리할 파일이 없습니다 (.glb / .glb.raw 만 받습니다).' -ForegroundColor Yellow
  Write-Host ''
  return
}

Write-Host ''
Write-Host (' 파일 ' + $files.Count + '개를 처리합니다.') -ForegroundColor Green

# --- 도구 준비 (처음 한 번만 설치되고 다음부터 재사용) --------------------
if (-not (Test-Path $Work)) { New-Item -ItemType Directory -Path $Work | Out-Null }
Push-Location $Work
try {
  if (-not (Test-Path (Join-Path $Work 'node_modules'))) {
    Write-Host ''
    Write-Host ' 처음 실행이라 필요한 도구를 내려받습니다. 몇 분 걸립니다...' -ForegroundColor DarkGray
    # 패키지 이름이 @ 로 시작하므로 반드시 따옴표로 감싸야 합니다.
    & npm install --silent --no-fund --no-audit --no-package-lock `
      '@gltf-transform/core@^4.5.0' '@gltf-transform/extensions@^4.5.0' `
      '@gltf-transform/functions@^4.5.0' 'meshoptimizer' 'sharp@^0.35.4'
    if ($LASTEXITCODE -ne 0) {
      Write-Host ' [!] 도구 설치에 실패했습니다. 인터넷 연결을 확인해 주세요.' -ForegroundColor Yellow
      return
    }
  }

  Write-Host ' 최신 스크립트를 받는 중...' -ForegroundColor DarkGray
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/shrink-glb.mjs" -OutFile (Join-Path $Work 'shrink-glb.mjs')

  Write-Host ''
  & node (Join-Path $Work 'shrink-glb.mjs') @files
}
finally { Pop-Location }

Write-Host ''
Write-Host ' ===========================================' -ForegroundColor Cyan
Write-Host '  끝났습니다.' -ForegroundColor Cyan
Write-Host '  원본 옆에 생긴  *.small.glb  파일을 올려 주세요.' -ForegroundColor Cyan
Write-Host '  원본은 그대로 있습니다.' -ForegroundColor Cyan
Write-Host ' ===========================================' -ForegroundColor Cyan
Write-Host ''

try { Invoke-Item (Split-Path $files[0] -Parent) } catch { }
