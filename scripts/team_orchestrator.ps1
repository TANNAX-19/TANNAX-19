param(
    [ValidateSet("init", "reset", "pm-cycle", "status")]
    [string]$Action = "status",
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [int]$MaxWipPerRole = 1
)

$BusDir = Join-Path $WorkspaceRoot "bus"
$ReportsDir = Join-Path $WorkspaceRoot "reports"
$TasksPath = Join-Path $BusDir "tasks.jsonl"
$UpdatesPath = Join-Path $BusDir "updates.jsonl"
$DecisionsPath = Join-Path $BusDir "decisions.jsonl"
$DispatchesPath = Join-Path $BusDir "dispatches.jsonl"

function Ensure-Dir {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

function Ensure-File {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType File -Path $Path | Out-Null
    }
}

function Ensure-Layout {
    Ensure-Dir -Path $BusDir
    Ensure-Dir -Path $ReportsDir
    Ensure-File -Path $TasksPath
    Ensure-File -Path $UpdatesPath
    Ensure-File -Path $DecisionsPath
    Ensure-File -Path $DispatchesPath
}

function Read-JsonLines {
    param([string]$Path)
    $rows = @()
    if (-not (Test-Path -LiteralPath $Path)) { return $rows }
    foreach ($line in (Get-Content -LiteralPath $Path)) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
        try {
            $rows += ($trimmed | ConvertFrom-Json)
        } catch {
            Write-Warning "Skipped invalid JSON line in $Path"
        }
    }
    return $rows
}

function Write-JsonLines {
    param([string]$Path, [object[]]$Items)
    if ($null -eq $Items -or $Items.Count -eq 0) {
        Set-Content -LiteralPath $Path -Value $null
        return
    }
    $lines = @()
    foreach ($item in $Items) {
        $lines += ($item | ConvertTo-Json -Depth 20 -Compress)
    }
    Set-Content -LiteralPath $Path -Value $lines
}

function Append-JsonLines {
    param([string]$Path, [object[]]$Items)
    if ($null -eq $Items -or $Items.Count -eq 0) { return }
    $lines = @()
    foreach ($item in $Items) {
        $lines += ($item | ConvertTo-Json -Depth 20 -Compress)
    }
    Add-Content -LiteralPath $Path -Value $lines
}

function Get-LatestUpdateMap {
    param([object[]]$Updates)
    $map = @{}
    foreach ($u in $Updates) {
        $taskId = [string]$u.task_id
        if ([string]::IsNullOrWhiteSpace($taskId)) { continue }
        if (-not $map.ContainsKey($taskId)) {
            $map[$taskId] = $u
            continue
        }
        $current = $map[$taskId]
        $currentTs = [datetime]::MinValue
        $newTs = [datetime]::MinValue
        try { $currentTs = [datetime]$current.timestamp } catch {}
        try { $newTs = [datetime]$u.timestamp } catch {}
        if ($newTs -ge $currentTs) {
            $map[$taskId] = $u
        }
    }
    return $map
}

function New-SequentialId {
    param(
        [string]$Prefix,
        [object[]]$Items,
        [string]$FieldName
    )
    $maxValue = 0
    foreach ($item in $Items) {
        $id = [string]$item.$FieldName
        if ($id -match "^$Prefix-(\d+)$") {
            $number = [int]$matches[1]
            if ($number -gt $maxValue) { $maxValue = $number }
        }
    }
    return ("{0}-{1:d3}" -f $Prefix, ($maxValue + 1))
}

function Get-PriorityScore {
    param([object]$Task)
    $priorityBase = switch ([string]$Task.priority) {
        "P0" { 100 }
        "P1" { 60 }
        "P2" { 30 }
        default { 10 }
    }
    $businessValue = [int]$Task.business_value
    $urgency = [int]$Task.urgency
    $risk = [int]$Task.risk
    $effort = [int]$Task.effort
    return ($priorityBase + ($businessValue * 5) + ($urgency * 3) + ($risk * 2) - $effort)
}

function Test-TaskReady {
    param(
        [object]$Task,
        [hashtable]$TaskById
    )
    $deps = @($Task.depends_on)
    if ($deps.Count -eq 0) { return $true }
    foreach ($depId in $deps) {
        $dep = [string]$depId
        if ([string]::IsNullOrWhiteSpace($dep)) { continue }
        if (-not $TaskById.ContainsKey($dep)) { return $false }
        if ([string]$TaskById[$dep].status -ne "done") { return $false }
    }
    return $true
}

