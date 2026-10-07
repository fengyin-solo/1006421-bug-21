import { MODULE_BY_KEY } from '@/data/modules'
import { demoPlan, sortByField, upsertDemoRows } from '@/data/prepare'
import {
  allRows,
  backupKey,
  backupRows,
  listRows,
  resetRows,
  restoreBackup,
  saveAllRows,
  saveRows,
} from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  PrepareResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 各模块状态列表的最后一项都是异常终态（故障停炉、数据异常……），落到它就算异常。
function isNegativeTarget(meta: ModuleMeta, target: string, action: string): boolean {
  if (NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))) {
    return true
  }
  return target === meta.statuses[meta.statuses.length - 1]
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const sources = meta.actionSources?.[action]
  if (sources && !sources.includes(current)) {
    return {
      ok: false,
      message: `${meta.entity}当前状态「${current}」不允许执行「${action}」：只能从「${sources.join('」「')}」顺次流转，状态不允许跳级`,
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: isNegativeTarget(meta, target, action),
  }
  // 列表里的「炉况状态」这类镜像列跟着当前状态走，两列才不会读岔
  const statusField = meta.fields[meta.fields.length - 1]
  if (statusField.endsWith('状态')) {
    updated[statusField] = target
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function localToday(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * 准备演示数据（这条链路只许成功或可重试）：
 * 1. 先在内存里把目标状态算好，出错时一个字节都还没写，直接重试；
 * 2. 动手前先把当前整库抄一份底（备份键见返回值）；
 * 3. 整库一次写入，写坏了按备份回滚，可再试；
 * 4. 合并按业务编号去重，连跑多遍不会翻倍，本地既有记录原样保留；
 *    初始化的结论同步落到设备点检的「待点检」清单。
 */
export function prepareDemoData(): PrepareResult {
  const backup = backupKey()
  let next: Record<string, EntryRow[]>
  let added = 0
  let updated = 0
  let removed = 0
  try {
    const current = allRows()
    next = { ...current }
    for (const item of demoPlan(localToday())) {
      const merged = upsertDemoRows(current[item.key] ?? [], item.rows, item.keyField)
      next[item.key] = item.sortField ? sortByField(merged.rows, item.sortField) : merged.rows
      added += merged.added
      updated += merged.updated
      removed += merged.removed
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `演示数据准备失败（${reason}），尚未写入任何数据，可重试`, added: 0, updated: 0, removed: 0, backupKey: backup }
  }
  try {
    backupRows()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `演示数据备份失败（${reason}），原数据未动，可重试`, added: 0, updated: 0, removed: 0, backupKey: backup }
  }
  try {
    saveAllRows(next)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const restored = restoreBackup()
    const tail = restored ? '已按备份回滚，可重试' : '回滚备份也没成功，请检查浏览器存储后重试'
    return { ok: false, message: `演示数据写入失败（${reason}），${tail}`, added: 0, updated: 0, removed: 0, backupKey: backup }
  }
  const parts = [`新增 ${added} 条`, `按编号去重更新 ${updated} 条`]
  if (removed > 0) {
    parts.push(`清理重复 ${removed} 条`)
  }
  return {
    ok: true,
    message: `演示数据已就绪：${parts.join('、')}；初始化结论已落到设备点检「待点检」清单（EQUI-INIT-0001）；原数据已备份到 ${backup}，连跑多遍不会翻倍`,
    added,
    updated,
    removed,
    backupKey: backup,
  }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
