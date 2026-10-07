import type { EntryRow } from './types'

// 演示数据准备：这里只描述「灌什么、按什么键去重、按什么字段排序」，
// 备份、覆盖、回滚、重试的编排都在 api/local-service.ts 的 prepareDemoData 里。
//
// 炉次按时序排开：历史炉次已停炉（含一次故障停炉），当前炉次运行中，下一炉待点火；
// 炉膛温度、给料速率用接近现场的值，不再是「焚烧炉运行样例N」这种占位符。
// 去重键用业务编号（运行编号 / 点检编号）：连跑多遍只会原地更新，不会翻倍。

/** 演示行：与 EntryRow 同构但不带 id，id 在合并时按既有记录保留或顺次新编。 */
export type DemoRow = {
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type DemoPlan = {
  key: string
  /** 去重用的业务编号字段 */
  keyField: string
  /** 合并后按这个字段升序排开（时间序列） */
  sortField?: string
  rows: DemoRow[]
}

export type MergeOutcome = {
  rows: EntryRow[]
  added: number
  updated: number
  removed: number
}

const DEMO_INCINERATOR_ROWS: DemoRow[] = [
  {
    status: '已停炉',
    pending: false,
    abnormal: false,
    运行编号: 'INCI-0001',
    炉膛温度: '872℃',
    炉膛负压: '-48 Pa',
    给料速率: '11.6 t/h',
    运行班次: '白班 08:00-20:00',
    操作人员: '张伟',
    记录时间: '2026-09-28 08:30',
    炉况状态: '已停炉',
  },
  {
    status: '已停炉',
    pending: false,
    abnormal: false,
    运行编号: 'INCI-0002',
    炉膛温度: '868℃',
    炉膛负压: '-52 Pa',
    给料速率: '12.1 t/h',
    运行班次: '白班 08:00-20:00',
    操作人员: '李强',
    记录时间: '2026-09-30 08:15',
    炉况状态: '已停炉',
  },
  {
    status: '故障停炉',
    pending: false,
    abnormal: true,
    运行编号: 'INCI-0003',
    炉膛温度: '845℃',
    炉膛负压: '-61 Pa',
    给料速率: '10.8 t/h',
    运行班次: '夜班 20:00-08:00',
    操作人员: '王磊',
    记录时间: '2026-10-02 20:40',
    炉况状态: '故障停炉',
  },
  {
    status: '已停炉',
    pending: false,
    abnormal: false,
    运行编号: 'INCI-0004',
    炉膛温度: '875℃',
    炉膛负压: '-49 Pa',
    给料速率: '12.4 t/h',
    运行班次: '白班 08:00-20:00',
    操作人员: '赵敏',
    记录时间: '2026-10-04 08:05',
    炉况状态: '已停炉',
  },
  {
    status: '运行中',
    pending: true,
    abnormal: false,
    运行编号: 'INCI-0005',
    炉膛温度: '881℃',
    炉膛负压: '-50 Pa',
    给料速率: '12.6 t/h',
    运行班次: '白班 08:00-20:00',
    操作人员: '陈晨',
    记录时间: '2026-10-06 08:20',
    炉况状态: '运行中',
  },
  {
    status: '待点火',
    pending: true,
    abnormal: false,
    运行编号: 'INCI-0006',
    炉膛温度: '常温',
    炉膛负压: '0 Pa',
    给料速率: '0 t/h',
    运行班次: '白班 08:00-20:00',
    操作人员: '陈晨',
    记录时间: '2026-10-08 08:00',
    炉况状态: '待点火',
  },
]

/** 初始化结论：落到设备点检的「待点检」清单，点检日期取准备当天。 */
function demoEquipcheckRows(today: string): DemoRow[] {
  return [
    {
      status: '待点检',
      pending: true,
      abnormal: false,
      点检编号: 'EQUI-INIT-0001',
      点检设备: '1号焚烧炉',
      点检部位: '炉膛与给料系统',
      点检方法: '点火前例行点检',
      点检结果: '演示数据初始化完成，待点火前点检确认',
      点检人员: '值班管理员',
      点检日期: today,
      点检状态: '待点检',
    },
  ]
}

export function demoPlan(today: string): DemoPlan[] {
  return [
    { key: 'incinerator', keyField: '运行编号', sortField: '记录时间', rows: DEMO_INCINERATOR_ROWS },
    { key: 'equipcheck', keyField: '点检编号', rows: demoEquipcheckRows(today) },
  ]
}

/**
 * 纯函数：把演示行按业务编号合并进既有记录。
 * - 同编号：原地更新（保留原 id），连跑不翻倍；
 * - 新编号：追加，id 接着现有最大值往后编；
 * - 旧准备路径堆出来的同编号重复行：只留第一条，其余清掉；
 * - 与演示无关的本地既有记录：原样保留。
 */
export function upsertDemoRows(existing: EntryRow[], demoRows: DemoRow[], keyField: string): MergeOutcome {
  const demoKeys = new Set(demoRows.map((row) => String(row[keyField] ?? '')))
  const seen = new Set<string>()
  const rows: EntryRow[] = []
  let removed = 0
  for (const row of existing) {
    const key = String(row[keyField] ?? '')
    if (demoKeys.has(key)) {
      if (seen.has(key)) {
        removed += 1
        continue
      }
      seen.add(key)
    }
    rows.push({ ...row })
  }
  let added = 0
  let updated = 0
  let nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  for (const demo of demoRows) {
    const keyValue = String(demo[keyField] ?? '')
    const index = rows.findIndex((row) => String(row[keyField] ?? '') === keyValue)
    if (index >= 0) {
      rows[index] = { ...demo, id: rows[index].id }
      updated += 1
    } else {
      nextId += 1
      rows.push({ ...demo, id: nextId })
      added += 1
    }
  }
  return { rows, added, updated, removed }
}

/** 按字段升序排开（空值排最后），sort 是稳定排序，同值保持原先后顺序。 */
export function sortByField(rows: EntryRow[], field: string): EntryRow[] {
  return [...rows].sort((a, b) => {
    const av = String(a[field] ?? '')
    const bv = String(b[field] ?? '')
    if (av === '' && bv === '') return 0
    if (av === '') return 1
    if (bv === '') return -1
    return av < bv ? -1 : av > bv ? 1 : 0
  })
}