function New-Report {
    param(
        [string]$Path,
        [object[]]$Tasks,
        [object[]]$NewDecisions,
        [object[]]$NewDispatches
    )
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $todo = @($Tasks | Where-Object { $_.status -eq "todo" }).Count
    $doing = @($Tasks | Where-Object { $_.status -eq "doing" }).Count
    $blocked = @($Tasks | Where-Object { $_.status -eq "blocked" }).Count
    $done = @($Tasks | Where-Object { $_.status -eq "done" }).Count

    $content = @()
    $content += "# PM Cycle Report ($ts)"
    $content += ""
    $content += "## Summary"
    $content += "- todo: $todo"
    $content += "- doing: $doing"
    $content += "- blocked: $blocked"
    $content += "- done: $done"
    $content += ""
    $content += "## New Dispatches"
    if ($NewDispatches.Count -eq 0) {
        $content += "- none"
    } else {
        foreach ($d in $NewDispatches) {
            $content += "- $($d.dispatch_id): $($d.owner_role) -> $($d.task_id) ($($d.action))"
        }
    }
    $content += ""
    $content += "## New Decisions"
    if ($NewDecisions.Count -eq 0) {
        $content += "- none"
    } else {
        foreach ($d in $NewDecisions) {
            $content += "- $($d.decision_id): $($d.summary)"
        }
    }
    $content += ""
    $content += "## Blocked Tasks"
    $blockedTasks = @($Tasks | Where-Object { $_.status -eq "blocked" })
    if ($blockedTasks.Count -eq 0) {
        $content += "- none"
    } else {
        foreach ($t in $blockedTasks) {
            $content += "- $($t.task_id) [$($t.owner_role)] $($t.title)"
        }
    }
    Set-Content -LiteralPath $Path -Value $content
}

Ensure-Layout

if ($Action -eq "init") {
    Write-Host "Initialized team workspace in $WorkspaceRoot"
    exit 0
}

if ($Action -eq "reset") {
    Set-Content -LiteralPath $TasksPath -Value $null
    Set-Content -LiteralPath $UpdatesPath -Value $null
    Set-Content -LiteralPath $DecisionsPath -Value $null
    Set-Content -LiteralPath $DispatchesPath -Value $null
    Write-Host "Reset bus files."
    exit 0
}

$tasks = @(Read-JsonLines -Path $TasksPath)
$updates = @(Read-JsonLines -Path $UpdatesPath)
$decisions = @(Read-JsonLines -Path $DecisionsPath)
$dispatches = @(Read-JsonLines -Path $DispatchesPath)

if ($Action -eq "status") {
    if ($tasks.Count -eq 0) {
        Write-Host "No tasks found."
        exit 0
    }
    $tasks | Sort-Object owner_role, task_id | ForEach-Object {
        Write-Host ("{0} [{1}] ({2}) {3}" -f $_.task_id, $_.status, $_.owner_role, $_.title)
    }
    exit 0
}

if ($Action -ne "pm-cycle") {
    Write-Error "Unsupported action: $Action"
    exit 1
}

$taskById = @{}
foreach ($task in $tasks) {
    $taskById[[string]$task.task_id] = $task
}

$latestUpdates = Get-LatestUpdateMap -Updates $updates

foreach ($taskId in $latestUpdates.Keys) {
    if (-not $taskById.ContainsKey($taskId)) { continue }
    $u = $latestUpdates[$taskId]
    $task = $taskById[$taskId]
    if (-not [string]::IsNullOrWhiteSpace([string]$u.status)) {
        $task.status = [string]$u.status
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$u.timestamp)) {
        $task.updated_at = [string]$u.timestamp
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$u.progress)) {
        $task.notes = [string]$u.progress
    }
    if ($null -ne $u.evidence) {
        $task.evidence = @($u.evidence)
    }
}

$newDecisions = @()
$newDispatches = @()
$newTasks = @()
$now = (Get-Date).ToUniversalTime().ToString("o")

