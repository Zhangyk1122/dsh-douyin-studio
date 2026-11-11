import test from 'node:test'
import assert from 'node:assert/strict'

import { buildQuery, cleanKeyword, normalizeItem, pageUsable, SEARCH_PATH } from '../lib/feedapi.mjs'

test('cleanKeyword 只做最小清洗，不猜接口规则', () => {
	assert.equal(cleanKeyword('  猫咪  '), '猫咪')
	assert.equal(cleanKeyword('a\nb'), 'a b')
	assert.equal(cleanKeyword(null), '')
	assert.equal(cleanKeyword('x'.repeat(80)).length, 50)
})

test('buildQuery 带齐 web 端必需参数', () => {
	const q = new URLSearchParams(buildQuery({ keyword: '猫咪', count: 10 }))
	assert.equal(q.get('keyword'), '猫咪')
	assert.equal(q.get('device_platform'), 'webapp')
	assert.equal(q.get('aid'), '6383')
	assert.equal(q.get('search_channel'), 'aweme_general')
	assert.equal(q.get('count'), '10')
	assert.equal(q.get('offset'), '0')
	assert.ok(SEARCH_PATH.startsWith('/aweme/'))
})

test('buildQuery 把 count 夹在 1–20，offset 不为负', () => {
	assert.equal(new URLSearchParams(buildQuery({ count: 99 })).get('count'), '20')
	assert.equal(new URLSearchParams(buildQuery({ count: 0 })).get('count'), '10')
	assert.equal(new URLSearchParams(buildQuery({ offset: -5 })).get('offset'), '0')
	assert.equal(new URLSearchParams(buildQuery({ sort: 1 })).get('sort_type'), '1')
	assert.equal(new URLSearchParams(buildQuery({})).get('sort_type'), null)
})

test('normalizeItem 把接口字段搬到 toCandidate 认的形状', () => {
	const it = {
		aweme_info: {
			aweme_id: '7500000000000000001',
			desc: '一只猫',
			author: { nickname: '猫主', sec_uid: 'MS4wLjABAAAA' },
			statistics: { digg_count: 12, comment_count: 3, share_count: 1 },
			video: { duration: 21100, cover: { url_list: ['https://x/cover.jpg'] } },
			text_extra: [{ hashtag_name: '猫' }, { hashtag_name: '' }, { hashtag_name: '萌宠' }],
			create_time: 1760000000,
		},
	}
	const n = normalizeItem(it)
	assert.equal(n.aweme_id, '7500000000000000001')
	assert.equal(n.author.nickname, '猫主')
	assert.equal(n.author.sec_uid, 'MS4wLjABAAAA')
	assert.equal(n.duration_sec, 21)
	assert.equal(n.digg, 12)
	assert.equal(n.comment, 3)
	assert.equal(n.share, 1)
	assert.deepEqual(n.tags, ['猫', '萌宠'])
	assert.equal(n.cover, 'https://x/cover.jpg')
	assert.equal(n.create_date, new Date(1760000000 * 1000).toISOString())
})

test('normalizeItem 对空壳不抛异常', () => {
	const n = normalizeItem(null)
	assert.equal(n.aweme_id, '')
	assert.equal(n.digg, 0)
	assert.equal(n.duration_sec, 0)
	assert.deepEqual(n.tags, [])
})

test('pageUsable：全重复/全空都算到底', () => {
	const seen = new Set(['1'])
	assert.equal(pageUsable([{ aweme_id: '2' }], seen), true)
	assert.equal(pageUsable([{ aweme_id: '1' }], seen), false)
	assert.equal(pageUsable([], new Set()), false)
	assert.equal(pageUsable([{ aweme_id: '' }], new Set()), false)
})
