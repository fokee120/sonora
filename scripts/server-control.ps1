param([switch]$StartHidden)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SonoraConsoleWindow {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
}
'@
[SonoraConsoleWindow]::ShowWindow([SonoraConsoleWindow]::GetConsoleWindow(), 0) | Out-Null
[System.Windows.Forms.Application]::EnableVisualStyles()

$root = Split-Path -Parent $PSScriptRoot
$settingsFile = Join-Path $root '.sonora\server-control.json'
$logFile = Join-Path $root '.sonora\logs\server-control.log'
$runner = Join-Path $root 'scripts\server-control-runner.cjs'
New-Item -ItemType Directory -Path (Split-Path $logFile) -Force | Out-Null
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\SonoraServerControl', [ref]$created)
if (-not $created) {
    [System.Windows.Forms.MessageBox]::Show('Sonora Server is already running. Open it from the system tray.', 'Sonora Server') | Out-Null
    $mutex.Dispose()
    return
}

$script:serverProcess = $null
$script:quitting = $false
$script:logPosition = [long]0
$script:startupTime = [datetime]::MinValue
$script:lastMemoryUpdate = [datetime]::MinValue
$startMinimized = $false
try { if (Test-Path $settingsFile) { $startMinimized = [bool](Get-Content -Raw -LiteralPath $settingsFile | ConvertFrom-Json).startMinimized } } catch {}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Sonora Server'
$form.Size = New-Object System.Drawing.Size(780, 560)
$form.MinimumSize = New-Object System.Drawing.Size(600, 420)
$form.StartPosition = 'CenterScreen'
$form.BackColor = [System.Drawing.Color]::FromArgb(17, 20, 28)
$form.ForeColor = [System.Drawing.Color]::FromArgb(237, 240, 249)
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$iconFile = Join-Path $root 'public\sonora-server.ico'
try { $form.Icon = New-Object System.Drawing.Icon($iconFile) }
catch { $form.Icon = [System.Drawing.SystemIcons]::Application }
$form.Add_HandleCreated({
    # Windows 11 uses the caption color; older Windows versions use dark mode.
    try {
        $dark = 1
        $caption = 0x1c1411
        $text = 0xf9f0ed
        [SonoraConsoleWindow]::DwmSetWindowAttribute($form.Handle, 20, [ref]$dark, 4) | Out-Null
        [SonoraConsoleWindow]::DwmSetWindowAttribute($form.Handle, 35, [ref]$caption, 4) | Out-Null
        [SonoraConsoleWindow]::DwmSetWindowAttribute($form.Handle, 36, [ref]$text, 4) | Out-Null
    } catch {}
})

$header = New-Object System.Windows.Forms.Label
$header.Text = 'Sonora Server'
$header.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 18)
$header.AutoSize = $true
$header.Location = New-Object System.Drawing.Point(20, 16)
$form.Controls.Add($header)
$status = New-Object System.Windows.Forms.Label
$status.Text = 'Starting...'
$status.AutoSize = $true
$status.Location = New-Object System.Drawing.Point(23, 56)
$form.Controls.Add($status)
$memory = New-Object System.Windows.Forms.Label
$memory.Text = 'Server RAM: --'
$memory.AutoSize = $true
$memory.Anchor = 'Top,Right'
$memory.Location = New-Object System.Drawing.Point(565, 56)
$memory.ForeColor = [System.Drawing.Color]::FromArgb(170, 189, 218)
$form.Controls.Add($memory)

$buttons = New-Object System.Windows.Forms.FlowLayoutPanel
$buttons.Location = New-Object System.Drawing.Point(20, 88)
$buttons.Size = New-Object System.Drawing.Size(710, 44)
$buttons.Anchor = 'Top,Left,Right'
$form.Controls.Add($buttons)
function New-ControlButton([string]$text) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $text
    $button.Size = New-Object System.Drawing.Size(122, 36)
    $button.FlatStyle = 'Flat'
    $button.BackColor = [System.Drawing.Color]::FromArgb(37, 43, 57)
    $button.ForeColor = [System.Drawing.Color]::White
    $button.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(65, 76, 96)
    $buttons.Controls.Add($button)
    return $button
}
$startButton = New-ControlButton 'Start server'
$stopButton = New-ControlButton 'Stop server'
$resetButton = New-ControlButton 'Reset'
$openButton = New-ControlButton 'Open Sonora'

