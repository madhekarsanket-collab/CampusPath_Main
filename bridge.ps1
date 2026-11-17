# bridge.ps1 - Environment Automation Script for CampusPath
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  CampusPath Dev Bridge & Sync Script     " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Kill any process currently occupying port 8080
Write-Host "`n[1/3] Checking for processes on port 8080..." -ForegroundColor Yellow
$port8080Processes = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique

if ($port8080Processes) {
    foreach ($pidToKill in $port8080Processes) {
        try {
            $processName = (Get-Process -Id $pidToKill -ErrorAction SilentlyContinue).ProcessName
            Write-Host "Killing process on port 8080 (PID: $pidToKill, Name: $processName)..." -ForegroundColor Magenta
            Stop-Process -Id $pidToKill -Force -ErrorAction Stop
            Write-Host "Process $pidToKill terminated successfully." -ForegroundColor Green
        } catch {
            Write-Warning "Could not terminate process PID: $pidToKill. Error: $_"
        }
    }
} else {
    Write-Host "Port 8080 is clear." -ForegroundColor Green
}

# 2. Run Capacitor Sync for Frontend
Write-Host "`n[2/3] Running Capacitor Sync for Frontend..." -ForegroundColor Yellow
$frontendPath = Join-Path $PSScriptRoot "Frontend"

if (Test-Path $frontendPath) {
    Push-Location $frontendPath
    try {
        if (Get-Command "npx" -ErrorAction SilentlyContinue) {
            npx cap sync
        } elseif (Test-Path "C:\Users\SANKET MADHEKAR\AppData\Local\hermes\node\npx.cmd") {
            & "C:\Users\SANKET MADHEKAR\AppData\Local\hermes\node\npx.cmd" cap sync
        } else {
            npx cap sync
        }

        if ($LASTEXITCODE -eq 0) {
            Write-Host "Capacitor sync completed successfully!" -ForegroundColor Green
        } else {
            Write-Warning "Capacitor sync exited with code: $LASTEXITCODE"
        }
    } catch {
        Write-Warning "Error during cap sync: $_"
    } finally {
        Pop-Location
    }
} else {
    Write-Error "Could not find Frontend folder at $frontendPath"
}

# 3. Setup ADB Reverse for Physical Device
Write-Host "`n[3/3] Setting up ADB Reverse for port 8080..." -ForegroundColor Yellow
$adbPath = "D:\Android Studio SDK Components\platform-tools\adb.exe"

if (Test-Path $adbPath) {
    & $adbPath reverse tcp:8080 tcp:8080
    if ($LASTEXITCODE -eq 0) {
        Write-Host "ADB Reverse established successfully (Device tcp:8080 -> PC tcp:8080)!" -ForegroundColor Green
    } else {
        Write-Warning "ADB reverse command failed. Ensure your Android device is connected via USB with USB debugging enabled."
    }
} else {
    Write-Warning "ADB executable not found at '$adbPath'. Please verify the path."
}

# Success & Next Steps Reminder
Write-Host "`n===========================================================" -ForegroundColor Cyan
Write-Host " Setup complete! Ready to start application:" -ForegroundColor Green
Write-Host " 1. Click 'Run' on your Spring Boot backend in VS Code" -ForegroundColor White
Write-Host " 2. Click 'Play' in Android Studio to launch the app" -ForegroundColor White
Write-Host "===========================================================`n" -ForegroundColor Cyan
