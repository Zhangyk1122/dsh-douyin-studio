/**
 * lib/publish-steps.mjs —— 抖音创作者中心发布的各步骤函数
 * ============================================================================
 * 每个导出函数都对应发布流程里的一个独立步骤。
 * 全部接受 (session: CdpSession, params) 的形式，便于单独测试和重组。
 *
 * 返回格式统一：{ ok: boolean, ...details }
 * ok=false 时必有 why 字段描述原因；调用方负责决定是否中止。
 *
 * ⚠️ 踩过的坑（别删这些注释）：
 *   - 零宽字符：空编辑器有 \u200b，len=1 但 counter=0，clear 必须 Ctrl+A+Backspace
 *   - DY_MUSIC：只信 chip 换了，不信 panel 关了（panel 关了 chip 不一定变）
 *   - COVER：panelOpen 必须检查真实 dialog 元素，不能只检测「设置封面」文字
 *     （2026-10-30：文字判断导致封面其实已经换了但报失败）
 *   - pub.abnormal=true：点了发布按钮但没拿到成功或失败证据，绝对不能自动重试
 * ============================================================================
 */
/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 选择器常量 ────────────────────────────────────────────────────────────────

/**
 * 找「标题」输入框：所有 input 里找 placeholder 含「标题」的。
 */
const SEL_TITLE =
	`Array.from(document.querySelectorAll('input')).find(el=>el.placeholder&&el.placeholder.includes('标题'))`

/**
 * 找「简介/描述」编辑器：优先找 contenteditable 且 data-placeholder 含「简介」或「描述」，
 * 退而求其次找最后一个可见的 contenteditable。
 */
const SEL_DESC =
	`(()=>{` +
	`const p=Array.from(document.querySelectorAll('[contenteditable]')).find(el=>` +
	`el.dataset.placeholder&&/简介|描述/.test(el.dataset.placeholder));` +
	`if(p)return p;` +
	`const all=Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(el=>{` +
	`const r=el.getBoundingClientRect();return r.width>0&&r.height>0;});` +
	`return all[all.length-1]||null;` +
	`})()`

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/** 去空白和零宽字符，用于比较 */
const norm = (s) => String(s || '').replace(/\s/g, '').replace(/\u200b/g, '')

// ── 步骤函数 ──────────────────────────────────────────────────────────────────

/**
 * 等待编辑器就绪（视频 60s，图文 30s），并关掉「我知道了」气泡。
 *
 * @param {import('./publish-cdp.mjs').CdpSession} s
 * @param {{ kind: 'video'|'image' }} params
 * @returns {Promise<{ok:boolean, why?:string}>}
 */
export async function stepWaitReady(s, { kind }) {
	const timeout = kind === 'video' ? 60000 : 30000
	const editorExpr = `!!(${SEL_TITLE}||${SEL_DESC})`
	const ready = await s.waitFor(editorExpr, { timeout, interval: 500 })
	if (!ready) return { ok: false, why: '等待编辑器超时' }
	await sleep(500) // 给 React 稳住

	// 尝试关掉「我知道了」提示气泡（最多 3 次）
	for (let i = 0; i < 3; i++) {
		const btn = await s.evalJs(
			`Array.from(document.querySelectorAll('button,span')).find(el=>el.textContent.trim()==='我知道了')`,
		)
		if (!btn) break
		await s.evalJs(`(()=>{const el=Array.from(document.querySelectorAll('button,span')).find(el=>el.textContent.trim()==='我知道了');if(el)el.click();})()`)
		await sleep(400)
	}

	return { ok: true }
}

/**
 * 填写标题。
 *
 * @param {import('./publish-cdp.mjs').CdpSession} s
 * @param {{ title: string, titleMax: number }} params
 * @returns {Promise<{ok:boolean, already?:boolean, got?:string, why?:string}>}
 */
export async function stepTitle(s, { title, titleMax }) {
	const text = title.slice(0, titleMax)
	return s.fillField({
		label: '标题',
		selectorExpr: SEL_TITLE,
		text,
		readExpr: `(()=>{const el=${SEL_TITLE};return el?el.value:''})()`,
	})
}

/**
 * 填写简介/描述。
 * ⚠️ 末尾带 # 的话题标签需要补一个空格，否则最后一个标签不会变成胶囊（抖音 bug）。
 *
 * @param {import('./publish-cdp.mjs').CdpSession} s
 * @param {{ desc: string }} params
 * @returns {Promise<{ok:boolean, already?:boolean, got?:string, why?:string}>}
 */