$minimized = New-Object System.Windows.Forms.CheckBox
$minimized.Text = 'Start minimized to tray'
$minimized.Checked = $startMinimized
$minimized.AutoSize = $true
$minimized.Location = New-Object System.Drawing.Point(23, 140)
$form.Controls.Add($minimized)
$logLabel = New-Object System.Windows.Forms.Label
$logLabel.Text = 'Server logs'
$logLabel.AutoSize = $true
$logLabel.Location = New-Object System.Drawing.Point(21, 175)
$form.Controls.Add($logLabel)
$logBox = New-Object System.Windows.Forms.RichTextBox
$logBox.Location = New-Object System.Drawing.Point(20, 202)
$logBox.Size = New-Object System.Drawing.Size(724, 285)
$logBox.Anchor = 'Top,Bottom,Left,Right'
$logBox.BackColor = [System.Drawing.Color]::FromArgb(9, 11, 16)
$logBox.ForeColor = [System.Drawing.Color]::FromArgb(204, 215, 231)
$logBox.Font = New-Object System.Drawing.Font('Consolas', 9)
$logBox.BorderStyle = 'FixedSingle'
$logBox.ReadOnly = $true
$logBox.WordWrap = $false
$form.Controls.Add($logBox)

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $form.Icon
$tray.Text = 'Sonora Server'
$tray.Visible = $true
$trayMenu = New-Object System.Windows.Forms.ContextMenuStrip
$showItem = $trayMenu.Items.Add('Open Sonora Server')
$trayMenu.Items.Add('-') | Out-Null
$exitItem = $trayMenu.Items.Add('Exit and stop server')
$tray.ContextMenuStrip = $trayMenu

