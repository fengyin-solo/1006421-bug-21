import { commitSnapshot, readSnapshot, storageKey } from './local-store'
import { SEED_ROWS } from './seed'
import type { EntryRow, EntriesSnapshot } from './types'

// 焚烧炉演示数据的准备脚本。
// 设计目标：
// 1. 跑完后炉次按记录时间铺满时序，温度/给料等是可演示的真实值；
// 2. 同一路径连跑多遍按「运行编号」去重，旧演示炉次先撤再铺，绝不翻倍；
// 3. 本地既有（非演示）记录原样保留；
// 4. 动手前先抄一份底再覆盖，中途失败自动回滚，可立即再试一次；
// 5. 初始化结论（在运/故障炉次需要点检）落到设备点检的「待点检」清单。

export const DEMO_VERSION = 'incinerator-demo-v1'

const DEMO_MARK_KEY = `${storageKey()}:demo-incinerator`
const BACKUP_KEY = `${storageKey()}:backup`

const INCINERATOR_KEY = 'incinerator'
const EQUIPCHECK_KEY = 'equipcheck'
const INCINERATOR_STATUSES = ['待点火', '运行中', '故障停炉', '已停炉']

export type PrepareResult = {
  ok: boolean
  message: string
  /** 本次准备覆盖的演示炉次数 */
  incineratorCount: number
  /** 本次新增/更新的待点检记录数 */
  equipcheckCount: number
  /** 命中去重：库里已是这套演示数据，没有重复追加 */
  reused: boolean
  /** 写入失败后已用备份回滚 */
  restored: boolean
}

type DemoMark = {
  version: string
  incineratorCodes: string[]
  equipcheckCodes: string[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function maxId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
}

function codeOf(row: EntryRow): string {
  return String(row['运行编号'] ?? '')
}

/** 旧版本准备脚本（或占位种子）留下的炉次：字段还是「焚烧炉运行样例N」，重跑时要一并清掉。 */
function isLegacyDemoRow(row: EntryRow): boolean {
  return Object.values(row).some(
    (value) => typeof value === 'string' && value.includes('焚烧炉运行样例'),
  )
}

function readMark(): DemoMark | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  try {
    const raw = window.localStorage.getItem(DEMO_MARK_KEY)
    return raw ? (JSON.parse(raw) as DemoMark) : null
  } catch {
    return null
  }
}

function writeMark(mark: DemoMark): void {
  window.localStorage.setItem(DEMO_MARK_KEY, JSON.stringify(mark))
}

/** 设备点检编号跟着炉次走，去重时认得出来。 */
function equipCodeFor(furnaceCode: string): string {
  return `EQUI-${furnaceCode}`
}

function buildEquipcheckRow(id: number, furnace: EntryRow, today: string): EntryRow {
  const code = codeOf(furnace)
  const fault = String(furnace.status) === '故障停炉'
  return {
    id,
    status: '待点检',
    pending: true,
    abnormal: false,
    点检编号: equipCodeFor(code),
    点检设备: `焚烧炉 ${code}`,
    点检部位: fault ? '给料机卡阻部位与炉膛负压测点' : '炉膛燃烧器、给料系统与温度测点',
    点检方法: '现场巡检并核对DCS实时曲线',
    点检结果: '待点检',
    点检人员: '当班运行人员',
    点检日期: today,
    点检状态: '待点检',
  }
}

