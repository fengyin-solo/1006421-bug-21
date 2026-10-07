<template>
  <section class="page" data-module="incinerator-detail">
    <header class="page-head">
      <div>
        <h2>焚烧炉运行详情</h2>
        <p class="page-desc">查看单个炉次的运行参数与炉况，状态流转与列表页同一套规则，不允许跳级。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/incinerator">返回焚烧炉列表</RouterLink>
      </div>
    </header>

    <article v-if="row" class="detail-card">
      <div class="detail-title">
        <h3>{{ row['运行编号'] }}</h3>
        <span class="status-tag">{{ row.status }}</span>
      </div>

      <dl class="detail-grid">
        <template v-for="field in columns" :key="field">
          <dt>{{ field }}</dt>
          <dd>{{ row[field] ?? '—' }}</dd>
        </template>
      </dl>

      <p class="status-legend">
        炉况流转顺序：待点火 → 运行中 → 已停炉（运行中可上报故障停炉，故障停炉可恢复或正式停炉）
      </p>

      <div class="detail-actions">
        <button
          v-for="action in actions"
          :key="action"
          class="btn"
          :class="{ primary: action === '提交点火' }"
          type="button"
          @click="runAction(action)"
        >
          {{ action }}
        </button>
        <span v-if="!actions.length" class="muted">该炉况为终态，没有可执行动作</span>
      </div>

      <p v-if="message" class="page-foot" :class="ok ? 'ok-text' : 'error-text'">{{ message }}</p>
    </article>

    <article v-else class="detail-card">
      <p class="empty-state">没有找到该炉次，可能已被重置或编号有误。</p>
      <RouterLink class="btn" to="/incinerator">返回列表</RouterLink>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import {
  availableActions,
  getEntry,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('incinerator')
const columns = meta.fields
const route = useRoute()

const row = ref<EntryRow | null>(getEntry(meta.key, Number(route.params.id)))
const message = ref('')
const ok = ref(true)

const actions = computed(() => (row.value ? availableActions(meta, row.value) : []))

function runAction(action: string) {
  if (!row.value) {
    return
  }
  const result = applyAction(meta.key, Number(row.value.id), action)
  message.value = result.message
  ok.value = result.ok
  if (result.ok) {
    row.value = getEntry(meta.key, Number(row.value.id))
  }
}
</script>
