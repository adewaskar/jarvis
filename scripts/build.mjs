import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function vendorMediaPipe() {
  const source = 'node_modules/@mediapipe/tasks-vision/wasm'
  const destination = 'public/mediapipe'
  if (!existsSync(source)) {
    console.warn('[jarvis] MediaPipe package missing; hand tracking may be unavailable.')
    return
  }
  mkdirSync(destination, { recursive: true })
  cpSync(source, destination, { recursive: true, force: true })
  console.log('[jarvis] MediaPipe WASM copied to public assets.')
}

vendorMediaPipe()
run(process.execPath, ['node_modules/typescript/bin/tsc', '-b'])
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'])
