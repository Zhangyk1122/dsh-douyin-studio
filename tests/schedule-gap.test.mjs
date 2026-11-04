import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slots } from '../lib/schedule.mjs'

test('两轮之间隔多久：按每轮间隔排，撞到结束时间就收手', () => {
  const s = slots(3, 9, 22, 120)
  assert.equal(s.length, 3)
  const gap = s[1] - s[0]
  assert.equal(gap, 120 * 60)
  assert.ok(s[0] >= 9 * 3600 && s[0] < 9 * 3600 + 3600)
})

test('间隔太大就刷不满轮数 —— 不许跑到结束时间以后', () => {
  const s = slots(5, 9, 12, 120)
  assert.ok(s.length >= 1 && s.length < 5)
  s.forEach((x) => assert.ok(x < 12 * 3600))
})

test('间隔 0 退回均匀铺开', () => {
  const a = slots(3, 9, 22, 0)
  const b = slots(3, 9, 22)
  assert.deepEqual(a, b)
})
