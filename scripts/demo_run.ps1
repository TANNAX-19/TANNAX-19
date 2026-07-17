param(
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$orchestrator = Join-Path $PSScriptRoot "team_orchestrator.ps1"
$busDir = Join-Path $WorkspaceRoot "bus"
$tasksPath = Join-Path $busDir "tasks.jsonl"
$updatesPath = Join-Path $busDir "updates.jsonl"
$decisionsPath = Join-Path $busDir "decisions.jsonl"
$dispatchesPath = Join-Path $busDir "dispatches.jsonl"

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

function Append-Update {
    param(
        [string]$TaskId,
        [string]$OwnerRole,
        [string]$Status,
        [string]$Progress,
        [string]$NextStep,
        [datetime]$Time,
        [string]$Blocker = "",
        [string]$NeedsDecision = "",
        [string]$ResponseDueAt = "",
        [object[]]$Evidence = @()
    )

    $update = [pscustomobject]@{
        update_id = ("UPD-{0:yyyyMMddHHmmssfff}" -f $Time)
        task_id = $TaskId
        owner_role = $OwnerRole
        status = $Status
        progress = $Progress
        blocker = $Blocker
        needs_decision = $NeedsDecision
        response_due_at = $ResponseDueAt
        evidence = $Evidence
        next_step = $NextStep
        timestamp = $Time.ToUniversalTime().ToString("o")
    }
    Add-Content -LiteralPath $updatesPath -Value ($update | ConvertTo-Json -Depth 20 -Compress)
}

Write-Host "=== Demo: Multi-session AI team orchestration ==="

& $orchestrator -Action init -WorkspaceRoot $WorkspaceRoot | Out-Null
& $orchestrator -Action reset -WorkspaceRoot $WorkspaceRoot | Out-Null

$now = Get-Date
$tasks = @(
    [pscustomobject]@{
        task_id = "PO-001"
        title = "Define MVP scope and acceptance"
        owner_role = "product_owner"
        priority = "P0"
        business_value = 5
        urgency = 5
        risk = 3
        effort = 2
        due_at = $now.AddDays(1).ToUniversalTime().ToString("o")
        depends_on = @()
        acceptance_criteria = @(
            "MVP scope is explicit and testable",
            "Acceptance criteria are measurable"
        )
        status = "todo"
        created_at = $now.ToUniversalTime().ToString("o")
        updated_at = $now.ToUniversalTime().ToString("o")
        evidence = @()
        notes = ""
    }
    [pscustomobject]@{
        task_id = "ARC-001"
        title = "Publish architecture and API baseline"
        owner_role = "architect"
        priority = "P1"
        business_value = 5
        urgency = 4
        risk = 4
        effort = 3
        due_at = $now.AddDays(2).ToUniversalTime().ToString("o")
        depends_on = @("PO-001")
        acceptance_criteria = @(
            "Architecture document published",
            "API baseline v1 is frozen"
        )
        status = "todo"
        created_at = $now.ToUniversalTime().ToString("o")
        updated_at = $now.ToUniversalTime().ToString("o")
        evidence = @()
        notes = ""
    }
    [pscustomobject]@{
        task_id = "DEV-001"
        title = "Implement core feature and endpoint"
        owner_role = "developer"
        priority = "P1"
        business_value = 5
        urgency = 4
        risk = 4
        effort = 4
        due_at = $now.AddDays(3).ToUniversalTime().ToString("o")
        depends_on = @("ARC-001")
        acceptance_criteria = @(
            "Feature branch builds successfully",
            "Endpoint returns expected payload"
        )
        status = "todo"
        created_at = $now.ToUniversalTime().ToString("o")
        updated_at = $now.ToUniversalTime().ToString("o")
        evidence = @()
        notes = ""
    }
    [pscustomobject]@{
        task_id = "QA-001"
        title = "Run validation and regression tests"
        owner_role = "qa"
        priority = "P1"
        business_value = 5
        urgency = 4
        risk = 5
        effort = 3
        due_at = $now.AddDays(4).ToUniversalTime().ToString("o")
        depends_on = @("DEV-001")
        acceptance_criteria = @(
            "All acceptance tests pass",
            "No P1 regression defects"
        )
        status = "todo"
        created_at = $now.ToUniversalTime().ToString("o")
        updated_at = $now.ToUniversalTime().ToString("o")
        evidence = @()
        notes = ""
    }
)

Write-JsonLines -Path $tasksPath -Items $tasks
Set-Content -LiteralPath $updatesPath -Value $null
Set-Content -LiteralPath $decisionsPath -Value $null
Set-Content -LiteralPath $dispatchesPath -Value $null

Write-Host "`n[Cycle 1] PM dispatches first ready tasks"
& $orchestrator -Action pm-cycle -WorkspaceRoot $WorkspaceRoot

Append-Update -TaskId "PO-001" -OwnerRole "product_owner" -Status "done" `
    -Progress "MVP scope and acceptance criteria are finalized." `
    -NextStep "Architecture can proceed." `
    -Evidence @("doc://requirements/mvp-v1") `
    -Time $now.AddMinutes(1)

Write-Host "`n[Cycle 2] PM consumes PO update and dispatches architect"
& $orchestrator -Action pm-cycle -WorkspaceRoot $WorkspaceRoot

Append-Update -TaskId "ARC-001" -OwnerRole "architect" -Status "done" `
    -Progress "Architecture and API v1 baseline published." `
    -NextStep "Developer can start implementation." `
    -Evidence @("doc://architecture/v1", "doc://api/v1") `
    -Time $now.AddMinutes(2)

Write-Host "`n[Cycle 3] PM dispatches developer"
& $orchestrator -Action pm-cycle -WorkspaceRoot $WorkspaceRoot

Append-Update -TaskId "DEV-001" -OwnerRole "developer" -Status "blocked" `
    -Progress "Implementation started but integration is blocked." `
    -Blocker "test environment credentials not available" `
    -NeedsDecision "Need PM decision to avoid idle waiting." `
    -ResponseDueAt $now.AddHours(2).ToUniversalTime().ToString("o") `
    -NextStep "Await PM decision." `
    -Evidence @("log://build/partial-success") `
    -Time $now.AddMinutes(3)

Write-Host "`n[Cycle 4] PM auto-decides and creates platform support task"
& $orchestrator -Action pm-cycle -WorkspaceRoot $WorkspaceRoot

Append-Update -TaskId "PLT-001" -OwnerRole "platform" -Status "done" `
    -Progress "Test credentials opened and shared via secure channel." `
    -NextStep "Developer can switch from mock to test env." `
    -Evidence @("ticket://PLAT-4431") `
    -Time $now.AddMinutes(4)

Append-Update -TaskId "DEV-001" -OwnerRole "developer" -Status "done" `
    -Progress "Core feature completed and endpoint validated." `
    -NextStep "QA can execute full validation." `
    -Evidence @("git://feature/core-endpoint", "report://unit-tests") `
    -Time $now.AddMinutes(5)

Write-Host "`n[Cycle 5] PM dispatches QA"
& $orchestrator -Action pm-cycle -WorkspaceRoot $WorkspaceRoot

Append-Update -TaskId "QA-001" -OwnerRole "qa" -Status "done" `
    -Progress "Acceptance and regression suite passed." `
    -NextStep "Release candidate ready." `
    -Evidence @("report://qa/regression-pass") `
    -Time $now.AddMinutes(6)

Write-Host "`n[Cycle 6] PM closes loop"
& $orchestrator -Action pm-cycle -WorkspaceRoot $WorkspaceRoot

Write-Host "`n=== Final Task Status ==="
& $orchestrator -Action status -WorkspaceRoot $WorkspaceRoot

$latestReport = Get-ChildItem -LiteralPath (Join-Path $WorkspaceRoot "reports") -Filter "pm_report_*.md" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($null -ne $latestReport) {
    Write-Host "`nLatest report: $($latestReport.FullName)"
}

