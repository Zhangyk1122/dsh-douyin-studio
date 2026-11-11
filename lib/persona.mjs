/**
 * 抖音这边用谁的嘴说话。
 *
 * 2026-11-11 之前：dy 读的是 `qq-pet/identity.md` + `style.md` 折出来的 520 字摘要，
 * 而真正在 QQ 里活着的小汐用的是另一张卡（`plugins-data/aurabot/personas/xiaoxi.md`）。
 * 两张卡不是同一版人格 —— 于是同一个人，在 QQ 里和在抖音里说话像两个人：
 * 抖音这边丢了括号习惯、丢了"留半句"、丢了「不说想你」这类取舍。
 *
 * 现在：默认直接读她那张活卡（`personaSource: 'aurabot'`），
 * 读不到才退回旧摘要。卡是按 mtime 缓存的，改一次卡不用重启。
 */
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const GENERIC = '你是这个抖音账号的主人，正在抖音上跟人说话。'

/** 她那张卡在哪：`~/.dsh/plugins-data/aurabot/personas/<current>.md` */
export function defaultPersonaFile(name = 'xiaoxi') {
	return join(homedir(), '.dsh', 'plugins-data', 'aurabot', 'personas', String(name || 'xiaoxi') + '.md')
}

let cache = { key: '', text: '' }

/**
 * 读卡。返回原文（截到 maxChars），读不到返回空串。
 * 缓存键 = 路径 + mtime + size，改完立刻生效。
 */
export function readPersonaCard(file, { maxChars = 6000 } = {}) {
	if (!file) return ''
	try {
		const st = statSync(file)
		const key = file + '|' + st.mtimeMs + '|' + st.size
		if (cache.key === key) return cache.text
		const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim()
		const text = raw.slice(0, Math.max(200, Number(maxChars) || 6000))
		cache = { key, text: text }
		return text
	} catch {
		return ''
	}
}

/**
 * 给抖音用的人设正文。
 * @param {{personaSource?:string, persona?:string, personaFile?:string, personaName?:string}} s
 * @param {{fallback?:() => string}} [opts] 读不到卡时的退路（老摘要），由调用方注入，避免循环依赖
 */
export function personaForDy(s, opts = {}) {
	const mode = String((s && s.personaSource) || 'aurabot')
	if (mode === 'off') return GENERIC
	const custom = String((s && s.persona) || '').trim().slice(0, 200)
	if (custom) return custom
	const file = String((s && s.personaFile) || '').trim() || defaultPersonaFile(s && s.personaName)
	const card = readPersonaCard(file)
	if (card) {
		/* 卡是给 QQ 写的，里面有「群里」「群里默认两条」这种跟抖音无关的运输层规矩。
		 * 不删卡里的字（那是她本人写的），只在末尾补一句场景，免得她把群聊条数当评论区规则。 */
		return card + '\n\n---\n现在这里是抖音：你在自己的作品下回评论，或者在别人的评论区 @ 主人。' +
			'按上面这个人说话；评论和 @ 都只写一句到两句，不分条、不带条数规矩。'
	}
	if (typeof opts.fallback === 'function') {
		const f = String(opts.fallback() || '').trim()
		if (f) return f
	}
	return GENERIC
}
