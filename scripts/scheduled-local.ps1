<#
  Runs a local-only job from a Windows scheduled task on Matt's PC:

    news    scripts/news/run-local.ts --loop   every 6h at 1:10 / 7:10 / 13:10 / 19:10,
            clear of the prod news crons (:40/:55 UTC)
    events  scripts/run-local-events.ts        nightly at 23:30 (only the local-only scrapers:
            MountainX, NC Stage, Parks & Rec, Facebook; Vercel does the rest + AI)

    pwsh scripts/scheduled-local.ps1 -Job news              # one run (what the task calls)
    pwsh scripts/scheduled-local.ps1 -Job news -Install     # register / update its task
    pwsh scripts/scheduled-local.ps1 -Job news -Uninstall   # remove it

  Each run logs to logs/<job>-local/<start>.log (last 60 kept) and the jobs record
  themselves in cron_job_runs, so `npm run cron:health` shows failures.

  Tasks run only while you are logged on (locked is fine; no admin needed). They
  launch through `conhost --headless` so no console window appears, which also
  means Task Scheduler's "Last Run Result" is always 0 - the real exit code is the
  last line of the log. The events job's Facebook scraper still opens a visible
  browser window. Both run whatever branch this checkout is on.
#>
param(
  [Parameter(Mandatory)][ValidateSet('news', 'events')][string]$Job,
  [switch]$Install,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..").Path
$config = @{
  news   = @{ Task = 'AVL GO local news'; Script = 'scripts\news\run-local.ts --loop'; Limit = 1 }
  events = @{ Task = 'AVL GO local events'; Script = 'scripts\run-local-events.ts'; Limit = 1 }
}[$Job]

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $config.Task -Confirm:$false
  "Removed '$($config.Task)'."
  return
}

if ($Install) {
  $pwsh = (Get-Command pwsh).Source
  $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" `
    -Argument "--headless `"$pwsh`" -NoProfile -File `"$PSCommandPath`" -Job $Job" `
    -WorkingDirectory $repo

  if ($Job -eq 'news') {
    # Next 1:10 / 7:10 / 13:10 / 19:10 slot, repeating every 6h indefinitely.
    $start = (Get-Date).Date.AddHours(1).AddMinutes(10)
    while ($start -lt (Get-Date)) { $start = $start.AddHours(6) }
    $trigger = New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval (New-TimeSpan -Hours 6)
  } else {
    $trigger = New-ScheduledTaskTrigger -Daily -At '23:30'
  }

  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours $config.Limit)

  Register-ScheduledTask -TaskName $config.Task -Action $action -Trigger $trigger -Settings $settings `
    -Description "AVL GO local $Job job. $PSCommandPath -Job $Job" -Force | Out-Null
  "Registered '$($config.Task)': next run $((Get-ScheduledTaskInfo -TaskName $config.Task).NextRunTime)."
  return
}

Set-Location $repo
$logDir = "logs\$Job-local"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ('{0:yyyy-MM-dd_HHmm}.log' -f (Get-Date))

Add-Content $log "[scheduled-local] $Job started $(Get-Date -Format o)"
cmd /c "node_modules\.bin\tsx.cmd $($config.Script) >> $log 2>&1"
$code = $LASTEXITCODE
Add-Content $log "[scheduled-local] $Job finished $(Get-Date -Format o), exit $code"

Get-ChildItem $logDir -Filter *.log | Sort-Object Name -Descending | Select-Object -Skip 60 | Remove-Item
exit $code
