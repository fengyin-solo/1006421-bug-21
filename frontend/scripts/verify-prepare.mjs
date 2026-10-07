// 演示数据准备链路的验证入口：把 prepare-runner.mjs 用 esbuild 打包（带上 src 里的 TS 数据层），
// 再按场景逐个起独立进程跑。用法：npm run verify:prepare
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(here, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-verify-'))
const bundle = path.join(tmp, 'runner.mjs')

await build({
  entryPoints: [path.join(here, 'prepare-runner.mjs')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  alias: { '@': path.join(frontendDir, 'src') },
  logLevel: 'silent',
})

let failed = 0
function run(scenario, { storage, failMainWrite = false } = {}) {
  const env = { ...process.env, SCENARIO: scenario, STORAGE_FILE: storage }
  if (failMainWrite) {
    env.FAIL_MAIN_WRITE = '1'
  }
  try {
    const out = execFileSync(process.execPath, [bundle], { env, encoding: 'utf8' })
    process.stdout.write(out)
  } catch (error) {
    failed += 1
    // 子进程的 stderr 默认已透传到终端，这里只补打 stdout，避免失败信息打两遍
    if (error.stdout) process.stdout.write(error.stdout)
  }
}

// 同一个存储文件跨场景复用 = 关掉浏览器再打开，验证「存的那份能重新读出来」
const store1 = path.join(tmp, 'store-1.json')
run('first', { storage: store1 })
run('second', { storage: store1 })
run('legacy-dup', { storage: path.join(tmp, 'store-2.json') })
const store3 = path.join(tmp, 'store-3.json')
run('failwrite', { storage: store3, failMainWrite: true })
run('retry', { storage: store3 })
run('flow', { storage: path.join(tmp, 'store-4.json') })

fs.rmSync(tmp, { recursive: true, force: true })
if (failed > 0) {
  console.error(`\n${failed} 个场景未通过`)
  process.exit(1)
}
console.log('\n全部场景通过：按时序铺满、可重读、连跑去重、先抄底再覆盖、失败可重试、炉况不跳级')
