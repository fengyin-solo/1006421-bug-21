import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

function isPending(meta: ModuleMeta, status: string): boolean {
  if (meta.statusFlow) {
    return (meta.statusFlow[status] ?? []).length > 0
  }
  return status !== meta.statuses[meta.statuses.length - 1]
}

/** 模块里用来排序的时间字段：取字段名中带「时间/日期」的第一个，没有就不排。 */
function timeField(meta: ModuleMeta): string | null {
  return meta.fields.find((field) => field.includes('时间') || field.includes('日期')) ?? null
}

/** 按时序铺开：同一模块的记录按时间字段从早到晚，时间相同保持入库顺序。 */
function sortByTime(meta: ModuleMeta, rows: EntryRow[]): EntryRow[] {
  const field = timeField(meta)
  if (!field) {
    return rows
  }
  return rows
    .map((row, index) => ({ row, index, stamp: Date.parse(String(row[field] ?? '')) }))
    .sort((a, b) => {
      // 无法解析时间的排到最后，时间相同保持原顺序。
      if (Number.isNaN(a.stamp) && Number.isNaN(b.stamp)) {
        return a.index - b.index
      }
      if (Number.isNaN(a.stamp)) {
        return 1
      }
      if (Number.isNaN(b.stamp)) {
        return -1
      }
      return a.stamp - b.stamp || a.index - b.index
    })
    .map((item) => item.row)
}

export function canTransit(meta: ModuleMeta, current: string, target: string): boolean {
  if (!meta.statusFlow) {
    return true
  }
  return (meta.statusFlow[current] ?? []).includes(target)
}

/** 按流转表推导这条记录当前能做的动作，页面据此渲染，服务端（本地服务）仍是唯一裁决处。 */
export function availableActions(meta: ModuleMeta, row: EntryRow): string[] {
  const current = String(row.status)
  return meta.actions.filter((action) => {
    const target = meta.actionTargets[action]
    return target && target !== current && canTransit(meta, current, target)
  })
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
  const meta = moduleMeta(key)
  const matched = filterRows(sortByTime(meta, listRows(key)), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getEntry(key: string, id: number): EntryRow | null {
  return listRows(key).find((row) => Number(row.id) === id) ?? null
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
  if (!canTransit(meta, current, target)) {
    const route = (meta.statusFlow?.[current] ?? []).join('、')
    const hint = route ? `，只能先流转到：${route}` : '，该状态为终态，不能再流转'
    return { ok: false, message: `状态不允许跳级：「${current}」不能直接变为「${target}」${hint}` }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: isPending(meta, target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
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

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of sortByTime(meta, listRows(key))) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
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
