import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { execFile } from 'node:child_process'
import os from 'node:os'
import { z } from 'zod'
import { safe } from './secrets.mjs'

/**
 * The laptop itself: what it's doing, and the everyday controls.
 *
 * Reads (always on): CPU, memory, battery, disks, network, running apps.
 * Acting tools (only with --writes): open and close apps, open links, volume,
 * lock, sleep, and a timed shutdown or restart the user can cancel.
 *
 * Power tools are built only for live sessions. The autopilot runs unattended
 * and never gets them, so nothing it reads online can switch the PC off.
 * Shutdown and restart always run on a countdown (Windows shows its own
 * notice), and cancel_shutdown stops one.
 *
 * Everything goes through powershell.exe with fixed scripts. User input is
 * passed as data through environment variables, never pasted into a script.
 */

const WIN = process.platform === 'win32'

function ps(script, env = {}, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, ...env }, timeout, windowsHide: true, maxBuffer: 4 << 20 },
      (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim().slice(0, 400))) : resolve(stdout.trim())),
    )
  })
}

const psJson = async (script, env) => {
  const out = await ps(`${script} | ConvertTo-Json -Depth 4 -Compress`, env)
  return out ? JSON.parse(out) : null
}

const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])

/** CPU busy % over a short window, from os.cpus() tick counters. */
async function cpuPercent(ms = 400) {
  const snap = () => os.cpus().reduce((a, c) => {
    const t = Object.values(c.times).reduce((x, y) => x + y, 0)
    return { idle: a.idle + c.times.idle, total: a.total + t }
  }, { idle: 0, total: 0 })
  const a = snap()
  await new Promise((r) => setTimeout(r, ms))
  const b = snap()
  const total = b.total - a.total
  return total ? Math.round((1 - (b.idle - a.idle) / total) * 100) : 0
}

const BATTERY_STATUS = { 1: 'on battery', 2: 'plugged in', 3: 'full', 4: 'low', 5: 'critical', 6: 'charging', 7: 'charging', 8: 'charging', 9: 'charging', 11: 'partly charged' }

/** A snapshot of the machine. Shared with the dashboard endpoint. */
export async function systemSnapshot() {
  const [cpu, extra] = await Promise.all([
    cpuPercent(),
    WIN
      ? psJson(
          `$b = Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus,EstimatedRunTime
           $d = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { [pscustomobject]@{ drive=$_.DeviceID; sizeGB=[math]::Round($_.Size/1GB,1); freeGB=[math]::Round($_.FreeSpace/1GB,1) } }
           $n = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | ForEach-Object { [pscustomobject]@{ name=$_.Name; speed=$_.LinkSpeed } }
           [pscustomobject]@{ battery=$b; disks=@($d); network=@($n) }`,
        ).catch(() => null)
      : null,
  ])
  const total = os.totalmem()
  const free = os.freemem()
  const b = extra?.battery
  return {
    host: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
    cpu: { percent: cpu, cores: os.cpus().length, model: os.cpus()[0]?.model?.trim() },
    memory: { percent: Math.round(((total - free) / total) * 100), usedGB: +((total - free) / 1e9).toFixed(1), totalGB: +(total / 1e9).toFixed(1) },
    battery: b
      ? {
          percent: b.EstimatedChargeRemaining,
          status: BATTERY_STATUS[b.BatteryStatus] ?? 'unknown',
          minutesLeft: b.EstimatedRunTime && b.EstimatedRunTime < 71582788 ? b.EstimatedRunTime : null,
        }
      : null,
    disks: asList(extra?.disks).map((d) => ({ ...d, usedPercent: d.sizeGB ? Math.round((1 - d.freeGB / d.sizeGB) * 100) : null })),
    network: asList(extra?.network),
  }
}

