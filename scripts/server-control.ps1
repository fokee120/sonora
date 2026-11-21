param([switch]$StartHidden, [switch]$ShowUsers)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http
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
$script:lastStatusUpdate = [datetime]::MinValue
$startMinimized = $false
try { if (Test-Path $settingsFile) { $startMinimized = [bool](Get-Content -Raw -LiteralPath $settingsFile | ConvertFrom-Json).startMinimized } } catch {}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Sonora Server'
$form.Size = New-Object System.Drawing.Size(1040, 700)
$form.MinimumSize = New-Object System.Drawing.Size(800, 560)
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
$memory.Location = New-Object System.Drawing.Point(825, 56)
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
$tabs = New-Object System.Windows.Forms.TabControl
$tabs.Location = New-Object System.Drawing.Point(20, 175)
$tabs.Size = New-Object System.Drawing.Size(984, 460)
$tabs.Anchor = 'Top,Bottom,Left,Right'
$logsTab = New-Object System.Windows.Forms.TabPage
$logsTab.Text = 'Logs'
$usersTab = New-Object System.Windows.Forms.TabPage
$usersTab.Text = 'Users'
$usersTab.BackColor = $form.BackColor
$tabs.TabPages.Add($logsTab)
$tabs.TabPages.Add($usersTab)
$logBox.Dock = 'Fill'
$logsTab.Controls.Add($logBox)
$form.Controls.Add($tabs)
$userSummary = New-Object System.Windows.Forms.Label
$userSummary.Text = 'Live users and recent visitors'
$userSummary.Location = New-Object System.Drawing.Point(10, 10)
$userSummary.AutoSize = $true
$usersTab.Controls.Add($userSummary)
$userList = New-Object System.Windows.Forms.ListView
$userList.Location = New-Object System.Drawing.Point(10, 36)
$userList.Size = New-Object System.Drawing.Size(950, 285)
$userList.Anchor = 'Top,Bottom,Left,Right'
$userList.View = 'Details'
$userList.FullRowSelect = $true
$userList.MultiSelect = $false
$userList.HideSelection = $false
$userList.BackColor = $logBox.BackColor
$userList.ForeColor = $logBox.ForeColor
foreach ($column in @(@('User',130),@('IP address',145),@('Device',80),@('Browser',110),@('Status',65),@('Activity',100),@('Last activity',140),@('Access',115))) { [void]$userList.Columns.Add($column[0], [int]$column[1]) }
$usersTab.Controls.Add($userList)
$userActions = New-Object System.Windows.Forms.FlowLayoutPanel
$userActions.Location = New-Object System.Drawing.Point(10, 328)
$userActions.Size = New-Object System.Drawing.Size(950, 42)
$userActions.Anchor = 'Bottom,Left,Right'
$usersTab.Controls.Add($userActions)
$banUser = New-Object System.Windows.Forms.Button
$banUser.Text = 'Ban user'
$banUser.Size = New-Object System.Drawing.Size(120, 32)
$allowUser = New-Object System.Windows.Forms.Button
$allowUser.Text = 'Allow user'
$allowUser.Size = New-Object System.Drawing.Size(120, 32)
$refreshUsers = New-Object System.Windows.Forms.Button
$refreshUsers.Text = 'Refresh'
$refreshUsers.Size = New-Object System.Drawing.Size(100, 32)
$banIP = New-Object System.Windows.Forms.Button
$banIP.Text = 'Block IP'
$banIP.Size = New-Object System.Drawing.Size(110, 32)
$allowIP = New-Object System.Windows.Forms.Button
$allowIP.Text = 'Allow IP'
$allowIP.Size = New-Object System.Drawing.Size(110, 32)
$userResult = New-Object System.Windows.Forms.Label
$userResult.Text = 'Select a visitor. IP blocks affect everyone sharing that address.'
$userResult.Location = New-Object System.Drawing.Point(10, 420)
$userResult.Size = New-Object System.Drawing.Size(950, 28)
$userResult.Anchor = 'Bottom,Left,Right'
$usersTab.Controls.Add($userResult)
$blockedIPs = New-Object System.Windows.Forms.ComboBox
$blockedIPs.DropDownStyle = 'DropDownList'
$blockedIPs.Location = New-Object System.Drawing.Point(10, 375)
$blockedIPs.Size = New-Object System.Drawing.Size(300, 28)
$blockedIPs.Anchor = 'Bottom,Left'
$usersTab.Controls.Add($blockedIPs)
$unblockSavedIP = New-Object System.Windows.Forms.Button
$unblockSavedIP.Text = 'Unblock saved IP'
$unblockSavedIP.Location = New-Object System.Drawing.Point(320, 372)
$unblockSavedIP.Size = New-Object System.Drawing.Size(150, 32)
$unblockSavedIP.Anchor = 'Bottom,Left'
$usersTab.Controls.Add($unblockSavedIP)
$unblockSavedIP.Add_Click({
    if ($script:userAction) { return }
    if (-not $blockedIPs.SelectedItem) { $userResult.Text = 'Choose a saved blocked IP first.'; return }
    if (-not (Set-AdminHeader)) { $userResult.Text = 'Admin connection unavailable.'; return }
    $body = @{ip=[string]$blockedIPs.SelectedItem;blocked=$false} | ConvertTo-Json -Compress
    $content = New-Object System.Net.Http.StringContent($body, [System.Text.Encoding]::UTF8, 'application/json')
    $script:userAction = $script:userHttp.PostAsync('http://127.0.0.1:3002/ip-access', $content)
    $userResult.Text = 'Removing IP block...'
})
$script:selectedVisitorId = ''
$userList.ShowItemToolTips = $true
$userList.Add_SelectedIndexChanged({ if ($userList.SelectedItems.Count -eq 1) { $script:selectedVisitorId = [string]$userList.SelectedItems[0].Tag; $userResult.Text = 'Selected: ' + $userList.SelectedItems[0].Text } })
foreach ($button in @($banUser,$allowUser,$banIP,$allowIP,$refreshUsers)) { $button.FlatStyle = 'Flat'; $button.BackColor = $buttons.BackColor; $button.ForeColor = $form.ForeColor; $userActions.Controls.Add($button) }
$script:userHttp = New-Object System.Net.Http.HttpClient
$script:userHttp.Timeout = [TimeSpan]::FromSeconds(2)
$script:userRequest = $null
$script:userAction = $null
$script:lastUsersRefresh = [datetime]::MinValue
function Set-AdminHeader {
    $tokenFile = Join-Path $root '.sonora\admin-token'
    if (-not (Test-Path -LiteralPath $tokenFile)) { return $false }
    $script:userHttp.DefaultRequestHeaders.Remove('X-Sonora-Admin') | Out-Null
    $script:userHttp.DefaultRequestHeaders.Add('X-Sonora-Admin', [System.IO.File]::ReadAllText($tokenFile).Trim())
    return $true
}
function Refresh-Users {
    if ($script:userRequest -or -not (Set-AdminHeader)) { return }
    $script:lastUsersRefresh = Get-Date
    $script:userRequest = $script:userHttp.GetAsync('http://127.0.0.1:3002/users')
}
function Set-SelectedAccess([bool]$blocked, [string]$scope = 'visitor') {
    if ($script:userAction) { return }; if (-not $script:selectedVisitorId) { $userResult.Text = 'Select a visitor first.'; return }; if (-not (Set-AdminHeader)) { $userResult.Text = 'Admin connection unavailable.'; return }
    $body = @{id=$script:selectedVisitorId;blocked=$blocked;scope=$scope} | ConvertTo-Json -Compress
    $content = New-Object System.Net.Http.StringContent($body, [System.Text.Encoding]::UTF8, 'application/json')
    $script:userAction = $script:userHttp.PostAsync('http://127.0.0.1:3002/access', $content)
    $banUser.Enabled = $false; $allowUser.Enabled = $false; $banIP.Enabled = $false; $allowIP.Enabled = $false; $userResult.Text = 'Applying access change...'
}
$banUser.Add_Click({ Set-SelectedAccess $true })
$allowUser.Add_Click({ Set-SelectedAccess $false })
$banIP.Add_Click({ Set-SelectedAccess $true 'ip' })
$allowIP.Add_Click({ Set-SelectedAccess $false 'ip' })
$refreshUsers.Add_Click({ Refresh-Users })
$tabs.Add_SelectedIndexChanged({ if ($tabs.SelectedTab -eq $usersTab) { Refresh-Users } })