/** 纯计算：在备份之上合并演示数据，任何一步不合法都抛错（此时一行都还没写）。 */
function mergeDemoData(snapshot: EntriesSnapshot, mark: DemoMark | null): {
  next: EntriesSnapshot
  mark: DemoMark
  reused: boolean
  equipcheckCount: number
} {
  const demoFurnaces = clone(SEED_ROWS[INCINERATOR_KEY] ?? [])
  if (demoFurnaces.length === 0) {
    throw new Error('焚烧炉演示数据为空，无法准备演示环境')
  }

  const currentFurnaces = snapshot[INCINERATOR_KEY] ?? []
  const managedCodes = new Set(mark?.incineratorCodes ?? [])
  const demoCodes = new Set(demoFurnaces.map(codeOf))

  // 兼容本地既有记录：只撤掉「上一遍演示数据」、同编号的演示炉次和老占位数据，
  // 用户自己登记的炉次（编号不在演示集合里）原样保留。
  const keptFurnaces = currentFurnaces.filter(
    (row) =>
      !managedCodes.has(codeOf(row)) &&
      !demoCodes.has(codeOf(row)) &&
      !isLegacyDemoRow(row),
  )

  // 校验演示炉次自身：编号唯一、炉况合法、关键字段不是占位值、记录时间可解析且按时序排列。
  const seen = new Set<string>()
  let previousStamp = Number.NEGATIVE_INFINITY
  for (const row of demoFurnaces) {
    const code = codeOf(row)
    if (!code || seen.has(code)) {
      throw new Error(`演示炉次编号缺失或重复：${code || '(空)'}`)
    }
    seen.add(code)
    if (!INCINERATOR_STATUSES.includes(String(row.status))) {
      throw new Error(`演示炉次 ${code} 的炉况状态不合法：${row.status}`)
    }
    for (const field of ['炉膛温度', '炉膛负压', '给料速率']) {
      const value = String(row[field] ?? '')
      if (!value || value.includes('样例')) {
        throw new Error(`演示炉次 ${code} 的${field}还是占位值，不能铺演示数据`)
      }
    }
    const stamp = Date.parse(String(row['记录时间'] ?? ''))
    if (Number.isNaN(stamp)) {
      throw new Error(`演示炉次 ${code} 的记录时间无法解析：${row['记录时间']}`)
    }
    if (stamp < previousStamp) {
      throw new Error(`演示炉次没有按时序排列：${code} 早于上一炉次`)
    }
    previousStamp = stamp
  }

  // 演示数据紧跟在既有记录之后分配 id；首跑与第二跑落到同样的 id，列表/详情读到的炉次一致。
  let nextId = maxId(keptFurnaces) + 1
  const mergedFurnaces = [...keptFurnaces]
  for (const row of demoFurnaces) {
    mergedFurnaces.push({ ...row, id: nextId++ })
  }
  mergedFurnaces.sort(
    (a, b) => Date.parse(String(a['记录时间'] ?? '')) - Date.parse(String(b['记录时间'] ?? '')),
  )

  // 初始化结论：在运炉次需要例行点检，故障停炉炉次恢复前必须先排查——都落进「待点检」清单。
  const today = new Date().toISOString().slice(0, 10)
  const conclusionFurnaces = demoFurnaces.filter((row) =>
    ['运行中', '故障停炉'].includes(String(row.status)),
  )

  const currentEquipchecks = snapshot[EQUIPCHECK_KEY] ?? []
  const conclusionCodes = new Set(conclusionFurnaces.map((row) => equipCodeFor(codeOf(row))))
  const managedEquipCodes = new Set(mark?.equipcheckCodes ?? [])
  // 与炉次一致：上一遍托管的、同编号的演示点检都由本版替换，只保留用户自己的记录。
  const keptEquipchecks = currentEquipchecks.filter(
    (row) =>
      !managedEquipCodes.has(String(row['点检编号'] ?? '')) &&
      !conclusionCodes.has(String(row['点检编号'] ?? '')),
  )

  let equipId = maxId(keptEquipchecks) + 1
  const mergedEquipchecks = [...keptEquipchecks]
  for (const furnace of conclusionFurnaces) {
    mergedEquipchecks.push(buildEquipcheckRow(equipId++, furnace, today))
  }
  mergedEquipchecks.sort((a, b) => String(a['点检编号']).localeCompare(String(b['点检编号'])))

  const nextMark: DemoMark = {
    version: DEMO_VERSION,
    incineratorCodes: demoFurnaces.map(codeOf),
    equipcheckCodes: conclusionFurnaces.map((row) => equipCodeFor(codeOf(row))),
  }

  // 复用判定：标记版本一致、炉次与待点检结论在库里都齐了，就不再追加。
  const reused =
    mark?.version === DEMO_VERSION &&
    nextMark.incineratorCodes.every((code) =>
      currentFurnaces.some((row) => codeOf(row) === code),
    ) &&
    nextMark.equipcheckCodes.every((code) =>
      currentEquipchecks.some((row) => String(row['点检编号']) === code),
    )

  return {
    next: { ...snapshot, [INCINERATOR_KEY]: mergedFurnaces, [EQUIPCHECK_KEY]: mergedEquipchecks },
    mark: nextMark,
    reused,
    equipcheckCount: conclusionFurnaces.length,
  }
}

/**
 * 跑一遍焚烧炉演示准备。
 * 流程：抄底 → 合并去重 → 校验 → 留备份 → 落标记 → 整库提交；提交失败按备份回滚。
 */
export function prepareDemoData(): PrepareResult {
  // 1. 动手前先抄一份底，后续覆盖都在副本上进行。
  const snapshot = readSnapshot()
  const previousMark = readMark()

  // 2-3. 在副本上去重合并并自检，失败直接抛出，不动库里任何数据。
  const plan = mergeDemoData(snapshot, previousMark)

  const fail = (message: string, restored: boolean): PrepareResult => ({
    ok: false,
    message,
    incineratorCount: 0,
    equipcheckCount: 0,
    reused: false,
    restored,
  })

  try {
    // 4. 把底再抄一份进浏览器，真写坏了还能人工找回。
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(BACKUP_KEY, JSON.stringify(snapshot))
      // 5. 先落去重标记：即使下一步失败，重试时也能按标记精确回收半成品。
      writeMark(plan.mark)
    }
    // 6. 整库一次性提交（缓存与 localStorage 同步）。
    commitSnapshot(plan.next)
  } catch (error) {
    // 中途失败：用手里的备份把库还原，再把结果交出去，允许立刻再试一次。
    let restored = false
    try {
      commitSnapshot(snapshot)
      restored = true
    } catch {
      restored = false
    }
    const reason = error instanceof Error ? error.message : '写入本地数据失败'
    return fail(`演示数据准备失败，已${restored ? '回滚到准备前' : '保留原备份，可手动恢复'}：${reason}`, restored)
  }

  return {
    ok: true,
    message: plan.reused
      ? '演示数据已就绪：炉次按时序铺开，重复执行未产生重复炉次'
      : '演示数据已铺好：焚烧炉时序炉次与设备点检待办均已写入浏览器',
    incineratorCount: plan.mark.incineratorCodes.length,
    equipcheckCount: plan.equipcheckCount,
    reused: plan.reused,
    restored: false,
  }
}

/** 从准备前抄下的备份恢复整库（人工兜底）。 */
export function restoreDemoBackup(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false
  }
  const raw = window.localStorage.getItem(BACKUP_KEY)
  if (!raw) {
    return false
  }
  commitSnapshot(JSON.parse(raw) as EntriesSnapshot)
  return true
}

export function demoStorageKeys(): { mark: string; backup: string } {
  return { mark: DEMO_MARK_KEY, backup: BACKUP_KEY }
}