/** Things that must not be started from a voice command: shells and script hosts. */
const NO_LAUNCH = /^(cmd|powershell|pwsh|wscript|cscript|mshta|rundll32|regsvr32|reg|regedit|bash|wsl|msiexec|schtasks|certutil|bitsadmin)(\.exe)?$/i
/** Things that must not be killed: Windows itself, and JARVIS. */
const NO_CLOSE = /^(system|idle|csrss|wininit|winlogon|lsass|services|smss|svchost|dwm|fontdrvhost|registry|memcompression|node|claude)(\.exe)?$/i

const VOLUME_CS = `
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext); int j();
  int GetMasterVolumeLevelScalar(out float pfLevel); int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class JarvisAudio {
  static IAudioEndpointVolume Vol() { var e = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator; IMMDevice d = null;
    Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d)); IAudioEndpointVolume v = null; var id = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, 0, out v)); return v; }
  public static float Volume { get { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(value, System.Guid.Empty)); } }
  public static bool Mute { get { bool m = false; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, System.Guid.Empty)); } }
}`

export function systemServer({ allowWrites = false, live = true, brain = null } = {}) {
  const tools = [
    tool(
      'get_system_status',
      'Live laptop stats: CPU %, memory, battery (percent, charging, minutes left), disks, network, uptime.',
      {},
      safe(async () => systemSnapshot()),
    ),
    tool(
      'list_running_apps',
      'Apps with a window open right now (name, window title, memory MB), heaviest first.',
      {},
      safe(async () =>
        asList(
          await psJson(
            `Get-Process | Where-Object { $_.MainWindowTitle } | Sort-Object WorkingSet64 -Descending | Select-Object -First 40 @{n='name';e={$_.ProcessName}},@{n='title';e={$_.MainWindowTitle}},@{n='memoryMB';e={[math]::Round($_.WorkingSet64/1MB)}}`,
          ),
        ),
      ),
    ),
  ]

  if (brain) {
    tools.push(
      tool(
        'get_brain',
        'Which brain JARVIS is thinking with now (cloud Claude or a local Ollama model), and the models available for each.',
        {},
        safe(async () => brain.describe()),
      ),
      tool(
        'switch_brain',
        'Switch JARVIS between cloud (Claude, strongest) and local (an Ollama model on this PC, free and offline but weaker), or pick a different model. Only when the user asks. The switch happens a few seconds after you reply, so say it in one line ("Switching to my local brain, sir. One moment.").',
        {
          mode: z.enum(['cloud', 'local']).optional(),
          cloud: z.string().optional().describe('Cloud model id, e.g. claude-fable-5-2 or claude-opus-5-5'),
          local: z.string().optional().describe('Local Ollama model name, e.g. qwen3.5:9b'),
        },
        safe(async (args) => brain.set(args)),
      ),
    )
  }

  if (allowWrites && WIN) {
    tools.push(
      tool(
        'launch_app',
        'Open an app by name or Start-menu name, e.g. "notepad", "spotify", "chrome", "calc", "Visual Studio Code", or a full path to an .exe/.lnk. Shells and script hosts are refused.',
        { name: z.string().min(1).max(260) },
        safe(async ({ name }) => {
          const bare = name.split(/[\\/]/).pop()
          if (NO_LAUNCH.test(bare)) throw new Error(`${bare} can't be launched by voice.`)
          // Try it as a command or path first; fall back to a Start-menu app by display name.
          const out = await ps(
            `try { Start-Process -FilePath $env:J_APP -ErrorAction Stop; 'started' }
             catch { $a = Get-StartApps | Where-Object { $_.Name -like "*$($env:J_APP)*" } | Select-Object -First 1
               if ($a) { Start-Process "shell:AppsFolder\\$($a.AppID)"; "started $($a.Name)" } else { throw "No app called $($env:J_APP)" } }`,
            { J_APP: name },
          )
          return { ok: true, result: out }
        }),
      ),
      tool(
        'launch_link',
        'Open a web page in the default browser (http or https only).',
        { url: z.string().url() },
        safe(async ({ url }) => {
          const u = new URL(url)
          if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https links.')
          await ps('Start-Process -FilePath $env:J_URL', { J_URL: u.href })
          return { ok: true, opened: u.href }
        }),
      ),
      tool(
        'close_app',
        'Close an app by its process name (from list_running_apps), e.g. "spotify". Asks it to close politely first; force only if the user said so. Windows system processes and JARVIS itself are refused.',
        { name: z.string().min(1).max(100), force: z.boolean().optional() },
        safe(async ({ name, force }) => {
          const proc = name.replace(/\.exe$/i, '')
          if (NO_CLOSE.test(proc)) throw new Error(`${proc} can't be closed from here.`)
          const out = await ps(
            `$p = Get-Process -Name $env:J_P -ErrorAction SilentlyContinue
             if (-not $p) { throw "$($env:J_P) isn't running" }
             if ($env:J_F -eq '1') { $p | Stop-Process -Force; "force-closed $($p.Count)" }
             else { $p | ForEach-Object { [void]$_.CloseMainWindow() }; "asked $($p.Count) window(s) to close" }`,
            { J_P: proc, J_F: force ? '1' : '0' },
          )
          return { ok: true, result: out }
        }),
      ),
      tool(
        'set_volume',
        'Set the speaker volume (0-100) and/or mute or unmute.',
        { level: z.number().min(0).max(100).optional(), mute: z.boolean().optional() },
        safe(async ({ level, mute }) => {
          const out = await ps(
            `Add-Type -TypeDefinition @'\n${VOLUME_CS}\n'@
             if ($env:J_L) { [JarvisAudio]::Volume = [float]$env:J_L / 100 }
             if ($env:J_M) { [JarvisAudio]::Mute = ($env:J_M -eq '1') }
             "{0}|{1}" -f [math]::Round([JarvisAudio]::Volume * 100), [JarvisAudio]::Mute`,
            { J_L: level == null ? '' : String(level), J_M: mute == null ? '' : mute ? '1' : '0' },
          )
          const [vol, muted] = out.split('|')
          return { volume: Number(vol), muted: muted === 'True' }
        }),
      ),
      tool(
        'lock_computer',
        'Lock the screen (the user signs back in with their PIN or password).',
        {},
        safe(async () => {
          await ps('rundll32.exe user32.dll,LockWorkStation')
          return { ok: true, locked: true }
        }),
      ),
    )

    if (live) {
      tools.push(
        tool(
          'sleep_computer',
          'Put the laptop to sleep now. Only when the user asked for it in this conversation; say goodbye first.',
          {},
          safe(async () => {
            // Give the reply a few seconds to be spoken before the machine drops.
            setTimeout(() => ps('rundll32.exe powrprof.dll,SetSuspendState 0,1,0').catch(() => {}), 6000)
            return { ok: true, sleepingInSeconds: 6 }
          }),
        ),
        tool(
          'schedule_shutdown',
          'Shut down or restart the laptop after a countdown (default 60 s, minimum 15). Only when the user asked for it in this conversation. Windows shows a notice; tell the user they can say "cancel the shutdown".',
          { action: z.enum(['shutdown', 'restart']), delaySeconds: z.number().int().min(15).max(86400).optional() },
          safe(async ({ action, delaySeconds = 60 }) => {
            const flag = action === 'restart' ? '/r' : '/s'
            await ps(`shutdown.exe ${flag} /t ${delaySeconds} /c "JARVIS: ${action} in ${delaySeconds} seconds. Say 'cancel the shutdown' to stop it."`)
            return { ok: true, action, inSeconds: delaySeconds, at: new Date(Date.now() + delaySeconds * 1000).toLocaleTimeString() }
          }),
        ),
        tool(
          'cancel_shutdown',
          'Cancel a pending shutdown or restart.',
          {},
          safe(async () => {
            await ps('shutdown.exe /a').catch((e) => {
              if (!/1116|not in progress/i.test(e.message)) throw e
            })
            return { ok: true, cancelled: true }
          }),
        ),
      )
    }
  }

  return createSdkMcpServer({ name: 'jarvis_system', version: '1.0.0', tools })
}
