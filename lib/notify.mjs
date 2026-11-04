/**
 * lib/notify.mjs —— Windows 桌面通知（一条也能弹，不装依赖）
 * ============================================================================
 * 做法：调 PowerShell 的 WinRT Toast。
 *   - 不用 BurntToast（要装模块），也不用 node-notifier（要 electron 运行时）。
 *   - AUMID 用 PowerShell 自己的，全系统都在，不会因为「没注册应用」而弹不出来。
 *
 * ⚠️ 踩过的坑：
 *   - PowerShell 里传中文必须走 `-EncodedCommand`（UTF-16LE + base64），
 *     直接 `-Command` 在 GBK 控制台下会把中文变成 `?`。
 *   - 字符串里出现反引号 / 双引号要自己转义，否则整条命令语法错误、静默失败。
 * ============================================================================
 */
import { spawn } from 'node:child_process'

const enc = (s) => Buffer.from(String(s), 'utf16le').toString('base64')

/** XML 转义：Toast 的 title/body 走 XML，`&` `<` `>` 不转就整条弹不出来 */
const x = (s) => String(s == null ? '' : s)
	.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	.replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const PS = (title, body, appId) => `
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = @"
<toast><visual><binding template="ToastGeneric"><text>${x(title)}</text><text>${x(body)}</text></binding></visual></toast>
"@
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${appId}').Show($toast)
Write-Output 'shown'
`

/** 一条通知（返回 ok / 失败原因，永不抛） */
export function notify(title, body, { appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe', timeout = 20000 } = {}) {
	return new Promise((resolve) => {
		const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc(PS(title, body, appId))], {
			windowsHide: true,
		})
		let out = ''
		let err = ''
		const t = setTimeout(() => { try { ps.kill() } catch { /* 已经没了 */ } }, timeout)
		ps.stdout.on('data', (b) => { out += b })
		ps.stderr.on('data', (b) => { err += b })
		ps.on('close', (code) => {
			clearTimeout(t)
			if (/shown/.test(out)) resolve({ ok: true })
			else resolve({ ok: false, error: String(err || out || ('exit ' + code)).slice(0, 300) })
		})
		ps.on('error', (e) => { clearTimeout(t); resolve({ ok: false, error: String(e.message || e) }) })
	})
}

/** 现在是不是「该闭嘴的时段」（默认 23:00–07:30 不弹；静音只是不弹，数据照记）
 *  2026-11-03：时段可由面板设置（走 DOUYIN_STUDIO_QUIET_FROM/TO），不填就用回默认。 */
const envHour = (k, dflt) => {
	const m = String(process.env[k] || '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/)
	return m ? Number(m[1]) + Number(m[2]) / 60 : dflt
}
export function isQuiet(now = new Date(), opts = {}) {
	const from = Number.isFinite(opts.from) ? opts.from : envHour('DOUYIN_STUDIO_QUIET_FROM', 23)
	const to = Number.isFinite(opts.to) ? opts.to : envHour('DOUYIN_STUDIO_QUIET_TO', 7.5)
	const h = now.getHours() + now.getMinutes() / 60
	if (from > to) return h >= from || h < to
	return h >= from && h < to
}
