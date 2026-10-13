# AR2-020 - Cross-platform install-verification harness (Windows).
#
# Proves that a fresh Windows runner can bootstrap Node 24 + pnpm@10.33.2,
# install the Arena 2.0 workspace at an EXACT pinned SHA and run the frozen
# install batteries:
#   pnpm install --frozen-lockfile -> pnpm typecheck -> pnpm lint ->
#   pnpm architecture:check ->
#   arena-contracts corpus -> arena-capsule corpus -> arena-harness smoke.
#
# Usage (Windows PowerShell 5+ or pwsh):
#   powershell -ExecutionPolicy Bypass -File scripts\install-verify\verify-windows.ps1 [[-Sha] <pinned-sha>]
#   pwsh -File scripts/install-verify/verify-windows.ps1 [[-Sha] <pinned-sha>]
#
#   -Sha          optional; default is the AR2-020 mandated base SHA
#                 c9b86d199d9fe95180de0e817b9af4c0b2d0055b (a SHA this harness
#                 family was run against end to end on Linux; the Windows leg
#                 executes the identical battery).
#
# Environment overrides (all optional):
#   INSTALL_VERIFY_MODE=auto|in-place|fresh
#       auto (default): use the checkout the script runs inside when its HEAD
#                       equals the pinned SHA; otherwise fresh-clone at the
#                       pinned SHA into a temp dir.
#       in-place:       require the CWD checkout to be at the pinned SHA.
#       fresh:          always clone into a temp dir at the pinned SHA.
#   INSTALL_VERIFY_ORIGIN=<git-url-or-local-path>
#       Source for fresh-clone mode. Default: the origin remote of the repo
#       the script runs inside, else https://github.com/payswapdotorg/Arena-2.0.git
#   INSTALL_VERIFY_OUT=<dir>
#       Output directory for install-evidence.json + install-transcript.txt.
#       Default: the directory the script is invoked from.
#   INSTALL_VERIFY_DISPOSITION_<STEP>=fixed-in-commit|platform-limitation|not-supported
#       Operator classification for a failed step (STEP in caps, '-' -> '_').
#       Without an override failures are recorded as `unclassified` and must
#       be dispositioned in the evidence report (docs/evidence/install/).
#
# Contract (work order AR2-020 s3.1): every command is echoed to the
# transcript; each step records {name, command, exit_code, duration_ms,
# notes} plus node:test summaries where applicable; capability gaps are
# recorded as typed not_supported dispositions - never silently skipped;
# install-evidence.json (schema arena-install-evidence/1.0) is emitted at the
# end. Exit 0 = overall PASS, exit 1 = FAIL.
#
# Written for Windows PowerShell 5.1 and pwsh 7+ (no PS7-only syntax) so the
# TL-wired GitHub Actions runners can execute it unmodified on
# windows-latest. Self-contained by design (no sourcing, no repo-private
# absolute paths).

