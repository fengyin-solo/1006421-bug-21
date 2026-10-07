import { SEED_ROWS } from './seed'
import type { EntriesSnapshot, EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'waste-to-energy-plant:entries'

export type { EntriesSnapshot }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedFallback(): EntriesSnapshot {
  return clone(SEED_ROWS)
}

function readStorage(): EntriesSnapshot {
  const fallback = seedFallback()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as EntriesSnapshot
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: EntriesSnapshot | null = null

export function allRows(): EntriesSnapshot {
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
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 取当前整库的深拷贝，供准备脚本做「先抄底再覆盖」的备份。 */
export function readSnapshot(): EntriesSnapshot {
  return clone(allRows())
}

/** 整库一次性提交：缓存与 localStorage 同步替换；写失败时抛出，由调用方回滚备份。 */
export function commitSnapshot(snapshot: EntriesSnapshot): void {
  const next = clone(snapshot)
  if (typeof window !== 'undefined' && window.localStorage) {
    // 先写浏览器：setItem 配额超限等异常会在缓存改动前抛出，原数据不动，可以再试一次。
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  cache = next
}

export function storageKey(): string {
  return STORAGE_KEY
}
