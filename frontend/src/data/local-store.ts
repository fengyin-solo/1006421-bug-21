import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'waste-to-energy-plant:entries'
// 演示数据准备动手前先抄一份底，放在这个键下，写坏了能回滚、能再试。
const BACKUP_KEY = `${STORAGE_KEY}:backup`

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  // 先落库再换缓存：落库失败时缓存不动，列表页与详情读到的还是同一份。
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  cache = next
}

/** 整库一次写入：准备演示数据这类跨模块改动走这里，避免写一半。 */
export function saveAllRows(rows: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  }
  cache = rows
}

/** 覆盖之前先抄底：把当前整库快照写进备份键。 */
export function backupRows(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  const snapshot = { savedAt: new Date().toISOString(), entries: allRows() }
  window.localStorage.setItem(BACKUP_KEY, JSON.stringify(snapshot))
}

/** 按备份回滚：准备中途失败时调，返回是否恢复成功。 */
export function restoreBackup(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false
  }
  const raw = window.localStorage.getItem(BACKUP_KEY)
  if (!raw) {
    return false
  }
  try {
    const parsed = JSON.parse(raw) as { entries?: Record<string, EntryRow[]> }
    if (!parsed || typeof parsed !== 'object' || !parsed.entries) {
      return false
    }
    saveAllRows(parsed.entries)
    return true
  } catch {
    return false
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

export function backupKey(): string {
  return BACKUP_KEY
}