foreach ($task in $tasks) {
    if ([string]$task.status -ne "blocked") { continue }
    $taskId = [string]$task.task_id
    if (-not $latestUpdates.ContainsKey($taskId)) { continue }
    $u = $latestUpdates[$taskId]
    $needsDecision = [string]$u.needs_decision
    if ([string]::IsNullOrWhiteSpace($needsDecision)) { continue }
    $alreadyDecided = @($decisions | Where-Object { [string]$_.related_task_id -eq $taskId }).Count -gt 0
    if ($alreadyDecided) { continue }

    $blocker = [string]$u.blocker
    $decisionId = New-SequentialId -Prefix "DEC" -Items ($decisions + $newDecisions) -FieldName "decision_id"
    $summary = "Unblock $taskId by PM standard rule."
    $actionItems = @("Resume original task.")

    if ($blocker -match "credential|credentials|permission|access|environment") {
        $summary = "For $taskId, enable mock-data path and create platform support task."
        $actionItems = @(
            "developer continues implementation with mock data",
            "platform opens credentials within 4 hours"
        )

        $platformTaskId = New-SequentialId -Prefix "PLT" -Items ($tasks + $newTasks) -FieldName "task_id"
        $platformTask = [pscustomobject]@{
            task_id = $platformTaskId
            title = "Open test credentials for $taskId"
            owner_role = "platform"
            priority = "P1"
            business_value = 4
            urgency = 5
            risk = 4
            effort = 2
            due_at = (Get-Date).AddHours(4).ToUniversalTime().ToString("o")
            depends_on = @()
            acceptance_criteria = @(
                "developer can access test environment",
                "credential channel and owner are documented"
            )
            status = "todo"
            created_at = $now
            updated_at = $now
            evidence = @()
            notes = "Auto-created by PM decision for blocker remediation."
        }
        $newTasks += $platformTask
        $taskById[$platformTaskId] = $platformTask

        $task.status = "doing"
        $task.updated_at = $now
        $task.notes = "PM decision applied: continue with mock data."

        $resumeDispatchId = New-SequentialId -Prefix "DSP" -Items ($dispatches + $newDispatches) -FieldName "dispatch_id"
        $newDispatches += [pscustomobject]@{
            dispatch_id = $resumeDispatchId
            task_id = $task.task_id
            owner_role = $task.owner_role
            action = "resume_with_mock"
            reason = "PM decision for env blocker"
            dispatched_at = $now
        }
    } elseif ($blocker -match "contract|interface|API") {
        $summary = "For $taskId, lock to API v1 baseline and create architect alignment task."
        $actionItems = @(
            "developer proceeds with API v1",
            "architect aligns and confirms contract delta"
        )
    }

    $newDecisions += [pscustomobject]@{
        decision_id = $decisionId
        related_task_id = $taskId
        summary = $summary
        rationale = "Rule-based PM decision to reduce waiting time."
        impact = "Execution continues with constrained risk."
        action_items = $actionItems
        created_at = $now
        effective_at = $now
    }
}

if ($newTasks.Count -gt 0) {
    $tasks += $newTasks
}

foreach ($task in $tasks) {
    if ([string]$task.status -eq "todo") {
        $criteria = @($task.acceptance_criteria)
        $noCriteria = $criteria.Count -eq 0
        if (-not $noCriteria -and $criteria.Count -eq 1 -and [string]::IsNullOrWhiteSpace([string]$criteria[0])) {
            $noCriteria = $true
        }
        if ($noCriteria) {
            $task.status = "blocked"
            $task.notes = "Missing acceptance criteria."
        }
    }
}

$doingCount = @{}
foreach ($task in $tasks) {
    if ([string]$task.status -ne "doing") { continue }
    $role = [string]$task.owner_role
    if (-not $doingCount.ContainsKey($role)) { $doingCount[$role] = 0 }
    $doingCount[$role]++
}

$taskById = @{}
foreach ($task in $tasks) {
    $taskById[[string]$task.task_id] = $task
}

$candidates = @(
    $tasks | Where-Object {
        $_.status -eq "todo" -and (Test-TaskReady -Task $_ -TaskById $taskById)
    }
)

$sortedCandidates = @(
    $candidates | Sort-Object @{
        Expression = { Get-PriorityScore -Task $_ }
        Descending = $true
    }, @{
        Expression = { [datetime]$_.due_at }
        Descending = $false
    }
)

foreach ($task in $sortedCandidates) {
    $role = [string]$task.owner_role
    if (-not $doingCount.ContainsKey($role)) { $doingCount[$role] = 0 }
    if ($doingCount[$role] -ge $MaxWipPerRole) { continue }
    $task.status = "doing"
    $task.updated_at = $now
    $doingCount[$role]++

    $dispatchId = New-SequentialId -Prefix "DSP" -Items ($dispatches + $newDispatches) -FieldName "dispatch_id"
    $newDispatches += [pscustomobject]@{
        dispatch_id = $dispatchId
        task_id = $task.task_id
        owner_role = $task.owner_role
        action = "start_task"
        reason = "Priority and dependency check passed."
        dispatched_at = $now
    }
}

Write-JsonLines -Path $TasksPath -Items $tasks
Append-JsonLines -Path $DecisionsPath -Items $newDecisions
Append-JsonLines -Path $DispatchesPath -Items $newDispatches

$reportPath = Join-Path $ReportsDir ("pm_report_{0}.md" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
New-Report -Path $reportPath -Tasks $tasks -NewDecisions $newDecisions -NewDispatches $newDispatches

Write-Host "PM cycle complete."
Write-Host "New decisions: $($newDecisions.Count)"
Write-Host "New dispatches: $($newDispatches.Count)"
Write-Host "Report: $reportPath"