# Dock the user controls in rows: bottom anchors were calculated before the
# tab had its final size, placing the action controls outside the visible tab.
$usersTab.SuspendLayout()
$userLayout = New-Object System.Windows.Forms.TableLayoutPanel
$userLayout.Dock = 'Fill'
$userLayout.ColumnCount = 1
$userLayout.RowCount = 5
$userLayout.Padding = New-Object System.Windows.Forms.Padding(10)
[void]$userLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))
foreach ($kind in @('AutoSize','AutoSize','Percent','AutoSize','AutoSize')) {
    $style = New-Object System.Windows.Forms.RowStyle
    $style.SizeType = [System.Windows.Forms.SizeType]::$kind
    if ($kind -eq 'Percent') { $style.Height = 100 }
    [void]$userLayout.RowStyles.Add($style)
}
$userSummary.Dock = 'Fill'
$userSummary.Padding = New-Object System.Windows.Forms.Padding(0, 0, 0, 8)
$userActions.Dock = 'Fill'
$userActions.AutoSize = $true
$userActions.AutoSizeMode = 'GrowAndShrink'
$userActions.WrapContents = $true
$userActions.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, 8)
$banUser.BackColor = [System.Drawing.Color]::FromArgb(132, 45, 55)
$banIP.BackColor = [System.Drawing.Color]::FromArgb(132, 45, 55)
$userList.Dock = 'Fill'
$userList.MinimumSize = New-Object System.Drawing.Size(0, 80)
$ipActions = New-Object System.Windows.Forms.FlowLayoutPanel
$ipActions.Dock = 'Fill'
$ipActions.AutoSize = $true
$ipActions.AutoSizeMode = 'GrowAndShrink'
$ipActions.WrapContents = $true
$ipLabel = New-Object System.Windows.Forms.Label
$ipLabel.Text = 'Saved IP blocks:'
$ipLabel.AutoSize = $true
$ipLabel.Margin = New-Object System.Windows.Forms.Padding(0, 8, 8, 0)
$blockedIPs.Anchor = 'Top,Left'
$unblockSavedIP.Anchor = 'Top,Left'
$ipActions.Controls.Add($ipLabel)
$ipActions.Controls.Add($blockedIPs)
$ipActions.Controls.Add($unblockSavedIP)
$userResult.Dock = 'Fill'
$userResult.AutoSize = $true
$userResult.MaximumSize = New-Object System.Drawing.Size(930, 0)
$userResult.Padding = New-Object System.Windows.Forms.Padding(0, 6, 0, 0)
$userLayout.Controls.Add($userSummary, 0, 0)
$userLayout.Controls.Add($userActions, 0, 1)
$userLayout.Controls.Add($userList, 0, 2)
$userLayout.Controls.Add($ipActions, 0, 3)
$userLayout.Controls.Add($userResult, 0, 4)
$usersTab.Controls.Add($userLayout)
$usersTab.ResumeLayout($true)
$userMenu = New-Object System.Windows.Forms.ContextMenuStrip
$menuBan = $userMenu.Items.Add('Ban user')
$menuAllow = $userMenu.Items.Add('Allow user')
[void]$userMenu.Items.Add('-')
$menuBanIP = $userMenu.Items.Add('Block IP address')
$menuAllowIP = $userMenu.Items.Add('Allow IP address')
$menuBan.Add_Click({ Set-SelectedAccess $true })
$menuAllow.Add_Click({ Set-SelectedAccess $false })
$menuBanIP.Add_Click({ Set-SelectedAccess $true 'ip' })
$menuAllowIP.Add_Click({ Set-SelectedAccess $false 'ip' })
$userList.Add_MouseClick({ param($sender, $event)
    if ($event.Button -eq [System.Windows.Forms.MouseButtons]::Right) {
        $row = $userList.GetItemAt($event.X, $event.Y)
        if ($row) { $row.Selected = $true; $script:selectedVisitorId = [string]$row.Tag; $userMenu.Show($userList, $event.Location) }
    }
})
$userList.Add_MouseDoubleClick({ param($sender, $event)
    $row = $userList.GetItemAt($event.X, $event.Y)
    if ($row) { $row.Selected = $true; $script:selectedVisitorId = [string]$row.Tag; $userMenu.Show($userList, $event.Location) }
})

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
        $info.EnvironmentVariables['DOTENV_CONFIG_QUIET'] = 'true'

        # Start the tray view at the end of the existing log. Capture the byte
        # offset before spawning Node so early startup output is included.
        $previousLog = Get-Item -LiteralPath $logFile -ErrorAction SilentlyContinue
        $startupOffset = if ($previousLog) { $previousLog.Length } else { 0L }
        $script:serverProcess = [System.Diagnostics.Process]::Start($info)
        $script:logPosition = $startupOffset
        $logBox.Clear()
        $script:startupTime = Get-Date
        $script:lastStatusUpdate = [datetime]::MinValue
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
$timer.Interval = 1000
$timer.Add_Tick({
    if ($script:userAction -and $script:userAction.IsCompleted) {
        try { $response = $script:userAction.GetAwaiter().GetResult(); $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult(); if (-not $response.IsSuccessStatusCode) { throw ('Access update failed (HTTP ' + [int]$response.StatusCode + '): ' + $body) }; $result = $body | ConvertFrom-Json; $userResult.Text = 'Access updated.' + $(if ($result.ipBlocked) { ' IP is blocked; use Allow IP to remove that block.' } else { '' }); $response.Dispose(); $script:lastUsersRefresh = [datetime]::MinValue }
        catch { $userResult.Text = $_.Exception.Message; Add-Log ('Access update: ' + $_.Exception.Message) }
        $script:userAction = $null; $banUser.Enabled = $true; $allowUser.Enabled = $true; $banIP.Enabled = $true; $allowIP.Enabled = $true
    }
    if ($script:userRequest -and $script:userRequest.IsCompleted) {
        try {
            $response = $script:userRequest.GetAwaiter().GetResult()
            if (-not $response.IsSuccessStatusCode) { throw 'Users unavailable' }
            $json = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
            $savedIP = [string]$blockedIPs.SelectedItem
            $blockedIPs.BeginUpdate(); $blockedIPs.Items.Clear()
            foreach ($ip in $json.blockedIPs) { [void]$blockedIPs.Items.Add([string]$ip) }
            if ($savedIP -and $blockedIPs.Items.Contains($savedIP)) { $blockedIPs.SelectedItem = $savedIP }
            elseif ($blockedIPs.Items.Count) { $blockedIPs.SelectedIndex = 0 }
            $blockedIPs.EndUpdate()
            $userList.BeginUpdate()
            $seen = @{}
            foreach ($user in $json.users) {
                $seen[[string]$user.id] = $true
                $row = $userList.Items | Where-Object { $_.Tag -eq $user.id } | Select-Object -First 1
                $values = @([string]$user.name, $(if ($user.ip) { [string]$user.ip } else { 'Next visit' }), [string]$user.device, [string]$user.browser, $(if ($user.online) { 'Online' } else { 'Away' }), [string]$user.activity, [DateTimeOffset]::FromUnixTimeMilliseconds([long]$user.lastSeen).ToLocalTime().ToString('dd/MM HH:mm:ss'), $(if ($user.ipBlocked -and $user.userBlocked) { 'User + IP banned' } elseif ($user.ipBlocked) { 'IP blocked' } elseif ($user.blocked) { 'User banned' } else { 'Allowed' }))
                if (-not $row) {
                    $row = New-Object System.Windows.Forms.ListViewItem($values[0])
                    $row.Tag = [string]$user.id
                    for ($i = 1; $i -lt $values.Count; $i++) { [void]$row.SubItems.Add($values[$i]) }
                    [void]$userList.Items.Add($row)
                } else { for ($i = 0; $i -lt $values.Count; $i++) { $row.SubItems[$i].Text = $values[$i] } }
                $row.ToolTipText = 'IP: ' + $user.ip + "`nFirst seen: " + [DateTimeOffset]::FromUnixTimeMilliseconds([long]$user.firstSeen).ToLocalTime().ToString('dd/MM/yyyy HH:mm:ss') + "`nConnection: " + $user.connection + "`n" + $user.userAgent
                $row.ForeColor = if ($user.blocked) { [System.Drawing.Color]::Salmon } elseif ($user.online) { [System.Drawing.Color]::LightGreen } else { $logBox.ForeColor }
            }
            foreach ($row in @($userList.Items)) { if (-not $seen.ContainsKey([string]$row.Tag)) { $userList.Items.Remove($row); if ($script:selectedVisitorId -eq $row.Tag) { $script:selectedVisitorId = '' } } }
            $userList.EndUpdate(); $response.Dispose()
            $online = @($json.users | Where-Object { $_.online }).Count
            $userSummary.Text = "$online online - $(@($json.users).Count) visitors (last seen within 75 seconds = online)"
        } catch { $userList.EndUpdate(); $userSummary.Text = 'Users unavailable - start the server or retry.' }
        $script:userRequest = $null
    }
    if ($tabs.SelectedTab -eq $usersTab -and ((Get-Date) - $script:lastUsersRefresh).TotalSeconds -ge 3) { Refresh-Users }

    $now = Get-Date
    if ($script:serverProcess -and ($now - $script:lastStatusUpdate).TotalSeconds -ge 3) {
        $script:lastStatusUpdate = $now
        $script:serverProcess.Refresh()
        if ($script:serverProcess.HasExited) {
            $status.Text = 'Server stopped unexpectedly'
            $memory.Text = 'Server RAM: --'
            $script:serverProcess.Dispose()
            $script:serverProcess = $null
        } else {
            if (Test-ServerPort) { $status.Text = 'Running  |  Port 3000' }
            elseif (($now - $script:startupTime).TotalSeconds -gt 15) { $status.Text = 'Server is not responding' }
            try { $memory.Text = 'Server RAM: {0:N0} MB' -f ($script:serverProcess.WorkingSet64 / 1MB) }
            catch { $memory.Text = 'Server RAM: --' }
        }
    }
    if (Test-Path $logFile) {
        try {
            $file = New-Object System.IO.FileStream($logFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            try {
                if ($file.Length -lt $script:logPosition) { $script:logPosition = 0 }
                $start = [math]::Max($script:logPosition, $file.Length - 256KB)
                $file.Seek($start, [System.IO.SeekOrigin]::Begin) | Out-Null
                $reader = New-Object System.IO.StreamReader($file, [System.Text.Encoding]::UTF8)
                if ($start -gt $script:logPosition) { $null = $reader.ReadLine() }
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
$form.Add_VisibleChanged({
    if ($form.Visible) {
        $script:lastStatusUpdate = [datetime]::MinValue
        $timer.Start()
    } else {
        $timer.Stop()
    }
})
$hideOnLaunch = ($startMinimized -or $StartHidden) -and -not $ShowUsers
$form.Add_Shown({
    if ($hideOnLaunch) { $form.Hide() }
    else { $form.WindowState = 'Normal'; $form.Show(); $form.Activate() }
    Start-Sonora
    if ($ShowUsers) { $tabs.SelectedTab = $usersTab }
})
try { [System.Windows.Forms.Application]::Run($form) }
finally { $script:userHttp.Dispose(); $timer.Stop(); $null = Stop-Sonora; $tray.Visible = $false; $tray.Dispose(); $mutex.ReleaseMutex(); $mutex.Dispose() }
