/**
 * lib/cache.mjs —— 「先给旧的，后台再刷」的判定规则
 * ============================================================================
 * 为什么单独抽出来：缓存策略最容易写成「if 里塞三个条件」，然后没人敢动。
 * 这里只回答一个问题：**这一次请求，该直接拿缓存、还是该等真结果？**
 *
 * 三种结论：
 *   cold  —— 没缓存 / 缓存不是这个 limit 的 → 只能等（首次打开会慢，之后不会）
 *   fresh —— 还新鲜 → 直接给，别去打接口（省风控、省额度）
 *   stale —— 有缓存但过期 → **立刻把旧的给出去**，同时后台开一轮
 *
 * 设计取舍：宁可给 2 分钟前的列表，也不让用户盯着转圈 15 秒。
 * 所以 stale 的语义是「先答，再改」，不是「等新的」。
 * ============================================================================
 */

/** 默认 2 分钟：短到打开面板基本都能看到新的，长到不会每次开都去打一遍接口 */
export const DEFAULT_TTL = 120000

/**
 * @param {{at?:string, limit?:number, data?:any}|null} cache 磁盘上那份缓存
 * @param {{now?:number, ttl?:number, limit?:number}} [opts]
 * @returns {{mode:'cold'|'fresh'|'stale', ageMs:number, why:string}}
 */
export function decideCache(cache, opts = {}) {
	const now = Number.isFinite(opts.now) ? opts.now : Date.now()
	const ttl = Number.isFinite(opts.ttl) ? opts.ttl : DEFAULT_TTL
	const limit = Number(opts.limit) || 0

	if (!cache || typeof cache !== 'object' || !cache.data) {
		return { mode: 'cold', ageMs: Infinity, why: '没有缓存' }
	}
	// 换了 limit（比如从 8 改成 20）就别拿旧的那份凑数 —— 条数对不上比慢更糟
	if (limit && Number(cache.limit) !== limit) {
		return { mode: 'cold', ageMs: Infinity, why: `缓存是 limit=${cache.limit}，这次要 ${limit}` }
	}

	const t = Date.parse(cache.at)
	// 时间戳读不出来 = 当作过期（宁可重刷，也别把一份来路不明的数据当成新的）
	if (!Number.isFinite(t)) return { mode: 'stale', ageMs: ttl + 1, why: '时间戳读不出来' }

	const ageMs = Math.max(0, now - t)
	return ageMs > ttl
		? { mode: 'stale', ageMs, why: `已经 ${Math.round(ageMs / 1000)} 秒` }
		: { mode: 'fresh', ageMs, why: `${Math.round(ageMs / 1000)} 秒前` }
}

/**
 * 一次 `/inbox` 请求该回什么、要不要等。抽成函数是为了能测出「秒开」这件事本身。
 *
 * @param {{
 *   lim:number,
 *   force?:boolean,
 *   cache:any,
 *   busy?:boolean,
 *   refresh:(lim:number)=>Promise<any>,
 *   ttl?:number,
 *   now?:number,
 * }} o
 * @returns {Promise<{body:any, waited:boolean, fromCache:boolean}>}
 *   waited=false 就代表这次的响应是「立刻」给出的 —— 也就是秒开。
 */
export async function serveInbox(o) {
	const now = Number.isFinite(o.now) ? o.now : Date.now()
	const ttl = Number.isFinite(o.ttl) ? o.ttl : DEFAULT_TTL
	const lim = o.lim
	const stamp = (extra) => ({ at: new Date(now).toISOString(), ageMs: 0, refreshing: false, ...extra })

	// 明确要新的：等（发完消息得看见自己那条）
	if (o.force) {
		const r = await o.refresh(lim)
		return { body: { ...r, cache: stamp() }, waited: true, fromCache: false }
	}

	const d = decideCache(o.cache, { ttl, limit: lim, now })

	// 冷启动：没别的办法，等
	if (d.mode === 'cold') {
		const r = await o.refresh(lim)
		return { body: { ...r, cache: stamp({ cold: true }) }, waited: true, fromCache: false }
	}

	// 过期：**先把旧的给出去**，再让它在后台跑 —— 这就是「先答再改」
	let started = false
	if (d.mode === 'stale') {
		started = true
		o.refresh(lim) // 故意不 await
	}

	return {
		body: {
			...o.cache.data,
			cache: {
				at: o.cache.at,
				ageMs: d.ageMs,
				refreshing: started || Boolean(o.busy),
				stale: d.mode === 'stale',
			},
		},
		waited: false,
		fromCache: true,
	}
}
