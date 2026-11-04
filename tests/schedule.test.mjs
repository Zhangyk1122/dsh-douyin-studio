import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slots, dayKey, dueAt, SCAN_MAX_ROUNDS } from '../lib/schedule.mjs'

test('rounds=0 就是不刷，别偷偷刷', () => {
  assert.deepEqual(slots(0, 9, 22), [])
  assert.deepEqual(slots(-3, 9, 22), [])
  assert.deepEqual(slots(NaN, 9, 22), [])
})

test('三个点均匀落在 9–22 之间，且不卡整点', () => {
  const s = slots(3, 9, 22)
  assert.equal(s.length, 3)
  s.forEach((x, i) => {
    assert.ok(x > (9 + (13 * i) / 3) * 3600 - 60)
    assert.ok(x < (9 + (13 * (i + 1)) / 3) * 3600 + 60)
    assert.notEqual(x % 3600, 0)
  })
  assert.deepEqual(s, [...s].sort((a, b) => a - b))
})

test('轮数被上限和窗口长度卡住', () => {
  assert.equal(slots(99, 9, 10).length, Math.min(99, SCAN_MAX_ROUNDS, 4))
  assert.equal(slots(5, 9, 23).length, 5)
})

test('窗口写反了也不会吐出越界的点', () => {
  const s = slots(2, 22, 9)
  assert.equal(s.length, 2)
  s.forEach((x) => assert.ok(x >= 22 * 3600 && x <= 24 * 3600))
})

test('dayKey 用本地时间，跨零点换天', () => {
  assert.equal(dayKey(new Date(2026, 10, 4, 23, 59, 59)), '2026-11-04')
  assert.equal(dayKey(new Date(2026, 10, 5, 0, 0, 1)), '2026-11-05')
  assert.equal(dayKey('nope'), '')
})

test('还没到第一个点：不刷，但知道下一轮还有多久', () => {
  const plan = { rounds: 3, from: 9, to: 22 }
  const now = new Date(2026, 10, 4, 8, 0, 0)
  const r = dueAt(now, plan, 0)
  assert.equal(r.due, false)
  assert.ok(r.next > 3000)
})

test('过了第一个点：该刷了，下标 0', () => {
  const plan = { rounds: 3, from: 9, to: 22 }
  const now = new Date(2026, 10, 4, 12, 0, 0)
  const r = dueAt(now, plan, 0)
  assert.equal(r.due, true)
  assert.equal(r.index, 0)
})

test('已经刷过一轮、又过了第二个点：取最后一个没刷的（但只能在窗口内补）', () => {
  const plan = { rounds: 3, from: 9, to: 22 }
  /* 窗口内补刷：22:10 还在 30 分钟宽限里，最后一轮该补 */
  const inWin = dueAt(new Date(2026, 10, 4, 22, 10, 0), plan, 1)
  assert.equal(inWin.due, true)
  assert.equal(inWin.index, 2)
  /* 窗口外不补：设了「到 22 点结束」，23:30 就不该再刷 —— 这是设置，不是建议 */
  const late = dueAt(new Date(2026, 10, 4, 23, 30, 0), plan, 1)
  assert.equal(late.due, false)
})

test('今天的轮次刷完了：不再催', () => {
  const plan = { rounds: 2, from: 9, to: 22 }
  const now = new Date(2026, 10, 4, 23, 0, 0)
  assert.equal(dueAt(now, plan, 2).due, false)
  assert.equal(dueAt(now, plan, 99).due, false)
})

test('关掉的时候永远不 due', () => {
  const now = new Date(2026, 10, 4, 12, 0, 0)
  assert.equal(dueAt(now, { rounds: 0, from: 9, to: 22 }, 0).due, false)
  assert.equal(dueAt(now, null, 0).due, false)
  assert.equal(dueAt(new Date('bad'), { rounds: 3, from: 9, to: 22 }, 0).due, false)
})

test('脏 done 当 0 处理，不会因为存盘坏了就整天不刷', () => {
  const plan = { rounds: 1, from: 9, to: 22 }
  const now = new Date(2026, 10, 4, 16, 0, 0) // 那一轮在 15:30，已经过了
  assert.equal(dueAt(now, plan, 'x').due, true)
  assert.equal(dueAt(now, plan, -5).due, true)
})