function Add-Log([string]$message) {
    $logBox.AppendText("[$((Get-Date).ToString('HH:mm:ss'))] $message`r`n")
    $logBox.SelectionStart = $logBox.TextLength
    $logBox.ScrollToCaret()
}
function Test-ServerPort {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $result = $client.BeginConnect('127.0.0.1', 3000, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne(150)) { return $false }
        $client.EndConnect($result)
        return $true
    } catch { return $false } finally { $client.Close() }
}
function Start-Sonora {
    if ($script:serverProcess -and -not $script:serverProcess.HasExited) { return }
    if (Test-ServerPort) { Add-Log 'Port 3000 is already in use. Stop the existing server before starting Sonora here.'; $status.Text = 'Port 3000 is already in use'; return }
    $node = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $node) { Add-Log 'Node.js was not found. Install Node.js or add it to PATH.'; $status.Text = 'Node.js not found'; return }
    if (-not (Test-Path (Join-Path $root 'dist\server.cjs'))) { Add-Log 'The production build is missing. Run npm run build in the Sonora folder.'; $status.Text = 'Build missing'; return }
    try {
        $info = New-Object System.Diagnostics.ProcessStartInfo
        $info.FileName = $node.Source
        $info.Arguments = '"' + $runner + '"'
        $info.WorkingDirectory = $root
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $script:serverProcess = [System.Diagnostics.Process]::Start($info)
        $script:startupTime = Get-Date
        $status.Text = 'Starting server...'
        Add-Log 'Starting Sonora server...'
    } catch { $script:serverProcess = $null; $status.Text = 'Could not start'; Add-Log $_.Exception.Message }
}
function Stop-Sonora {
    if ($script:serverProcess) {
        try {
            if (-not $script:serverProcess.HasExited) {
                & "$env:SystemRoot\System32\taskkill.exe" /PID $script:serverProcess.Id /T /F 2>&1 | Out-Null
                $script:serverProcess.WaitForExit(5000) | Out-Null
            }
        } catch { Add-Log "Could not stop server: $($_.Exception.Message)"; return $false }
        if (-not $script:serverProcess.HasExited) { Add-Log 'Server did not stop.'; return $false }
        $script:serverProcess.Dispose()
        $script:serverProcess = $null
    }
    $status.Text = 'Stopped'
    $memory.Text = 'Server RAM: --'
    return $true
}
function Show-Control { $form.Show(); $form.WindowState = 'Normal'; $form.Activate() }
$startButton.Add_Click({ Start-Sonora })
$stopButton.Add_Click({ if (Stop-Sonora) { Add-Log 'Server stopped.' } })
$resetButton.Add_Click({
    if (-not (Stop-Sonora)) { return }
    try {
        [System.IO.File]::WriteAllText($logFile, '')
        $script:logPosition = 0
        $logBox.Clear()
        Start-Sonora
    } catch { Add-Log "Reset failed: $($_.Exception.Message)" }
})
$openButton.Add_Click({ Start-Process 'https://enzo-pc.tail1214fa.ts.net:8443/' })
$minimized.Add_CheckedChanged({
    try { @{ startMinimized = $minimized.Checked } | ConvertTo-Json | Set-Content -LiteralPath $settingsFile -Encoding UTF8 }
    catch { Add-Log "Could not save preference: $($_.Exception.Message)" }
})
$showItem.Add_Click({ Show-Control })
$tray.Add_DoubleClick({ Show-Control })
$exitItem.Add_Click({ $script:quitting = $true; $form.Close() })
$form.Add_FormClosing({ param($sender, $event) if (-not $script:quitting) { $event.Cancel = $true; $form.Hide() } })
$form.Add_Resize({ if ($form.WindowState -eq 'Minimized') { $form.Hide() } })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 700
$timer.Add_Tick({
    if ($script:serverProcess) {
        if ($script:serverProcess.HasExited) { $status.Text = 'Server stopped unexpectedly'; $memory.Text = 'Server RAM: --'; $script:serverProcess.Dispose(); $script:serverProcess = $null }
        elseif (Test-ServerPort) { $status.Text = 'Running  |  Port 3000' }
        elseif (((Get-Date) - $script:startupTime).TotalSeconds -gt 15) { $status.Text = 'Server is not responding' }
        if ($script:serverProcess -and ((Get-Date) - $script:lastMemoryUpdate).TotalSeconds -ge 3) {
            $script:lastMemoryUpdate = Get-Date
            try {
                # The runner owns the actual Node server as its direct child.
                # Do not include the tray app, runner, or the separate browser.
                $child = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($script:serverProcess.Id) AND Name = 'node.exe'" | Select-Object -First 1
                if ($child) {
                    $nodeProcess = Get-Process -Id $child.ProcessId -ErrorAction Stop
                    $memory.Text = 'Server RAM: {0:N0} MB' -f ($nodeProcess.WorkingSet64 / 1MB)
                } else { $memory.Text = 'Server RAM: --' }
            } catch { $memory.Text = 'Server RAM: --' }
        }
    }
    if (Test-Path $logFile) {
        try {
            $file = New-Object System.IO.FileStream($logFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            try {
                if ($file.Length -lt $script:logPosition) { $script:logPosition = 0 }
                $file.Seek($script:logPosition, [System.IO.SeekOrigin]::Begin) | Out-Null
                $reader = New-Object System.IO.StreamReader($file, [System.Text.Encoding]::UTF8)
                $chunk = $reader.ReadToEnd()
                $script:logPosition = $file.Position
                if ($chunk) {
                    $logBox.AppendText($chunk)
                    if ($logBox.TextLength -gt 500000) { $logBox.Select(0, $logBox.TextLength - 300000); $logBox.SelectedText = '' }
                    $logBox.SelectionStart = $logBox.TextLength; $logBox.ScrollToCaret()
                }
            } finally { $file.Dispose() }
        } catch {}
    }
})
$hideOnLaunch = $startMinimized -or $StartHidden
$form.Add_Shown({
    if ($hideOnLaunch) { $form.Hide() }
    else { $form.WindowState = 'Normal'; $form.Show(); $form.Activate() }
    Start-Sonora
    $timer.Start()
})
try { [System.Windows.Forms.Application]::Run($form) }
finally { $timer.Stop(); $null = Stop-Sonora; $tray.Visible = $false; $tray.Dispose(); $mutex.ReleaseMutex(); $mutex.Dispose() }
