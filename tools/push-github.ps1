# 一键推到 GitHub（钥匙加好、仓库建好之后跑这个）
#   用法：powershell -File tools\push-github.ps1 [-Repo dsh-douyin-studio]
# 它做四件事：验钥匙 → 从 ssh -T 里读用户名 → 配 remote → push
param([string]$Repo = 'dsh-douyin-studio')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '[1/4] 验 SSH 钥匙…'
$hello = (ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes -T git@github.com 2>&1) -join "`n"
if ($hello -match 'Hi ([A-Za-z0-9-]+)!') {
	$user = $Matches[1]
	Write-Host "      OK：$user"
} else {
	Write-Host '      失败：钥匙还没加到 GitHub，或没被接受。'
	Write-Host $hello
	exit 1
}

Write-Host '[2/4] 配 remote…'
$url = "git@github.com:$user/$Repo.git"
$existing = (git remote -v) -join "`n"
if ($existing -match 'origin') { git remote set-url origin $url } else { git remote add origin $url }
Write-Host "      $url"

Write-Host '[3/4] 看远端有没有这个仓库…'
$probe = (git ls-remote --heads origin 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0) {
	Write-Host '      远端还没有这个仓库。去 https://github.com/new 建一个同名空仓库（不要勾 README），再跑一次。'
	exit 2
}

Write-Host '[4/4] push…'
git push -u origin main
Write-Host '      完成。'
