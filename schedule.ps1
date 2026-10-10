# Registers (or re-registers) a daily jobscout run at 08:00 for the current user.
# Run once:  powershell -ExecutionPolicy Bypass -File schedule.ps1
# Remove:    Unregister-ScheduledTask -TaskName jobscout -Confirm:$false
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cmd  = Join-Path $here 'run-daily.cmd'
$action    = New-ScheduledTaskAction -Execute $cmd
$trigger   = New-ScheduledTaskTrigger -Daily -At 08:00
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName 'jobscout' -Action $action -Trigger $trigger -Settings $settings -Description 'Daily remote-job scan; writes out/report.html' -Force | Out-Null
Write-Host "Registered 'jobscout' to run daily at 08:00."
Write-Host "Report: $(Join-Path $here 'out\report.html')"