export async function stepDesc(s, { desc }) {
	// 胶囊补丁：末尾 # 标签后补空格
	const text = /#\S+$/.test(desc) ? desc + ' ' : desc
	return s.fillField({
		label: '简介',
		selectorExpr: SEL_DESC,
		text,
		readExpr: `(()=>{const el=${SEL_DESC};if(!el)return '';return(el.value||el.innerText||'').replace(/\u200b/g,'').trim();})()`,
		verify: (got) => norm(got).includes(norm(text.trim())),
	})
}

/**
 * 设置背景音乐（DY_MUSIC）。
 * ⚠️ 只信 chip 换了（[class*=music-text] 或 [class*=music-binder]），不信 panel 关了。
 *
 * @param {import('./publish-cdp.mjs').CdpSession} s
 * @param {{ dyMusic: string }} params
 * @returns {Promise<{ok:boolean, chip?:string, why?:string}>}
 */
export async function stepMusic(s, { dyMusic }) {
	// 入口按页面形态换名字（2026-11-02 实测）：
	//   视频页 → 「添加音乐」（div.preview-button-xxx，在封面卡右下，x≈1133）
	//   图文页 → 没有「添加音乐」，只有「选择音乐」/「点击添加合适作品风格音乐」
	// 之前只认「添加音乐」，所以图文发布一发就报「找不到」。
	const ENTRY = `(()=>{
		const center=(el)=>{el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),h:Math.round(r.height)};};
		// ① 优先：视频页那个真按钮 [class*=preview-button]（比它内部 .text-xxx 更准，
		//    内层文字的 y 会偏 18px，点到旁边「重新上传」上——2026-11-02 实测）
		for (const n of ['添加音乐','选择音乐']) {
			const btn=[...document.querySelectorAll('[class*="preview-button"]')].filter(el=>el.textContent.trim()===n);
			if (btn.length) return center(btn[0]);
		}
		// ② 退路：按文字找，取靠右的
		for (const n of ['添加音乐','选择音乐','点击添加合适作品风格音乐']) {
			const hit=[...document.querySelectorAll('button,span,div')]
				.filter(el=>el.textContent.trim()===n)
				.map(center)
				.filter(p=>p.w>10&&p.h>10)
				.sort((a,b)=>(b.x-a.x)||(a.y-b.y));
			if (hit.length) return hit[0];
		}
		return null;
	})()`
	const entry = await s.waitFor(ENTRY, { timeout: 60000, interval: 800 })
	if (!entry) return { ok: false, why: '找不到音乐入口（添加音乐/选择音乐）' }

	// ⚠️ 必须先 hover 再点：这一页的「添加音乐」是 hover 态按钮，直接 dispatch
	// 按下/抬起不会触发（2026-11-02 三种方式对照实测：el.click()、合成 PointerEvent
	// 都开不了面板，只有 mouseMoved + 真点击才行）。
	// 另外视频还在转码时这个按钮是「在但不响应」的，so 点完等不到搜索框就再点，
	// 最多 4 轮（每轮 5s），兼做转码等待。
	const SEARCH = `!!document.querySelector('input[placeholder*="搜索"]')`
	let searchReady = false
	for (let attempt = 0; attempt < 4 && !searchReady; attempt++) {
		await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: entry.x, y: entry.y, button: 'none' })
		await sleep(500)
		await s.clickAt(entry.x, entry.y)
		searchReady = await s.waitFor(SEARCH, { timeout: 5000, interval: 400 })
		if (!searchReady) {
			// 还没转完码的时候按钮在但没反应，等一下再试
			await s.waitFor(`!/上传中|处理中|转码中/.test(document.body.innerText)`, {
				timeout: 20000,
				interval: 1000,
			})
		}
	}
	if (!searchReady) {
		// 失败时把现场带出来：点位、谁接住了这一点、页面在不在转码
		const diag = await s.evalJs(`(()=>{
			const hit=document.elementFromPoint(${entry.x},${entry.y});
			const body=(document.body.innerText||'').replace(/\\s+/g,' ');
			return {
				pt:{x:${entry.x},y:${entry.y}},
				hit:hit?{tag:hit.tagName,cls:String(hit.className||'').slice(0,40)}:null,
				viewport:{w:innerWidth,h:innerHeight},
				btn:[...document.querySelectorAll('[class*="preview-button"]')].map(e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};}),
				uploading:/上传中|处理中|转码中/.test(body),
				body:body.slice(0,200),
			};
		})()`)
		return { ok: false, why: '音乐搜索框未出现（点了 4 次都没开）', diag }
	}

	// 插入搜索文字
	const searchFocused = await s.evalJs(
		`(()=>{const el=document.querySelector('input[placeholder*="搜索"]');if(!el)return false;el.focus();return true;})()`,
	)
	if (!searchFocused) return { ok: false, why: '无法聚焦搜索框' }
	await s.insertText(dyMusic)

	// 等回读，fallback 用 native value setter
	await sleep(400)
	const readBack = await s.evalJs(`document.querySelector('input[placeholder*="搜索"]')?.value||''`)
	if (!readBack || !readBack.includes(dyMusic.slice(0, 3))) {
		// fallback：set native value + dispatchEvent('input')
		await s.evalJs(
			`(()=>{const el=document.querySelector('input[placeholder*="搜索"]');if(!el)return;` +
			`const nv=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');` +
			`nv.set.call(el,${JSON.stringify(dyMusic)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
		)
	}

	// 等搜索结果（2026-11-02 实测真实 class：面板 .music-selector-container-xxx，
	// 结果容器 .music-collection-container-xxx，单首卡片 .card-container-xxx）
	const CARD = `[class*="music-collection-container"] [class*="card-container"]`
	const hasResults = await s.waitFor(`!!document.querySelector(${JSON.stringify(CARD)})`, {
		timeout: 15000,
		interval: 600,
	})
	if (!hasResults) return { ok: false, why: '音乐搜索无结果' }

	// 点第一条 —— 必须真鼠标。el.click() 和合成 PointerEvent 在这页都开不了
	// （2026-11-02 三种方式对照实测，只有 Input.dispatchMouseEvent 有效）。
	const cardPt = await s.evalJs(
		`(()=>{const el=document.querySelector(${JSON.stringify(CARD)});if(!el)return null;` +
		`el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();` +
		`return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`,
	)
	if (!cardPt) return { ok: false, why: '音乐结果项没拿到坐标' }
	await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cardPt.x, y: cardPt.y, button: 'none' })
	await sleep(400)
	await s.clickAt(cardPt.x, cardPt.y)
	await sleep(1500)

	// 等「使用」按钮（悬停后才出现，所以先 hover 再找）
	const USE = `(()=>{
		const btn=[...document.querySelectorAll('button,div,span')]
			.filter(el=>/^(使用|使用该音乐)$/.test((el.innerText||el.textContent||'').trim()))
			.map(el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),h:Math.round(r.height)};})
			.filter(p=>p.w>20&&p.h>10);
		return btn.length?btn[0]:null;
	})()`
	let usePt = await s.waitFor(USE, { timeout: 4000, interval: 400 })
	if (!usePt) {
		await s.clickAt(cardPt.x, cardPt.y) // 再点一次，很多卡片是「点一下出按钮」
		await sleep(1200)
		usePt = await s.waitFor(USE, { timeout: 5000, interval: 400 })
	}
	if (usePt) {
		await s.clickAt(usePt.x, usePt.y)
		await sleep(1500)
	}

	await s.pressKey('Escape')
	await sleep(800)

	// 关 panel（等它消失，褪不掉就点关闭按钮）
	const PANEL = `[class*="music-selector-container"]`
	const panelClosed = await s.waitFor(`!document.querySelector(${JSON.stringify(PANEL)})`, { timeout: 3000 })
	if (!panelClosed) {
		await s.evalJs(
			`(()=>{const el=document.querySelector('[class*="music-selector-container"] [class*="close"]');if(el)el.click();})()`,
		)
		await sleep(800)
	}

	// 读 chip —— 只信 chip 换了，不信 panel 关了
	const chip = await s.evalJs(
		`document.querySelector('[class*="music-text"],[class*="music-binder"]')?.textContent?.trim()||''`,
	)
	const changed = !!chip && !/创作的原声/.test(chip)
	return { ok: changed, chip, why: changed ? undefined : '音乐 chip 未变化，可能未成功选中' }
}

/**
 * 把还开着的弹层关掉（Esc 最多按 3 次）。
 *
 * ⚠️ 为什么必须有这个：封面对话框一旦没关干净，它会**盖住整页**，
 * 后面 stepWho / stepDeclare 的眼和手全部落在弹层上 →
 * 报「未能选中「仅自己可见」」「声明弹层里没有…」，看着像那两个功能坏了，
 * 其实只是被一层挡着（2026-11-02 实测踩到，级联三个 step 全红）。
 *
 * @param {import('./publish-cdp.mjs').CdpSession} s
 * @param {number} [tries=3]
 * @returns {Promise<boolean>} 全关掉了返回 true
 */
async function _clearModals(s, tries = 3) {
	const stillOpen = `!![...document.querySelectorAll('[class*="dy-creator-content-modal"],[class*="semi-modal"]')]
		.find(el=>{const r=el.getBoundingClientRect();return r.width>200&&r.height>150&&el.offsetParent!==null;})`
	for (let i = 0; i < tries; i++) {
		if (!(await s.evalJs(stillOpen))) return true
		await s.pressKey('Escape')
		await sleep(700)
	}
	return !(await s.evalJs(stillOpen))
}

/**
 * 设置封面（COVER）。
 * ⚠️ panelOpen 必须检查真实 dialog 元素，不能只检测文字（2026-10-30 false failure）。
 *
 * @param {import('./publish-cdp.mjs').CdpSession} s
 * @param {{ coverPath: string }} params
 * @returns {Promise<{ok:boolean, srcChanged?:boolean, why?:string}>}
 */
export async function stepCover(s, { coverPath }) {
	// 先把上一轮残留的弹层清掉，否则入口点不到
	await _clearModals(s)
	// 封面弹层（2026-11-02 实测）：点对了入口会出 `dy-creator-content-modal`（1122×658），
	// 塞图之后还会再叠一层 `semi-modal`（裁剪）。两个都得关掉才算成。
	const MODAL = `(()=>{
		const all=[...document.querySelectorAll('[class*="dy-creator-content-modal"],[class*="semi-modal"]')]
			.filter(el=>{const r=el.getBoundingClientRect();return r.width>200&&r.height>150&&el.offsetParent!==null;});
		return all.length?all[all.length-1]:null;
	})()`

	const coverSrcExpr =
		`Array.from(document.querySelectorAll('img')).find(el=>` +
		`/creator-media|tos-cn-i-/.test(el.src)&&el.getBoundingClientRect().width>60)?.src||''`

	// 「横/竖双封面缺失」这个提示在页面上，封面设好了它就消失 —— 最可靠的判据
	const missingExpr = `/横\\/竖双封面缺失/.test(document.body.innerText||'')`

	const srcBefore = await s.evalJs(coverSrcExpr)
	// 先把「一开始有没有这个提示」记下来：没有提示的页面（图文）只能靠 srcChanged 判
	const missingBefore = await s.evalJs(missingExpr)

	// ① 真入口：coverControl 里的 .cover-xxx。
	// ⚠️ 点标题「设置封面」(.title-dS7kae / .title-content-oaqcSp) 是**没反应**的，
	//    2026-11-02 实测：点完按钮列表一模一样、弹层不出现，白等 20 秒。
	const entry = await s.waitFor(
		`(()=>{
			const el=document.querySelector('[class*="coverControl"] [class*="cover-"]');
			if(!el) return null;
			el.scrollIntoView({block:'center'});
			const r=el.getBoundingClientRect();
			if(r.width<20||r.height<20) return null;
			return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
		})()`,
		{ timeout: 20000, interval: 800 },
	)
	if (!entry) return { ok: false, why: '找不到封面入口（coverControl 里的 .cover-）' }

	await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: entry.x, y: entry.y, button: 'none' })
	await sleep(400)
	await s.clickAt(entry.x, entry.y)

	// ② 等弹层出现（判据是元素，不是文字）
	const modalOpen = await s.waitFor(`!!(${MODAL})`, { timeout: 15000, interval: 500 })
	if (!modalOpen) return { ok: false, why: '点了封面入口但弹层没出现' }
	await sleep(800)

	// ③ 塞图：弹层里会新长出 `input.semi-upload-hidden-input`（accept 含 image）。
	//    取**最后一个**——前面几个是页面常驻的（AI 推荐封面也用它们）。
	let fileNodeId = null
	for (let i = 0; i < 10 && !fileNodeId; i++) {
		const doc = await s.send('DOM.getDocument', { depth: -1, pierce: true })
		const inputs = await s.send('DOM.querySelectorAll', {
			nodeId: doc.root.nodeId,
			selector: 'input[type=file]',
		})
		const cands = []
		for (const nodeId of inputs.nodeIds ?? []) {
			const desc = await s.send('DOM.describeNode', { nodeId })
			const attrs = desc.node?.attributes ?? []
			const cls = attrs[attrs.indexOf('class') + 1] || ''
			const accept = attrs[attrs.indexOf('accept') + 1] || ''
			if (/image/i.test(accept) && /semi-upload-hidden-input/.test(cls)) cands.push(nodeId)
		}
		if (cands.length) fileNodeId = cands[cands.length - 1]
		else await sleep(800)
	}
	if (!fileNodeId) return { ok: false, why: '弹层里没找到封面上传的 file input' }

	await s.send('DOM.setFileInputFiles', { nodeId: fileNodeId, files: [coverPath] })
	await sleep(3000)

	// ④ 点「完成」。
	// ⚠️ 2026-11-02 实测：封面编辑器的按钮**就在主文档里**（`.buttons-BoCvr4` 里的
	//    `完成` (1065,705) / `设置横封面` (1187,705)），但它不在任何
	//    `[class*=modal]` / `[class*=semi-modal]` 容器里 —— 之前把搜索范围锁在弹层 root 里，
	//    所以永远找不到「完成」，白报「封面上传后未见完成按钮」。
	//    现在改成**全文档按文字找**，只要可见就点。
	const clickByText = async (re, timeout = 12000) => {
		const expr = `(()=>{
			const bs=[...document.querySelectorAll('button,[role="button"],[class*="button"]')]
				.filter(el=>${re}.test((el.innerText||el.textContent||'').trim())&&!el.disabled);
			for (const el of bs) {
				const r=el.getBoundingClientRect();
				if (r.width>40&&r.height>20&&r.bottom>0&&r.top<innerHeight&&el.offsetParent!==null) {
					return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
				}
			}
			return null;
		})()`
		const pt = await s.waitFor(expr, { timeout, interval: 500 })
		if (!pt) return false
		await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none' })
		await sleep(250)
		await s.clickAt(pt.x, pt.y)
		await sleep(1500)
		return true
	}

	await clickByText(/^完成$/, 15000)
	// 编辑页可能还要再确认一次（裁剪/预览确认）
	await sleep(800)
	await clickByText(/^完成$|^确定$|^保存$/, 5000)

	// ⑤ 等面板自己收。
	// ⚠️ 不要急着 Esc —— 2026-11-02 实测：点完「完成」后编辑面板是自己淡出的，
	//    这时候补一个 Escape 会**把刚设好的封面取消掉**（页面又变回「横/竖双封面缺失」）。
	//    只有等了 6 秒还不收，才说明真卡住了，那时再 Esc。
	const closed = await s.waitFor(`!(${MODAL})`, { timeout: 6000, interval: 500 })
	if (!closed) await _clearModals(s, 2)
	await sleep(1500)

	const srcAfter = await s.evalJs(coverSrcExpr)
	const stillMissing = await s.evalJs(missingExpr)
	const srcChanged = !!srcAfter && srcAfter !== srcBefore

	// 判据只认一件事：页面上「横/竖双封面缺失」从「在」变成「不在」。
	// ⚠️ 绝不让 srcChanged 参与判定 —— 图塞进去后预览/推荐位的 src 会变，
	//    可双封面依旧缺失，那就是假 true（2026-11-02 实测）。
	// 页面本来就没这句提示（拿不到判据）→ 老实报 false + uncertain，不假装成功。
	const ok = !stillMissing && !!missingBefore
	const why = ok
		? undefined
		: !missingBefore
			? '没法判定封面（页面上没有「横/竖双封面缺失」这条判据）'
			: '封面没设成（页面上「横/竖双封面缺失」还在）'
	return {
		ok,
		srcChanged,
		hintBefore: !!missingBefore,
		uncertain: !missingBefore,
		stillMissing: !!stillMissing,
		why,
	}
}

/**
 * 设置「谁可以看」。
 * @param {import('./publish-cdp.mjs').CdpSession} s
 * @param {{ who: string }} params  who 是页面原话（公开/好友可见/仅自己）
 * @returns {Promise<{ok:boolean, why?:string}>}
 */
export async function stepWho(s, { who }) {
	await _clearModals(s)
	const ok = await _pickRadio(s, who)
	return ok ? { ok: true } : { ok: false, why: `未能选中「${who}」` }
}

/**
 * 设置定时发布。
 * @param {import('./publish-cdp.mjs').CdpSession} s
 * @param {{ at: string }} params  at 格式 "2026-11-05 20:00"
 * @returns {Promise<{ok:boolean, got?:string, why?:string}>}
 */
export async function stepSchedule(s, { at }) {
	await _clearModals(s)
	const picked = await _pickRadio(s, '定时发布')
	if (!picked) return { ok: false, why: '未能选中「定时发布」单选' }

	// 等日期输入框
	const inputReady = await s.waitFor(
		`!!Array.from(document.querySelectorAll('input')).find(el=>el.placeholder&&/日期和时间/.test(el.placeholder))`,
		{ timeout: 10000 },
	)
	if (!inputReady) return { ok: false, why: '定时发布的日期输入框未出现' }

	const inputEl = await s.evalJs(
		`Array.from(document.querySelectorAll('input')).find(el=>el.placeholder&&/日期和时间/.test(el.placeholder))`,
	)
	if (!inputEl) return { ok: false, why: '找不到日期输入框元素' }

	// 聚焦+插入时间
	await s.evalJs(
		`(()=>{const el=Array.from(document.querySelectorAll('input')).find(el=>el.placeholder&&/日期和时间/.test(el.placeholder));if(el)el.focus();})()`,
	)
	await s.clearFocused()
	await s.insertText(at)
	await s.pressKey('Enter')

	// 等回读
	const deadline = Date.now() + 8000
	let got = ''
	while (Date.now() < deadline) {
		got = await s.evalJs(
			`Array.from(document.querySelectorAll('input')).find(el=>el.placeholder&&/日期和时间/.test(el.placeholder))?.value||''`,
		)
		if (got && got.includes(at.slice(0, 10))) return { ok: true, got }
		await sleep(500)
	}
	return { ok: false, got, why: `定时时间回读「${got}」，期望含「${at}」` }
}

/**
 * 设置自主声明。
 * @param {import('./publish-cdp.mjs').CdpSession} s
 * @param {{ declare: string }} params  declare 是 DECLARE_MAP 里的页面原话
 * @returns {Promise<{ok:boolean, why?:string}>}
 */
export async function stepDeclare(s, { declare }) {
	// 先清掉残留弹层（封面没关干净时，这里会误报「弹层里没有这个选项」）
	await _clearModals(s)
	// ⚠️ 入口不是「自主声明」按钮，是那个 class 带 selectText 的选择框
	//    （第一次显示「请选择自主声明」，设过就变成选项名）。
	//    重写时曾经改成「找 button 文字===自主声明 → 等 modal → 找 [class*=option] → 点确定 →
	//    回读 [class*=declare-selected]」，那三个 class 名全是猜的，页面上不存在 → 必然失败。
	//    这里恢复 2026-10-31 真跑通的那套。
	const want = declare

	/** 弹层现在是开着的吗（只看宽度 >100 且写着「声明类型」的） */
	const modalOpenExpr = `(()=>[...document.querySelectorAll('[class*=modal],[role=dialog]')].some(e=>e.getBoundingClientRect().width>100&&/声明类型/.test(e.innerText||'')))()`

	// ⚠️ 已经在开着就别再点：点 selectText 是**开关**，开着的点一下会把它关掉，
	//    然后等 8 秒找不到选项，报「弹层里没有这个选项」——看着像选不中，其实是自己关掉的。
	//    （2026-11-02 踩过：上一次失败留下了开着的弹层，下一次必失败。）
	const alreadyOpen = await s.evalJs(modalOpenExpr)
	if (!alreadyOpen) {
		const open = await s.evalJs(`(()=>{
			const el=document.querySelector('[class*=selectText]');
			if(!el)return null;
			el.scrollIntoView({block:'center'});
			const r=el.getBoundingClientRect();
			if(r.width<10)return null;
			return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
		})()`)
		if (!open || typeof open.x !== 'number') return { ok: false, why: '找不到「自主声明」的选择框' }
		await s.clickAt(open.x, open.y)
		// 点一下没开就再点一下：真机上有时候第一次点击被弹层/预览挡住（点了没反应），
		// 有时候又因为上一次遗留的「开着」状态被点成关闭。两种都靠这一下兜住。
		await sleep(1200)
		if (!(await s.evalJs(modalOpenExpr))) {
			await s.clickAt(open.x, open.y)
			await sleep(800)
		}
	}

	// 弹层：取最上层那个宽度 >100 的 modal，且里面写着「声明类型」
	const option = await s.waitFor(
		`(()=>{
			const ds=[...document.querySelectorAll('[class*=modal],[role=dialog]')].filter(e=>e.getBoundingClientRect().width>100);
			const root=ds[ds.length-1];
			if(!root||!/声明类型/.test(root.innerText||''))return null;
			const el=[...root.querySelectorAll('label,div,span')].find(e=>(e.innerText||'').replace(/\\s+/g,' ').trim()===${JSON.stringify(want)});
			if(!el)return null;
			const r=el.getBoundingClientRect();
			return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
		})()`,
		{ timeout: 8000, interval: 400 },
	)
	if (!option || typeof option.x !== 'number') {
		// 收尾：把弹层关掉，别给下一次留一个「开着」的状态
		await s.pressKey('Escape', 'Escape').catch(() => null)
		return { ok: false, why: `声明弹层里没有「${want}」这个选项` }
	}

	await s.clickAt(option.x, option.y)

	const okBtn = await s.evalJs(`(()=>{
		const ds=[...document.querySelectorAll('[class*=modal],[role=dialog]')].filter(e=>e.getBoundingClientRect().width>100);
		const root=ds[ds.length-1];
		const b=root&&[...root.querySelectorAll('button')].find(e=>(e.innerText||'').trim()==='确定');
		if(!b)return null;
		const r=b.getBoundingClientRect();
		return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
	})()`)
	if (!okBtn || typeof okBtn.x !== 'number') return { ok: false, why: '声明弹层里找不到「确定」按钮' }

	await s.clickAt(okBtn.x, okBtn.y)

	// 回读：框上的字变成 want，且弹层已关
	const got = await s.waitFor(
		`(()=>{
			const el=document.querySelector('[class*=selectText]');
			const t=el?(el.innerText||'').replace(/\\s+/g,' ').trim():'';
			const open=[...document.querySelectorAll('[class*=modal],[role=dialog]')].some(e=>e.getBoundingClientRect().width>100&&/声明类型/.test(e.innerText||''));
			return (!open&&t===${JSON.stringify(want)})?t:null;
		})()`,
		{ timeout: 6000, interval: 300 },
	)
	if (!got) return { ok: false, why: '点了确定，但框上回读不到「' + want + '」' }
	return { ok: true, read: got }
}

/**
 * 存草稿（--draft 流程）。
 * ⚠️ 草稿不会出现在内容管理页；成功表现是页面出现「未发布的图文/视频」提示，
 *    或跳回 /content/upload。
 *
 * @param {import('./publish-cdp.mjs').CdpSession} s
 * @returns {Promise<{ok:boolean, why?:string}>}
 */
export async function stepDraft(s) {
	// 找「暂存离开」按钮
	const btnReady = await s.waitFor(
		`!!Array.from(document.querySelectorAll('button,span')).find(el=>/暂存离开/.test(el.textContent))`,
		{ timeout: 15000, interval: 500 },
	)
	if (!btnReady) return { ok: false, why: '找不到「暂存离开」按钮' }

	await s.evalJs(
		`(()=>{const el=Array.from(document.querySelectorAll('button,span')).find(el=>/暂存离开/.test(el.textContent));if(el)el.click();})()`,
	)
	await sleep(600)

	// 可能有确认弹窗
	const hasConfirm = await s.evalJs(
		`!!Array.from(document.querySelectorAll('button')).find(el=>/确认|保存/.test(el.textContent)&&!el.textContent.includes('取消'))`,
	)
	if (hasConfirm) {
		await s.evalJs(
			`(()=>{const el=Array.from(document.querySelectorAll('button')).find(el=>/确认|保存/.test(el.textContent)&&!el.textContent.includes('取消'));if(el)el.click();})()`,
		)
		await sleep(600)
	}

	// 等成功信号：提示文字 或 跳回 upload
	const success = await s.waitFor(
		`/未发布的(图文|视频)|是否继续编辑/.test(document.body.innerText)||` +
		`/\\/content\\/upload/.test(location.pathname)`,
		{ timeout: 15000, interval: 500 },
	)
	return { ok: !!success, why: success ? undefined : '草稿保存后未见预期页面' }
}

/**
 * 点击发布按钮，等待结果。
 *
 * 三种结果：
 *   - ok:true, published:true  — 发布成功（跳转或出现成功文案）
 *   - ok:false, abnormal:true  — 点了按钮但没有成功或失败的证据（绝对不能自动重试！）
 *   - ok:false, captcha:true   — 遇到验证码（立即停止，等人处理）
 *   - ok:false, why            — 明确失败
 *
 * @param {import('./publish-cdp.mjs').CdpSession} s
 * @returns {Promise<{ok:boolean, published?:boolean, abnormal?:boolean, captcha?:boolean, why?:string}>}
 */
export async function stepPublish(s) {
	// 等「发布」按钮可用（最多 300s）
	const btnReady = await s.waitFor(
		`(()=>{` +
		`const uploading=/上传中|处理中|转码中/.test(document.body.innerText);` +
		`if(uploading)return false;` +
		`const btn=Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='发布');` +
		`return btn&&!btn.disabled;` +
		`})()`,
		{ timeout: 300000, interval: 1500 },
	)
	if (!btnReady) return { ok: false, why: '等待「发布」按钮就绪超时（300s）' }

	// 12 次重试：确保按钮在视口内，elementFromPoint 验证位置
	let btnPos = null
	for (let i = 0; i < 12; i++) {
		const rect = await s.evalJs(
			`(()=>{const btn=Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='发布');if(!btn)return null;return btn.getBoundingClientRect();})()`,
		)
		if (!rect) continue
		if (rect.top < 8 || rect.bottom > (await s.evalJs('window.innerHeight')) - 8) {
			await s.evalJs(
				`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='发布')?.scrollIntoView({block:'center'})`,
			)
			await sleep(700)
			continue
		}
		await sleep(250)
		const cx = rect.x + rect.width / 2
		const cy = rect.y + rect.height / 2
		const atPoint = await s.evalJs(`document.elementFromPoint(${cx},${cy})?.textContent?.trim()`)
		if (atPoint === '发布') {
			btnPos = { x: cx, y: cy }
			break
		}
	}
	if (!btnPos) return { ok: false, why: '「发布」按钮位置无法验证（elementFromPoint 未命中）' }

	await s.clickAt(btnPos.x, btnPos.y)

	// 90s 轮询结果
	const deadline = Date.now() + 90000
	while (Date.now() < deadline) {
		await sleep(1000)
		const body = await s.evalJs('document.body.innerText')
		if (!body) continue

		if (/发布成功|已发布|视频审核中/.test(body)) return { ok: true, published: true }
		if (/\/creator-micro\/content\/manage/.test(await s.evalJs('location.pathname'))) {
			return { ok: true, published: true }
		}
		if (/验证码|人机验证|滑动验证/.test(body)) {
			return { ok: false, captcha: true, why: '遇到验证码，需要人工处理' }
		}
		if (/发布失败|上传失败|发布错误/.test(body)) {
			return { ok: false, why: '页面报发布失败' }
		}
	}

	// 超时但无明确结论 —— abnormal，绝对不能重试
	return { ok: false, abnormal: true, why: '点击发布后 90s 内无成功或失败证据，请人工确认是否真正发布' }
}

// ── 内部工具 ──────────────────────────────────────────────────────────────────

/**
 * 找 label 文字精确等于 text（去空白后比较），用**真鼠标**点它，再读回选中状态。
 *
 * ⚠️ 三个都踩过（2026-10-28 / 11-01）：
 *   1. 必须用 Input.dispatchMouseEvent 真点，`el.click()` 抖音的选项框不认，
 *      页面一动不动、看着像点了没反应。
 *   2. 比较要**去掉所有空白**再比：页面上是 `仅自己可见`，源码里可能带换行。
 *   3. 选中状态看 `data-checked="true"` 或内部 input.checked —— 只看 aria-checked 会漏。
 *
 * @param {import('./publish-cdp.mjs').CdpSession} s
 * @param {string} text 页面上的原话（例：公开 / 仅自己可见 / 定时发布）
 * @returns {Promise<boolean>}
 */
async function _pickRadio(s, text) {
	const want = String(text).replace(/\s+/g, '')
	const pt = await s.evalJs(`(()=>{
		const el=[...document.querySelectorAll('label,div,span')]
			.find(e=>(e.innerText||'').replace(/\\s+/g,'')===${JSON.stringify(want)});
		if(!el)return null;
		el.scrollIntoView({block:'center'});
		const r=el.getBoundingClientRect();
		if(r.width<5||r.height<5)return null;
		return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
	})()`)
	if (!pt || typeof pt.x !== 'number') return false

	await s.clickAt(pt.x, pt.y)

	const deadline = Date.now() + 4000
	while (Date.now() < deadline) {
		const on = await s.evalJs(`(()=>{
			const el=[...document.querySelectorAll('label')]
				.find(e=>(e.innerText||'').replace(/\\s+/g,'')===${JSON.stringify(want)});
			if(!el)return false;
			const inp=el.querySelector('input');
			return el.getAttribute('data-checked')==='true'||Boolean(inp&&inp.checked);
		})()`)
		if (on) return true
		await sleep(200)
	}
	return false
}