param(
    [string]$Sha = "c9b86d199d9fe95180de0e817b9af4c0b2d0055b"
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

$script:PinnedSha = $Sha
$script:Mode = if ($env:INSTALL_VERIFY_MODE) { $env:INSTALL_VERIFY_MODE } else { "auto" }
$script:Keep = if ($env:INSTALL_VERIFY_KEEP) { $env:INSTALL_VERIFY_KEEP } else { "0" }

$script:InvocationDir = (Get-Location).Path
$script:OutDir = if ($env:INSTALL_VERIFY_OUT) { $env:INSTALL_VERIFY_OUT } else { $script:InvocationDir }
if (-not (Test-Path $script:OutDir)) {
    New-Item -ItemType Directory -Path $script:OutDir -Force | Out-Null
}
$script:Transcript = Join-Path $script:OutDir "install-transcript.txt"
$script:EvidenceJson = Join-Path $script:OutDir "install-evidence.json"
Set-Content -Path $script:Transcript -Value "" -Encoding UTF8

$script:TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("arena-install-verify." + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $script:TmpDir -Force | Out-Null

$script:Steps = @()
$script:Failures = @()
$script:Capabilities = @()
$script:StepTotal = 11
$script:StepIndex = 0
$script:Overall = "PASS"
$script:SkipRest = $false
$script:RepoDir = $script:InvocationDir
$script:ModulesPreexisted = "n/a"

function Write-Transcript {
    param([string]$Line)
    Add-Content -Path $script:Transcript -Value $Line -Encoding UTF8
    Write-Output $Line
}

function Write-Lines {
    param([string[]]$Lines)
    foreach ($l in $Lines) {
        if ($null -ne $l) { Add-Content -Path $script:Transcript -Value $l -Encoding UTF8; Write-Output $l }
    }
}

function Get-NodeMajor {
    try {
        $v = & node -p "process.versions.node.split('.')[0]" 2>$null
        if ($LASTEXITCODE -eq 0 -and $v) { return [int]$v }
    } catch { }
    return 0
}

function Get-ToolVersion {
    param([string]$Tool, [string]$Arg = "--version")
    try {
        $out = & $Tool $Arg 2>$null
        if ($LASTEXITCODE -eq 0 -and $out) { return ($out | Select-Object -First 1) }
    } catch { }
    return "absent"
}

function Get-Dispo {
    param([string]$StepName)
    $envName = "INSTALL_VERIFY_DISPOSITION_" + ($StepName.ToUpper() -replace "-", "_")
    $d = [System.Environment]::GetEnvironmentVariable($envName)
    if ($d -eq "fixed-in-commit" -or $d -eq "platform-limitation" -or $d -eq "not-supported") { return $d }
    return "unclassified"
}

function Add-Failure {
    param([string]$Step, [string]$Reason)
    $script:Failures += ,([ordered]@{ step = $Step; disposition = (Get-Dispo $Step); reason = $Reason })
    $script:Overall = "FAIL"
}

function Add-Capability {
    param([string]$Name, [string]$Status, [string]$Reason)
    $script:Capabilities += ,([ordered]@{ name = $Name; status = $Status; reason = $Reason })
}

function Get-SummaryVal {
    param([string[]]$Lines, [string]$Key)
    if ($null -eq $Lines) { return "" }
    if ($Lines -is [string]) { $Lines = @($Lines) }
    $pattern = "^[^0-9A-Za-z]*" + $Key + " (\d+)\s*$"
    for ($i = $Lines.Count - 1; $i -ge 0; $i--) {
        if ($Lines[$i] -match $pattern) { return $Matches[1] }
    }
    return ""
}

function Test-CorpusDrift {
    param([string]$PkgDir, [string[]]$Frozen)
    $testDir = Join-Path (Join-Path $script:RepoDir $PkgDir) "test"
    $found = ""
    if (Test-Path $testDir) {
        $found = (Get-ChildItem -Path $testDir -Filter "*.test.ts" -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object { $_.Name }) -join " "
    }
    $frozenStr = $Frozen -join " "
    if ($found -ne $frozenStr) {
        Write-Transcript "### NOTE corpus drift: test/*.test.ts at pinned SHA = [$found] vs frozen harness corpus [$frozenStr] - harness corpus frozen per AR2-020; re-freeze requires the owning work order"
    }
}

function Invoke-BatteryStep {
    param([string]$Name, [string]$WorkDir, [string]$Exe, [string[]]$ExeArgs, [string]$Display)
    $script:StepIndex = $script:StepIndex + 1
    Write-Transcript ""
    Write-Transcript ("### STEP " + $script:StepIndex + "/" + $script:StepTotal + ": " + $Name)
    if ($WorkDir -ne ".") { Write-Transcript ("`$ cd " + $WorkDir) }
    Write-Transcript ("`$ " + $Display)
    if ($script:SkipRest) {
        Write-Transcript "### SKIPPED (prior chain failure) exit=- duration_ms=0"
        $script:Steps += ,([ordered]@{
            name = $Name
            command = $Display
            exit_code = -1
            duration_ms = 0
            notes = "skipped (prior chain failure)"
        })
        return
    }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $exitCode = 0
    $outLines = @()
    Push-Location $WorkDir -ErrorAction SilentlyContinue
    try {
        $outLines = & $Exe @ExeArgs 2>&1 | ForEach-Object { $_.ToString() }
        if ($null -ne $LASTEXITCODE) { $exitCode = $LASTEXITCODE } else { $exitCode = 0 }
    } catch {
        $outLines = @("INVOCATION ERROR: " + $_.Exception.Message)
        $exitCode = 127
    } finally {
        Pop-Location -ErrorAction SilentlyContinue
    }
    $sw.Stop()
    Write-Lines $outLines
    Write-Transcript ("### exit=" + $exitCode + " duration_ms=" + $sw.ElapsedMilliseconds)

    $notes = ""
    $tPass = Get-SummaryVal -Lines $outLines -Key "pass"
    $tFail = Get-SummaryVal -Lines $outLines -Key "fail"
    $tCancelled = Get-SummaryVal -Lines $outLines -Key "cancelled"
    $tSkipped = Get-SummaryVal -Lines $outLines -Key "skipped"
    switch ($Name) {
        "contracts-corpus" { $notes = "node:test summary: tests=" + (Get-SummaryVal -Lines $outLines -Key "tests") + " pass=" + $tPass + " fail=" + $tFail }
        "capsule-corpus" { $notes = "node:test summary: tests=" + (Get-SummaryVal -Lines $outLines -Key "tests") + " pass=" + $tPass + " fail=" + $tFail }
        "harness-smoke" { $notes = "node:test summary: tests=" + (Get-SummaryVal -Lines $outLines -Key "tests") + " pass=" + $tPass + " fail=" + $tFail }
        "install" {
            $doneLine = ($outLines | Where-Object { $_ -match "^Done in " } | Select-Object -Last 1)
            $warnCount = ($outLines | Where-Object { $_ -match "warn" } | Measure-Object).Count
            $notes = "pnpm summary: " + $(if ($doneLine) { $doneLine } else { "<no Done line>" }) + "; lines matching /warn/i: " + $warnCount + "; node_modules pre-existed: " + $script:ModulesPreexisted
        }
        "lint" {
            $found = ($outLines | Where-Object { $_ -match "Found \d+ warnings? and \d+ errors?" } | Select-Object -Last 1)
            $notes = $found
        }
        "architecture-check" {
            $found = ($outLines | Where-Object { $_ -match "^(architecture|violations|baseline|new):" }) -join ";"
            $notes = $found
        }
        default { $notes = "" }
    }

    $step = [ordered]@{
        name = $Name
        command = $Display
        exit_code = $exitCode
        duration_ms = $sw.ElapsedMilliseconds
        notes = $notes
    }
    if ($tPass -ne "") {
        $step["tests"] = [ordered]@{
            pass = [int]$tPass
            fail = [int]$tFail
            cancelled = [int]$tCancelled
            skipped = [int]$tSkipped
        }
    }
    $script:Steps += ,($step)

    if ($exitCode -ne 0) {
        Add-Failure -Step $Name -Reason ("exit_code=" + $exitCode + " (see install-transcript.txt for full output)")
        switch ($Name) {
            "env" { $script:SkipRest = $true }
            "bootstrap" { $script:SkipRest = $true }
            "resolve-source" { $script:SkipRest = $true }
            "install" { $script:SkipRest = $true }
        }
    }
}

Write-Transcript "================================================================================"
Write-Transcript "AR2-020 install-verification harness - Windows"
Write-Transcript ("pinned_sha=" + $script:PinnedSha + " mode=" + $script:Mode + " started=" + (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))
Write-Transcript ("invocation_dir=" + $script:InvocationDir + " out_dir=" + $script:OutDir)
Write-Transcript "================================================================================"

# ---------------------------------------------------------------- STEP 1: env
$script:StepIndex = $script:StepIndex + 1
Write-Transcript ""
Write-Transcript ("### STEP 1/" + $script:StepTotal + ": env")
$envCmd = "(environment capture: OSVersion, CIM, arch, PS version, tools, cpu/mem/disk)"
Write-Transcript ("`$ " + $envCmd)
$swEnv = [System.Diagnostics.Stopwatch]::StartNew()
$osCaption = "unknown"
$osVersionCim = "unknown"
try {
    $osInfo = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    if ($osInfo) { $osCaption = $osInfo.Caption; $osVersionCim = $osInfo.Version }
} catch { }
$displayVersion = "unknown"
try {
    $cv = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" -ErrorAction SilentlyContinue
    if ($cv -and $cv.DisplayVersion) { $displayVersion = $cv.DisplayVersion }
} catch { }
$cpuCount = $env:NUMBER_OF_PROCESSORS
if (-not $cpuCount) { $cpuCount = "unknown" }
$memGiB = "unknown"
try {
    $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
    if ($cs) { $memGiB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1).ToString("0.0", [System.Globalization.CultureInfo]::InvariantCulture) + " GiB" }
} catch { }
$diskFree = "unknown"
try {
    $drive = (Get-Location).Drive
    if (-not $drive) { $drive = "C" }
    $diskFree = [math]::Round((Get-PSDrive -Name $drive).Free / 1GB, 1).ToString("0.0", [System.Globalization.CultureInfo]::InvariantCulture) + " GiB free on " + $drive + ":"
} catch { }
$psVersion = $PSVersionTable.PSVersion.ToString()
$osArch = $env:PROCESSOR_ARCHITECTURE
if (-not $osArch) { $osArch = "unknown" }
$envLines = @(
    ("OSVersion: " + [System.Environment]::OSVersion.VersionString),
    ("CIM Caption: " + $osCaption + " (Version " + $osVersionCim + ", DisplayVersion " + $displayVersion + ")"),
    ("arch: " + $osArch),
    ("shell: PowerShell " + $psVersion),
    ("cpu_count: " + $cpuCount),
    ("mem_total: " + $memGiB),
    ("disk_free: " + $diskFree),
    ("node: " + (Get-ToolVersion "node")),
    ("pnpm: " + (Get-ToolVersion "pnpm")),
    ("git: " + (Get-ToolVersion "git"))
)
Write-Lines $envLines
$swEnv.Stop()
$envExit = 0
Write-Transcript ("### exit=" + $envExit + " duration_ms=" + $swEnv.ElapsedMilliseconds)
$script:Steps += ,([ordered]@{
    name = "env"
    command = $envCmd
    exit_code = $envExit
    duration_ms = $swEnv.ElapsedMilliseconds
    notes = "see transcript environment block"
})
$script:EnvOsName = $osCaption
$script:EnvOsVersion = $osVersionCim + " (DisplayVersion " + $displayVersion + ", " + [System.Environment]::OSVersion.VersionString + ")"
$script:EnvArch = $osArch

# ---------------------------------------------------------- STEP 2: bootstrap
# Self-bootstrap Node 24 + pnpm@10.33.2 (fresh-runner contract). Node via the
# official nodejs.org ZIP distribution (no admin rights required, fully
# recorded), pnpm via npm. TL-wired CI is expected to provision Node 24 via
# actions/setup-node first, making this a recorded no-op on those runners.
$script:StepIndex = $script:StepIndex + 1
$swBootstrap = [System.Diagnostics.Stopwatch]::StartNew()
$bootstrapExit = 0
$bootstrapNotes = ""
$bootstrapCmds = @()
$nodeVersion = Get-ToolVersion "node"
if ($nodeVersion -ne "absent" -and ((Get-NodeMajor) -ge 24)) {
    $bootstrapNotes = "node $nodeVersion already present (>=24) - no node bootstrap required"
    $bootstrapCmds += "node: (none - node $nodeVersion present)"
} else {
    $nodeDistVersion = "24.21.0"
    $nodeArch = "x64"
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { $nodeArch = "arm64" }
    $nodeUrl = "https://nodejs.org/dist/v$nodeDistVersion/node-v$nodeDistVersion-win-$nodeArch.zip"
    $nodeZip = Join-Path $script:TmpDir "node.zip"
    $nodeExtract = Join-Path $script:TmpDir "node"
    $bootstrapCmds += "node: Invoke-WebRequest $nodeUrl ; Expand-Archive ; prepend to PATH"
    Write-Transcript ""
    Write-Transcript ("`$ Invoke-WebRequest -Uri " + $nodeUrl + " -OutFile " + $nodeZip)
    Write-Transcript ("`$ Expand-Archive -Path " + $nodeZip + " -DestinationPath " + $nodeExtract + " -Force")
    try {
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip -UseBasicParsing
        Expand-Archive -Path $nodeZip -DestinationPath $nodeExtract -Force
        $nodeBin = Join-Path $nodeExtract ("node-v" + $nodeDistVersion + "-win-" + $nodeArch)
        $env:Path = "$nodeBin;" + $env:Path
        $nodeVersion = Get-ToolVersion "node"
        Write-Transcript ("### node bootstrapped: " + $nodeVersion)
    } catch {
        $bootstrapNotes = "node bootstrap FAILED: " + $_.Exception.Message
        $bootstrapExit = 1
        Write-Transcript ("### node bootstrap FAILED: " + $_.Exception.Message)
    }
}
$gitVersion = Get-ToolVersion "git"
$gitVersionShort = $gitVersion
if ($gitVersion -match "(\d+\.\d+\.\d+)") { $gitVersionShort = $Matches[1] }
$pnpmVersion = Get-ToolVersion "pnpm"
$pnpmCmd = ""
if ($pnpmVersion -ne "10.33.2") {
    $pnpmCmd = "npm install -g pnpm@10.33.2"
    Write-Transcript ""
    Write-Transcript ("`$ " + $pnpmCmd)
    $swPnpm = [System.Diagnostics.Stopwatch]::StartNew()
    $pnpmOut = & npm install -g pnpm@10.33.2 2>&1 | ForEach-Object { $_.ToString() }
    $pnpmExit = $LASTEXITCODE
    $swPnpm.Stop()
    Write-Lines $pnpmOut
    Write-Transcript ("### exit=" + $pnpmExit + " duration_ms=" + $swPnpm.ElapsedMilliseconds)
    if ($pnpmExit -ne 0) {
        $bootstrapNotes = "$bootstrapNotes; pnpm bootstrap FAILED (exit $pnpmExit)"
        $bootstrapExit = 1
    }
    $pnpmVersion = Get-ToolVersion "pnpm"
    $bootstrapCmds += "pnpm: " + $pnpmCmd
} else {
    $bootstrapNotes = "$bootstrapNotes; pnpm $pnpmVersion already pinned - no pnpm bootstrap required"
    $bootstrapCmds += "pnpm: (none - pnpm $pnpmVersion present)"
}
Write-Transcript ""
Write-Transcript ("### STEP 2/" + $script:StepTotal + ": bootstrap - node=" + $nodeVersion + " pnpm=" + $pnpmVersion + " git=" + $gitVersion)
$swBootstrap.Stop()
$script:Steps += ,([ordered]@{
    name = "bootstrap"
    command = ("ensure node>=24 + pnpm@10.33.2 (" + ($bootstrapCmds -join " ; ") + ")")
    exit_code = $bootstrapExit
    duration_ms = $swBootstrap.ElapsedMilliseconds
    notes = $bootstrapNotes
})
$script:NodeVersion = $nodeVersion
$script:PnpmVersion = $pnpmVersion
$script:GitVersion = $gitVersionShort
$script:BootstrapCommands = ($bootstrapCmds -join "`n")
$script:BootstrapNotes = $bootstrapNotes
if ($bootstrapExit -ne 0) {
    Add-Failure -Step "bootstrap" -Reason $bootstrapNotes
    $script:SkipRest = $true
}

# ---------------------------------------------------- STEP 3: resolve-source
$originDefault = "https://github.com/payswapdotorg/Arena-2.0.git"
try {
    $originUrl = & git -C $script:InvocationDir remote get-url origin 2>$null
    if ($LASTEXITCODE -eq 0 -and $originUrl) { $originDefault = ($originUrl | Select-Object -First 1) }
} catch { }
$origin = $originDefault
if ($env:INSTALL_VERIFY_ORIGIN) { $origin = $env:INSTALL_VERIFY_ORIGIN }

$resolveExit = 0
$resolveNotes = ""
$sourceMode = "fresh-clone"
$repoClean = "true"
if ($script:SkipRest) {
    $resolveNotes = "skipped (bootstrap failure)"
    $sourceMode = "n/a"
    $repoClean = "unknown"
    $script:StepIndex = $script:StepIndex + 1
    $script:Steps += ,([ordered]@{
        name = "resolve-source"
        command = "skipped"
        exit_code = -1
        duration_ms = 0
        notes = $resolveNotes
    })
} else {
    $script:StepIndex = $script:StepIndex + 1
    Write-Transcript ""
    Write-Transcript ("### STEP " + $script:StepIndex + "/" + $script:StepTotal + ": resolve-source (pinned_sha=" + $script:PinnedSha + " mode=" + $script:Mode + " origin=" + $origin + ")")
    $cwdSha = ""
    $cwdIsRepo = $false
    try {
        $cwdSha = (& git -C $script:InvocationDir rev-parse HEAD 2>$null | Select-Object -First 1)
        if ($LASTEXITCODE -eq 0 -and $cwdSha) { $cwdIsRepo = $true }
    } catch { }
    $useInplace = $false
    if ($script:Mode -eq "in-place") {
        if ($cwdIsRepo -and $cwdSha -eq $script:PinnedSha) {
            $useInplace = $true
        } else {
            $resolveExit = 1
            $resolveNotes = "mode=in-place forced but CWD HEAD (" + $cwdSha + ") != pinned SHA"
        }
    } elseif ($script:Mode -eq "fresh") {
        $useInplace = $false
    } else {
        if ($cwdIsRepo -and $cwdSha -eq $script:PinnedSha) { $useInplace = $true } else { $useInplace = $false }
    }
    $swResolve = [System.Diagnostics.Stopwatch]::StartNew()
    if ($resolveExit -eq 0) {
        if ($useInplace) {
            $script:RepoDir = $script:InvocationDir
            $sourceMode = "in-place-checkout"
            $dirtyCount = 0
            try {
                $status = & git -C $script:RepoDir status --porcelain 2>$null
                if ($LASTEXITCODE -eq 0 -and $status) { $dirtyCount = @($status).Count }
            } catch { }
            if ($dirtyCount -eq 0) {
                $repoClean = "true"
                $resolveNotes = "in-place checkout at pinned SHA; working tree clean"
            } else {
                $repoClean = "false"
                $resolveNotes = "in-place checkout at pinned SHA; WARNING: $dirtyCount uncommitted path(s) present (recorded repo_clean=false)"
            }
            Write-Transcript ("`$ git -C . rev-parse HEAD  # => " + $script:PinnedSha + " (in-place)")
            Write-Transcript ("### resolve: in-place at " + $script:PinnedSha + " (" + $resolveNotes + ")")
        } else {
            $script:RepoDir = Join-Path $script:TmpDir "arena"
            Write-Transcript ("`$ git clone --quiet " + $origin + " " + $script:RepoDir)
            Write-Transcript ("`$ git -C " + $script:RepoDir + " checkout " + $script:PinnedSha)
            $cloneOk = $true
            $cloneOut = @()
            try {
                $cloneOut += & git clone --quiet $origin $script:RepoDir 2>&1 | ForEach-Object { $_.ToString() }
                if ($LASTEXITCODE -ne 0) { $cloneOk = $false }
                $cloneOut += & git -C $script:RepoDir checkout --quiet $script:PinnedSha 2>&1 | ForEach-Object { $_.ToString() }
                if ($LASTEXITCODE -ne 0) { $cloneOk = $false }
            } catch {
                $cloneOut += "GIT ERROR: " + $_.Exception.Message
                $cloneOk = $false
            }
            Write-Lines $cloneOut
            if ($cloneOk) {
                $gotSha = (& git -C $script:RepoDir rev-parse HEAD 2>$null | Select-Object -First 1)
                if ($gotSha -eq $script:PinnedSha) {
                    $resolveNotes = "fresh clone from $origin at pinned SHA $script:PinnedSha (verified rev-parse HEAD)"
                } else {
                    $resolveExit = 1
                    $resolveNotes = "fresh clone HEAD $gotSha != pinned $script:PinnedSha"
                }
            } else {
                $resolveExit = 1
                $resolveNotes = "git clone/checkout failed for origin=$origin sha=" + $script:PinnedSha
            }
        }
    }
    $swResolve.Stop()
    Write-Transcript ("### exit=" + $resolveExit + " duration_ms=" + $swResolve.ElapsedMilliseconds)
    $script:Steps += ,([ordered]@{
        name = "resolve-source"
        command = ("git clone " + $origin + " && git checkout " + $script:PinnedSha + " (or in-place checkout at same SHA)")
        exit_code = $resolveExit
        duration_ms = $swResolve.ElapsedMilliseconds
        notes = $resolveNotes
    })
    if ($resolveExit -ne 0) {
        Add-Failure -Step "resolve-source" -Reason $resolveNotes
        $script:SkipRest = $true
    }
}
$script:SourceMode = $sourceMode
$script:RepoClean = $repoClean
$script:OriginUsed = $origin

# -------------------------------------------------- STEP 4: install (frozen)
$script:ModulesPreexisted = "no"
if (Test-Path (Join-Path $script:RepoDir "node_modules")) { $script:ModulesPreexisted = "yes" }
Invoke-BatteryStep -Name "install" -WorkDir $script:RepoDir -Exe "pnpm" -ExeArgs @("install", "--frozen-lockfile") -Display "pnpm install --frozen-lockfile"

# ------------------------------------------------------------- STEP 5-7: gates
Invoke-BatteryStep -Name "typecheck" -WorkDir $script:RepoDir -Exe "pnpm" -ExeArgs @("typecheck") -Display "pnpm typecheck"
Invoke-BatteryStep -Name "lint" -WorkDir $script:RepoDir -Exe "pnpm" -ExeArgs @("lint") -Display "pnpm lint"
Invoke-BatteryStep -Name "architecture-check" -WorkDir $script:RepoDir -Exe "pnpm" -ExeArgs @("architecture:check") -Display "pnpm architecture:check"

# ------------------------------------------------- STEP 8: contracts corpus
Test-CorpusDrift -PkgDir "packages\arena-contracts" -Frozen @("vectors.test.ts", "transitions.test.ts", "completeness.test.ts", "ownership.test.ts", "contracts.test.ts")
Invoke-BatteryStep -Name "contracts-corpus" -WorkDir (Join-Path $script:RepoDir "packages\arena-contracts") -Exe "..\..\node_modules\.bin\tsx.cmd" -ExeArgs @("--test", "test/vectors.test.ts", "test/transitions.test.ts", "test/completeness.test.ts", "test/ownership.test.ts", "test/contracts.test.ts") -Display "../../node_modules/.bin/tsx --test test/vectors.test.ts test/transitions.test.ts test/completeness.test.ts test/ownership.test.ts test/contracts.test.ts"

# --------------------------------------------------- STEP 9: capsule corpus
Test-CorpusDrift -PkgDir "packages\arena-capsule" -Frozen @("capsule.test.ts", "synthetic-provider.test.ts")
Invoke-BatteryStep -Name "capsule-corpus" -WorkDir (Join-Path $script:RepoDir "packages\arena-capsule") -Exe "..\..\node_modules\.bin\tsx.cmd" -ExeArgs @("--test", "test/capsule.test.ts", "test/synthetic-provider.test.ts") -Display "../../node_modules/.bin/tsx --test test/capsule.test.ts test/synthetic-provider.test.ts"

# -------------------------------------------------- STEP 10: harness smoke
Test-CorpusDrift -PkgDir "packages\arena-harness" -Frozen @("vertical-p0.test.ts", "next-expert.test.ts", "p2-review.test.ts", "two-instance-recovery.test.ts")
Invoke-BatteryStep -Name "harness-smoke" -WorkDir (Join-Path $script:RepoDir "packages\arena-harness") -Exe "..\..\node_modules\.bin\tsx.cmd" -ExeArgs @("--test", "test/vertical-p0.test.ts", "test/next-expert.test.ts", "test/p2-review.test.ts", "test/two-instance-recovery.test.ts") -Display "../../node_modules/.bin/tsx --test test/vertical-p0.test.ts test/next-expert.test.ts test/p2-review.test.ts test/two-instance-recovery.test.ts"

# --------------------------------- STEP 11: isolation-runtime probe (typed)
$script:StepIndex = $script:StepIndex + 1
Write-Transcript ""
Write-Transcript ("### STEP " + $script:StepIndex + "/" + $script:StepTotal + ": isolation-runtime-probe")
Write-Transcript ("`$ (probe) AR2-019 OS-level capsule isolation runtime is registered Linux-only (bwrap); no equivalent runtime exists on win32 at pinned SHA")
Write-Transcript ("### probe: not_supported - AR2-019 bwrap-based isolation runtime is Linux-only; Windows has no bwrap; recorded as typed not_supported (never a silent skip)")
Add-Capability -Name "os-level-isolation-runtime" -Status "not_supported" -Reason ("AR2-019 OS-level capsule isolation runtime is registered Linux-only (bwrap); no bwrap equivalent on win32 at pinned SHA " + $script:PinnedSha)
$script:Steps += ,([ordered]@{
    name = "isolation-runtime-probe"
    command = "(typed probe - AR2-019 isolation runtime is Linux-only)"
    exit_code = 0
    duration_ms = 0
    notes = "not_supported on win32; see capabilities[] in install-evidence.json"
})

# ------------------------------------------------------- emit JSON evidence
$evidence = [ordered]@{
    schema = "arena-install-evidence/1.0"
    work_order = "AR2-020"
    harness = "scripts/install-verify/verify-windows.ps1"
    platform = "win32"
    platform_label = ("Windows (" + $script:EnvOsName + ") " + $script:EnvArch)
    os = [ordered]@{
        name = $script:EnvOsName
        version = $script:EnvOsVersion
        arch = $script:EnvArch
        kernel = [System.Environment]::OSVersion.VersionString
        shell = ("PowerShell " + $PSVersionTable.PSVersion.ToString())
    }
    resources = [ordered]@{
        cpu_count = $cpuCount
        mem_total = $memGiB
        disk_free = $diskFree
    }
    pinned_sha = $script:PinnedSha
    source_mode = $script:SourceMode
    origin = $script:OriginUsed
    repo_clean = $script:RepoClean
    tools = [ordered]@{
        node = $script:NodeVersion
        pnpm = $script:PnpmVersion
        git = $script:GitVersion
        tsx = "resolved at install via workspace devDependency tsx@^4.19.4 (root package.json)"
    }
    bootstrap = [ordered]@{
        commands = $script:BootstrapCommands
        notes = $script:BootstrapNotes
    }
    steps = $script:Steps
    capabilities = $script:Capabilities
    failures = $script:Failures
    verdict = [ordered]@{
        overall = $script:Overall
        generated_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
}
$json = $evidence | ConvertTo-Json -Depth 8
Set-Content -Path $script:EvidenceJson -Value $json -Encoding UTF8
Write-Transcript ("install-evidence.json written to " + $script:EvidenceJson)

Write-Transcript ""
Write-Transcript "================================================================================"
Write-Transcript ("AR2-020 Windows install verification: " + $script:Overall)
Write-Transcript ("transcript: " + $script:Transcript)
Write-Transcript ("evidence:   " + $script:EvidenceJson)
Write-Transcript "================================================================================"

if ($script:Keep -eq "1") {
    Write-Transcript ("KEEP=1 - fresh-clone workdir retained at " + $script:TmpDir)
} else {
    try { Remove-Item -Recurse -Force $script:TmpDir -ErrorAction SilentlyContinue } catch { }
}

if ($script:Overall -eq "PASS") { exit 0 } else { exit 1 }
