param(
    [string]$BaseRef = "origin/main",
    [string]$ProjectName,
    [string]$ParentDirectory,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Test-GitRef {
    param([string]$Ref)

    git rev-parse --verify --quiet $Ref *> $null
    return $LASTEXITCODE -eq 0
}

$repoRoot = (git rev-parse --show-toplevel).Trim()
if (-not $repoRoot) {
    throw "Run this script from inside a git repository."
}

if (-not $ProjectName) {
    $ProjectName = Split-Path -Leaf $repoRoot
}

if (-not $ParentDirectory) {
    $ParentDirectory = Split-Path -Parent $repoRoot
}

if (-not $DryRun) {
    git fetch origin --prune
}

if (-not (Test-GitRef $BaseRef)) {
    throw "Base ref '$BaseRef' does not exist. Fetch origin or pass -BaseRef with a valid ref."
}

$agents = @(
    @{ Name = "Codex"; Slug = "codex" },
    @{ Name = "Claude"; Slug = "claude" },
    @{ Name = "Gemini"; Slug = "gemini" },
    @{ Name = "Antigravity"; Slug = "antigravity" }
)

foreach ($agent in $agents) {
    $branch = "$($agent.Slug)/idle"
    $path = Join-Path $ParentDirectory "$ProjectName-$($agent.Slug)"

    if (Test-Path -LiteralPath $path) {
        Write-Host "Exists, skipping: $path"
        continue
    }

    $branchExists = Test-GitRef "refs/heads/$branch"
    if ($branchExists) {
        $args = @("worktree", "add", $path, $branch)
    } else {
        $args = @("worktree", "add", $path, "-b", $branch, $BaseRef)
    }

    if ($DryRun) {
        Write-Host "git $($args -join ' ')"
    } else {
        Write-Host "Creating $($agent.Name) worktree at $path"
        & git @args
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create $($agent.Name) worktree."
        }
    }
}

Write-Host "Agent worktree setup complete."
