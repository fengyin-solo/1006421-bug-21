import assert from 'node:assert'

// 用一个内存版 localStorage 模拟浏览器。
class MemoryStorage {
  constructor() { this.map = new Map() }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) {
    const value = String(v)
    // 模拟提交时一次性失败：仅准备脚本的第一次整库提交报错，回滚写入仍可成功。
    if (globalThis.__FAIL_WRITE && k === 'waste-to-energy-plant:entries') {
      globalThis.__FAIL_WRITE = false
      throw new Error('QuotaExceededError')
    }
    this.map.set(k, value)
  }
  removeItem(k) { this.map.delete(k) }
}

globalThis.window = { localStorage: new MemoryStorage() }

const { prepareDemoData, restoreDemoBackup, DEMO_VERSION } = await import('../src/data/demo-seed.ts')
const store = await import('../src/data/local-store.ts')
const { SEED_ROWS } = await import('../src/data/seed.ts')
const service = await import('../src/api/local-service.ts')

function dump(title) {
  const s = store.allRows()
  console.log(`\n== ${title} ==`)
  console.log('incinerator:', s.incinerator.length, 'equipcheck:', s.equipcheck.length)
}

// 首跑
let r1 = prepareDemoData()
assert.equal(r1.ok, true, '首跑应成功')
assert.equal(r1.incineratorCount, 8)
assert.equal(r1.equipcheckCount, 3, '运行中2+故障1 = 3 条待点检')
assert.equal(r1.reused, false)
dump('首跑后')

// 时序校验
const list1 = service.listEntries('incinerator').items
const stamps = list1.map((r) => Date.parse(r['记录时间']))
assert.ok(stamps.every((v, i) => i === 0 || v >= stamps[i - 1]), '炉次按时序排列')
assert.deepEqual(list1.map((r) => r.status), ['已停炉', '已停炉', '故障停炉', '已停炉', '已停炉', '运行中', '运行中', '待点火'])

// 点检待办：演示派生 3 条（种子自带 1 条待点检，共 4 条）
const pendingChecks = store.listRows('equipcheck').filter((r) => r.status === '待点检')
assert.equal(pendingChecks.length, 4)
const demoChecks = pendingChecks.filter((r) => String(r['点检编号']).startsWith('EQUI-INCI-'))
assert.equal(demoChecks.length, 3)
assert.ok(demoChecks.some((r) => String(r['点检部位']).includes('给料机卡阻')), '故障炉次点检结论应落到部位')
assert.ok(demoChecks.every((r) => String(r['点检编号']).startsWith('EQUI-INCI-')))

// 概览非零
const ov = service.loadOverview()
assert.ok(ov.cards.find((c) => c.label === '登记总量').value >= 8 + 3)
assert.ok(ov.cards.find((c) => c.label === '待处理').value > 0)

// 第二跑：去重，不翻倍
r1 = prepareDemoData()
assert.equal(r1.ok, true)
assert.equal(r1.reused, true, '第二跑应识别为已就绪')
assert.equal(store.listRows('incinerator').length, 8, '炉次不能翻倍')
assert.equal(store.listRows('equipcheck').length, SEED_ROWS.equipcheck.length + 3)
dump('第二跑后（应与首跑一致）')

// 模拟本地既有记录：手动加一条用户炉次和一条用户点检
const inci = store.listRows('incinerator')
store.saveRows('incinerator', [...inci, { id: 999, status: '待点火', pending: true, abnormal: false, '运行编号': 'INCI-USER-1', '炉膛温度': '常温', '炉膛负压': '0Pa', '给料速率': '0t/h', '运行班次': '甲班', '操作人员': '我', '记录时间': '2026-10-07 12:00', '炉况状态': '待点火' }])
const eqc = store.listRows('equipcheck')
store.saveRows('equipcheck', [...eqc, { id: 999, status: '待点检', pending: true, abnormal: false, '点检编号': 'EQUI-USER-1', '点检设备': '用户自建', '点检部位': 'x', '点检方法': 'x', '点检结果': 'x', '点检人员': 'x', '点检日期': '2026-10-07', '点检状态': '待点检' }])
r1 = prepareDemoData()
assert.equal(r1.ok, true)
const inci2 = store.listRows('incinerator')
assert.ok(inci2.some((r) => r['运行编号'] === 'INCI-USER-1'), '用户炉次保留')
assert.equal(inci2.length, 9, '8 演示 + 1 用户')
assert.ok(store.listRows('equipcheck').some((r) => r['点检编号'] === 'EQUI-USER-1'), '用户点检保留')
dump('兼容本地记录后')

// 旧占位炉次场景：在现有库上追加一条老占位数据
store.commitSnapshot({ ...store.allRows(), incinerator: [...store.listRows('incinerator'), { id: 998, status: '运行中', pending: true, abnormal: true, '运行编号': 'INCI-0001', '炉膛温度': '焚烧炉运行样例1', '炉膛负压': 'x', '给料速率': 'x', '运行班次': 'x', '操作人员': 'x', '记录时间': '2026-09-01', '炉况状态': 'x' }] })
// 清掉标记模拟老脚本遗留
window.localStorage.removeItem('waste-to-energy-plant:entries:demo-incinerator')
r1 = prepareDemoData()
assert.equal(r1.ok, true)
assert.ok(!store.listRows('incinerator').some((r) => String(r['炉膛温度']).includes('样例')), '老占位炉次被清退')
assert.equal(store.listRows('incinerator').length, 9, '占位清退后铺 8 演示，用户炉次仍在')
dump('清理老占位数据后')

// 状态流转：不允许跳级
const id = store.listRows('incinerator').find((r) => r['运行编号'] === 'INCI-20261007-01').id
let act = service.runAction('incinerator', id, '登记停炉')
assert.equal(act.ok, false, '待点火不能直接停炉')
assert.ok(act.message.includes('不允许跳级'))
act = service.runAction('incinerator', id, '上报故障')
assert.equal(act.ok, false, '待点火不能直接上报故障')
act = service.runAction('incinerator', id, '提交点火')
assert.equal(act.ok, true)
act = service.runAction('incinerator', id, '登记停炉')
assert.equal(act.ok, true, '运行中可以停炉')
assert.equal(service.runAction('incinerator', id, '提交点火').ok, false, '终态不能再流转')

// 故障路径：运行中→故障停炉→恢复运行
const faultId = store.listRows('incinerator').find((r) => r['运行编号'] === 'INCI-20261006-01').id
assert.equal(service.runAction('incinerator', faultId, '上报故障').ok, true)
assert.equal(service.runAction('incinerator', faultId, '恢复运行').ok, true)
assert.equal(service.runAction('incinerator', faultId, '提交点火').ok, false, '运行中不能重复点火')

// 详情读取
const detail = service.getEntry('incinerator', faultId)
assert.ok(detail && detail['运行编号'] === 'INCI-20261006-01')

// 写失败回滚
const before = JSON.stringify(store.listRows('incinerator').map((r) => r['运行编号']))
globalThis.__FAIL_WRITE = true
r1 = prepareDemoData()
globalThis.__FAIL_WRITE = false
assert.equal(r1.ok, false, '写失败应报错')
assert.equal(r1.restored, true, '应已回滚')
assert.equal(JSON.stringify(store.listRows('incinerator').map((r) => r['运行编号'])), before, '库内容回到准备前')
// 再试一次成功
r1 = prepareDemoData()
assert.equal(r1.ok, true, '回滚后应能再试一次')
assert.equal(store.listRows('incinerator').length, 9)
assert.equal(restoreDemoBackup(), true)

console.log('\n全部断言通过 ✔')
