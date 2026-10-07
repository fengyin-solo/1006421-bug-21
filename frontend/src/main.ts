import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { prepareDemoData } from './data/demo-seed'
import './styles/global.css'

// 本地开发环境：启动演示准备。脚本本身是幂等的——
// 已经铺过就只做去重校验，连跑多遍不会翻倍；中途失败会回滚并允许再试。
if (import.meta.env.DEV) {
  try {
    prepareDemoData()
  } catch (error) {
    // 准备失败不阻断页面，Dashboard 上提供按钮可以再试一次。
    console.warn('[demo] 演示数据准备失败：', error)
  }
}

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
