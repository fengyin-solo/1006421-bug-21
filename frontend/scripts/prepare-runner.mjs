// 演示数据准备链路的场景验证器：由 verify-prepare.mjs 用 esbuild 打包后按场景逐个跑。
// 每个场景都是独立进程（模块缓存全新），STORAGE_FILE 模拟浏览器 localStorage，
// 跨场景复用同一个文件就等于「关掉浏览器再打开」。
import fs from 'node:fs'

import { listEntries, loadOverview, prepareDemoData, runAction } from '../src/api/local-service'
import { backupKey, listRows, saveRows, storageKey } from '../src/data/local-store'

const scenario = process.env.SCENARIO
const storageFile = process.env.STORAGE_FILE
if (!scenario || !storageFile) {
  console.error('需要 SCENARIO 与 STORAGE_FILE 两个环境变量')
  process.exit(2)
}

let data = {}
try {
  data = JSON.parse(fs.readFileSync(storageFile, 'utf8'))
} catch {
  data = {}
}
const persist = () => fs.writeFileSync(storageFile, JSON.stringify(data))
const MAIN_KEY = storageKey()
globalThis.window = {
  localStorage: {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => {
      // 注入中途失败：只拦「灌好演示数据」那一次整库写入（内容里带 INCI-0006），
      // 首次播种和备份回滚的写入放行，这样回滚才能成功、重试才有机会。
      if (
        process.env.FAIL_MAIN_WRITE === '1' &&
        key === MAIN_KEY &&
        String(value).includes('INCI-0006')
      ) {
        throw new Error('模拟 localStorage 写入失败')
      }
      data[key] = String(value)
      persist()
    },
    removeItem: (key) => {
      delete data[key]
      persist()
    },
  },
}

function check(condition, message) {
  if (!condition) {
    console.error(`FAIL [${scenario}] ${message}`)
    process.exit(1)
  }
}

const storedRaw = () => JSON.parse(fs.readFileSync(storageFile, 'utf8'))
const incinerator = () => listRows('incinerator')
const byNo = (no) => incinerator().find((row) => row['运行编号'] === no)

