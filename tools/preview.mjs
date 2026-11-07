/**
 * tools/preview.mjs —— 预览沙盘的静态服务（可复用）
 * ============================================================================
 * tmp/preview/index.html 里的假后端是拦截 fetch 的，所以服务器只要把三样东西
 * 送对就行：页面本身、/vendor/react*.js、/client.js。之前那次渲染检查失败，
 * 就是临时服务器没映射 /vendor —— 与产品代码无关，但验证工具坏了等于没验证。
 *
 *   node tools/preview.mjs            前台跑，Ctrl+C 停
 *   import { startPreview } from './preview.mjs'   // 给 preview-check.mjs 用
 * ============================================================================
 */
import { createServer } from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
}

/** @param {number} port @returns {Promise<import('node:http').Server>} */
export function startPreview(port = 52999) {
	const srv = createServer((req, res) => {
		const u = decodeURIComponent(String(req.url || '/').split('?')[0])
		let file
		if (u === '/' || u === '/index.html') file = join(ROOT, 'tmp', 'preview', 'index.html')
		else if (u.startsWith('/vendor/')) file = join(ROOT, 'tmp', 'preview', u.slice(1))
		else if (u === '/client.js') file = join(ROOT, 'client.js')
		else file = join(ROOT, 'tmp', 'preview', u.replace(/^\/+/, ''))
		try {
			if (statSync(file).isDirectory()) file = join(file, 'index.html')
			res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
			res.end(readFileSync(file))
		} catch {
			res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
			res.end('404 ' + u)
		}
	})
	return new Promise((resolve, reject) => {
		srv.once('error', reject)
		srv.listen(port, '127.0.0.1', () => resolve(srv))
	})
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const port = Number(process.argv[2]) || 52999
	startPreview(port).then(() => console.log('预览：http://127.0.0.1:' + port + '/'))
}
