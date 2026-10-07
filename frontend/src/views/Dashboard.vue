<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button v-if="showDemoPrepare" class="btn primary" type="button" @click="prepareDemo">
          准备焚烧炉演示数据
        </button>
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <p v-if="demoMessage" class="page-foot" :class="demoOk ? 'ok-text' : 'error-text'">{{ demoMessage }}</p>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { prepareDemoData } from '@/data/demo-seed'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const showDemoPrepare = import.meta.env.DEV
const demoMessage = ref('')
const demoOk = ref(true)

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
}

function prepareDemo() {
  // 准备脚本自带「抄底→去重→校验→提交，失败回滚」，多跑几遍也安全。
  const result = prepareDemoData()
  demoOk.value = result.ok
  if (result.ok) {
    demoMessage.value = `${result.message}（炉次 ${result.incineratorCount} 条、待点检 ${result.equipcheckCount} 条）`
    refresh()
  } else {
    demoMessage.value = result.message
  }
}

onMounted(refresh)
</script>