const scenarios = {
  // 首次准备：占位默认值 -> 按时序铺满，概览有数，覆盖前有备份
  first() {
    const before = incinerator()
    check(before.length === 3, `初始应有 3 条占位炉次，实际 ${before.length}`)
    check(
      before.every((row) => String(row['炉膛温度']).startsWith('焚烧炉运行样例')),
      '初始炉膛温度应停在占位默认值',
    )

    const result = prepareDemoData()
    check(result.ok, `首次准备应成功：${result.message}`)
    check(
      result.added === 4 && result.updated === 3 && result.removed === 0,
      `首次准备计数不符：${JSON.stringify(result)}`,
    )

    const rows = incinerator()
    check(rows.length === 6, `灌完应有 6 条炉次，实际 ${rows.length}`)
    const times = rows.map((row) => String(row['记录时间']))
    check(
      [...times].sort().every((time, index) => time === times[index]),
      `炉次未按记录时间排开：${times.join(',')}`,
    )
    const statuses = rows.map((row) => String(row.status)).join(',')
    check(
      statuses === '已停炉,已停炉,故障停炉,已停炉,运行中,待点火',
      `炉况状态序列不符：${statuses}`,
    )
    const running = byNo('INCI-0005')
    check(
      running && running['炉膛温度'] === '881℃' && running['给料速率'] === '12.6 t/h',
      'INCI-0005 的炉膛温度/给料速率应灌成现场值',
    )
    check(
      rows.every((row) => String(row['炉况状态']) === String(row.status)),
      '炉况状态列应与当前状态一致',
    )

    const init = listRows('equipcheck').find((row) => row['点检编号'] === 'EQUI-INIT-0001')
    check(init && init.status === '待点检' && init.pending === true, '初始化结论应落到设备点检待点检清单')

    const overview = loadOverview()
    const totalCard = overview.cards.find((card) => card.label === '登记总量')
    check(totalCard && totalCard.value > 0, '灌完概览登记总量应大于 0')
    const moduleRow = overview.modules.find((item) => item.name === '焚烧炉运行')
    check(moduleRow && moduleRow.created === 6, `概览焚烧炉应有 6 条，实际 ${moduleRow && moduleRow.created}`)

    const raw = storedRaw()
    check(raw[backupKey()], '覆盖前应先抄底（备份键不存在）')
    const backupEntries = JSON.parse(raw[backupKey()]).entries
    check(backupEntries.incinerator.length === 3, '备份里应是覆盖前的 3 条占位炉次')

    // 模拟本地既有记录：用户自己登的一条，编号不在演示序列里
    saveRows('incinerator', [
      ...incinerator(),
      {
        id: 99,
        status: '待点火',
        pending: true,
        abnormal: false,
        运行编号: 'INCI-CUSTOM-1',
        炉膛温度: '现场手工记录',
        记录时间: '2026-10-01 09:00',
      },
    ])
    console.log('PASS first：按时序铺满、概览有数、覆盖前已抄底')
  },

  // 第二个进程读同一个存储文件 = 重新打开浏览器：读到的炉次要对得上；再跑一遍不翻倍
  second() {
    const before = incinerator()
    check(before.length === 7, `重新打开应读到 7 条炉次，实际 ${before.length}`)
    check(before.some((row) => row['运行编号'] === 'INCI-CUSTOM-1'), '本地既有记录应还在')
    const idOf = (no) => byNo(no)?.id
    const ids = { first: idOf('INCI-0001'), last: idOf('INCI-0006') }
    const totalBefore = loadOverview().cards.find((card) => card.label === '登记总量').value

    const result = prepareDemoData()
    check(result.ok, `第二次准备应成功：${result.message}`)
    check(
      result.added === 0 && result.removed === 0,
      `第二次不应新增/清理：${JSON.stringify(result)}`,
    )

    const after = incinerator()
    check(after.length === 7, `连跑不应翻倍，实际 ${after.length}`)
    check(byNo('INCI-0001').id === ids.first, 'INCI-0001 的 id 应保持稳定')
    check(byNo('INCI-0006').id === ids.last, 'INCI-0006 的 id 应保持稳定')
    const custom = byNo('INCI-CUSTOM-1')
    check(custom && custom['炉膛温度'] === '现场手工记录', '本地既有记录不应被覆盖')
    check(
      listRows('equipcheck').filter((row) => row['点检编号'] === 'EQUI-INIT-0001').length === 1,
      '初始化结论不应重复出现',
    )
    const totalAfter = loadOverview().cards.find((card) => card.label === '登记总量').value
    check(totalAfter === totalBefore, `连跑后概览总量不应变：${totalBefore} -> ${totalAfter}`)
    console.log('PASS second：重开读数一致、连跑去重不翻倍、既有记录保留')
  },

  // 旧准备路径堆出来的重复炉次：同编号只留一条并灌成演示值
  'legacy-dup'() {
    const dup = {
      status: '待点火',
      pending: true,
      abnormal: false,
      运行编号: 'INCI-0001',
      炉膛温度: '旧脚本残留',
      记录时间: '2026-09-28 08:30',
    }
    saveRows('incinerator', [...incinerator(), { ...dup, id: 11 }, { ...dup, id: 12 }])
    check(
      incinerator().filter((row) => row['运行编号'] === 'INCI-0001').length === 3,
      '前置：应堆出 3 条 INCI-0001',
    )
    const result = prepareDemoData()
    check(result.ok, `准备应成功：${result.message}`)
    check(result.removed === 2, `应清掉 2 条重复炉次，实际 ${result.removed}`)
    const rows = incinerator()
    check(rows.filter((row) => row['运行编号'] === 'INCI-0001').length === 1, '重复炉次应只剩 1 条')
    check(byNo('INCI-0001')['炉膛温度'] === '872℃', '留下的那条应被灌成演示值')
    console.log('PASS legacy-dup：旧路径堆出的重复炉次被去重清理')
  },

  // 中途失败：正库不被写坏，备份在，提示可重试
  failwrite() {
    const result = prepareDemoData()
    check(!result.ok, '写入失败时准备应报失败')
    check(
      result.message.includes('回滚') && result.message.includes('重试'),
      `失败信息应提示已回滚可重试：${result.message}`,
    )
    const raw = storedRaw()
    check(raw[backupKey()], '即使失败，动手前的备份也应在')
    const main = JSON.parse(raw[MAIN_KEY])
    check(main.incinerator.length === 3, `正库不应被写坏，实际 ${main.incinerator.length} 条`)
    check(
      main.incinerator.every((row) => String(row['炉膛温度']).startsWith('焚烧炉运行样例')),
      '正库应仍是原占位数据',
    )
    console.log('PASS failwrite：中途失败已回滚、正库未写坏')
  },

  // 失败之后换个进程再试一次：应当成功
  retry() {
    const result = prepareDemoData()
    check(result.ok, `失败后重试应成功：${result.message}`)
    check(incinerator().length === 6, '重试后应有 6 条炉次')
    console.log('PASS retry：中途失败后可再试一次')
  },

  // 炉况状态机：只能从待点火顺着走到已停炉，不允许跳级
  flow() {
    check(prepareDemoData().ok, '先灌演示数据')
    const idOf = (no) => Number(byNo(no).id)

    let result = runAction('incinerator', idOf('INCI-0006'), '登记停炉')
    check(!result.ok && result.message.includes('跳级'), `待点火→已停炉应被拒绝（跳级）：${result.message}`)
    result = runAction('incinerator', idOf('INCI-0006'), '上报故障')
    check(!result.ok, `待点火→故障停炉应被拒绝：${result.message}`)
    check(byNo('INCI-0006').status === '待点火', '被拒绝后状态不应变')

    result = runAction('incinerator', idOf('INCI-0006'), '提交点火')
    check(result.ok && byNo('INCI-0006').status === '运行中', `待点火→运行中应放行：${result.message}`)
    check(byNo('INCI-0006')['炉况状态'] === '运行中', '炉况状态列应跟着流转')
    result = runAction('incinerator', idOf('INCI-0006'), '登记停炉')
    check(result.ok && byNo('INCI-0006').status === '已停炉', `运行中→已停炉应放行：${result.message}`)
    result = runAction('incinerator', idOf('INCI-0006'), '提交点火')
    check(!result.ok, `已停炉→运行中应被拒绝：${result.message}`)

    result = runAction('incinerator', idOf('INCI-0005'), '上报故障')
    check(result.ok && byNo('INCI-0005').status === '故障停炉', `运行中→故障停炉应放行：${result.message}`)
    check(byNo('INCI-0005').abnormal === true, '故障停炉应标异常')

    const page = listEntries('incinerator')
    check(page.total === 6 && page.items.length === 6, '列表页读到的炉次应与库里一致')
    console.log('PASS flow：炉况状态顺次流转、不允许跳级')
  },
}

const run = scenarios[scenario]
if (!run) {
  console.error(`未知场景：${scenario}`)
  process.exit(2)
}
run()
