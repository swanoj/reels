// Renders a reel folder (index.html with window.renderFrame and window.REEL) to an MP4.
//   node render.mjs <reel> preview 1.5,12,30   stills at those seconds -> out/<reel>/preview-<t>.png
//   node render.mjs <reel> captions             the captions alone -> out/<reel>.srt
//   node render.mjs <reel>                      every frame + synthesised sound (+ voiceover) -> out/<reel>.mp4 (+ .srt)
// A query picks another cut of the same reel: "playzone-bucks?cut=30" writes out/playzone-bucks-cut30.mp4.
// Needs Playwright's Chromium and ffmpeg (set FFMPEG to its path if it isn't on PATH).
// BITRATE defaults to 3500k: plenty for Instagram, and a minute of video stays under 30 MB.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const [target, mode, list] = process.argv.slice(2)
if (!target) throw new Error('usage: node render.mjs <reel>[?cut=30] [preview t1,t2,... | captions]')
const [reel, query] = target.split('?')
const name = query ? `${reel}-${query.replace(/[^a-z0-9]+/gi, '')}` : reel
const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const BITRATE = process.env.BITRATE || '3500k'
const out = path.join(here, 'out', name)
mkdirSync(out, { recursive: true })

const { chromium } = await import('playwright').catch(() => createRequire('/opt/node22/lib/node_modules/')('playwright'))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('requestfailed', (r) => errors.push('failed to load ' + r.url()))
await page.goto(pathToFileURL(path.join(here, reel, 'index.html')).href + (query ? '?' + query : ''))
// Load every face the page declares before the first frame, so no frame falls back to another font.
await page.evaluate(() => Promise.all([...document.fonts].map((f) => f.load())))
const { fps, duration, sounds, voice, captions } = await page.evaluate(() => window.REEL)
const subtitles = path.join(here, 'out', `${name}.srt`)

if (mode === 'captions') {
  if (!captions?.length) throw new Error(`${target} has no captions`)
  writeFileSync(subtitles, srt(captions, duration))
  console.log('wrote', path.relative(here, subtitles))
} else if (mode === 'preview') {
  for (const t of list.split(',').map(Number)) {
    await page.evaluate((t) => window.renderFrame(t), t)
    await page.screenshot({ path: path.join(out, `preview-${t}.png`) })
  }
} else {
  const frames = path.join(out, 'frames')
  rmSync(frames, { recursive: true, force: true })
  mkdirSync(frames)
  const total = Math.round(duration * fps)
  const started = Date.now()
  for (let i = 0; i < total; i++) {
    await page.evaluate((t) => window.renderFrame(t), i / fps)
    await page.screenshot({ path: path.join(frames, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 })
  }
  console.log(`${total} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`)

  writeFileSync(path.join(out, 'sound.wav'), wav(mix(synth(sounds, duration), voice)))
  const video = path.join(here, 'out', `${name}.mp4`)
  const input = ['-framerate', String(fps), '-i', path.join(frames, 'f%05d.jpg')]
  const x264 = ['-c:v', 'libx264', '-preset', 'slow', '-b:v', BITRATE, '-passlogfile', path.join(out, 'x264')]
  // Two passes at a fixed bitrate: film grain is noise, so quality-based encoding balloons the file.
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...input, ...x264, '-pass', '1', '-an', '-f', 'null', '/dev/null'])
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...input, '-i', path.join(out, 'sound.wav'), ...x264, '-pass', '2',
    '-maxrate', '5M', '-bufsize', '8M', '-pix_fmt', 'yuv420p', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '44100', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-shortest', '-movflags', '+faststart', video])
  console.log('wrote', path.relative(here, video))
  if (captions?.length) {
    writeFileSync(subtitles, srt(captions, duration))
    console.log('wrote', path.relative(here, subtitles))
  }
}
console.log(errors.length ? 'page errors:\n' + errors.join('\n') : 'no page errors')
await browser.close()

// Small synthesised cues (ticks, message pops, stamps), so a first cut needs no sound library.
function synth(cues, seconds, rate = 44100) {
  const buf = new Float32Array(Math.ceil(seconds * rate))
  let seed = 7
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  const add = (t0, len, f) => {
    const s0 = Math.round(t0 * rate)
    for (let i = 0; i < len * rate && s0 + i < buf.length; i++) buf[s0 + i] += f(i / rate)
  }
  const tau = 2 * Math.PI
  const kinds = {
    tick: (t) => add(t, 0.06, (x) => 0.16 * Math.exp(-70 * x) * Math.sin(tau * 1500 * x)),
    soft: (t) => add(t, 0.05, (x) => 0.06 * Math.exp(-80 * x) * Math.sin(tau * 2100 * x)),
    tock: (t) => add(t, 0.14, (x) => 0.15 * Math.exp(-38 * x) * Math.sin(tau * 880 * x)),
    pop: (t) => add(t, 0.12, (x) => 0.2 * Math.exp(-34 * x) * Math.sin(tau * (700 * x + 2500 * x * x))),
    send: (t) => add(t, 0.16, (x) => 0.14 * Math.sin(Math.PI * x / 0.16) * Math.sin(tau * (500 * x + 4000 * x * x))),
    thud: (t) => add(t, 0.28, (x) => 0.42 * Math.exp(-17 * x) * Math.sin(tau * 78 * x) + 0.16 * Math.exp(-60 * x) * noise()),
    reveal: (t) => add(t, 1.0, (x) => Math.min(1, x / 0.03) * Math.exp(-4.5 * x) * 0.06 * (Math.sin(tau * 1320 * x) + Math.sin(tau * 1980 * x))),
    swell: (t) => add(t, 2.6, (x) => Math.min(1, x / 0.06) * Math.exp(-1.5 * x) * 0.1 * (Math.sin(tau * 110 * x) + Math.sin(tau * 165 * x) + Math.sin(tau * 220 * x))),
  }
  for (const [t, kind] of cues) kinds[kind]?.(t)
  const peak = buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  if (peak > 0.9) for (let i = 0; i < buf.length; i++) buf[i] *= 0.9 / peak
  return { buf, rate }
}

// Lays the voiceover lines ({ at, from, to }, seconds) over the cues, and dips the cues to 45% while the voice speaks.
function mix({ buf, rate }, voice) {
  if (!voice) return { buf, rate }
  const pcm = execFileSync(FFMPEG, ['-loglevel', 'error', '-i', path.join(here, reel, voice.file), '-f', 'f32le', '-ac', '1', '-ar', String(rate), 'pipe:1'], { maxBuffer: 1 << 28 })
  const src = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length))
  const out = new Float32Array(buf.length)
  const duck = new Float32Array(buf.length).fill(1)
  const edge = Math.round(0.01 * rate)
  const ramp = Math.round(0.08 * rate)
  for (const { at, from, to } of voice.lines) {
    const s0 = Math.round(at * rate)
    const a = Math.round(from * rate)
    const n = Math.round((to - from) * rate)
    for (let i = 0; i < n && s0 + i < out.length && a + i < src.length; i++) out[s0 + i] += src[a + i] * Math.min(1, i / edge, (n - i) / edge)
    for (let i = -ramp; i < n + ramp; i++) {
      const j = s0 + i
      if (j < 0 || j >= duck.length) continue
      const away = i < 0 ? -i / ramp : i >= n ? (i - n) / ramp : 0
      duck[j] = Math.min(duck[j], 0.45 + 0.55 * away)
    }
  }
  for (let i = 0; i < out.length; i++) out[i] += buf[i] * duck[i]
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  if (peak > 0.95) for (let i = 0; i < out.length; i++) out[i] *= 0.95 / peak
  return { buf: out, rate }
}

// Captions ({ from, to, text }, seconds) as SubRip, the caption file Meta's ads and YouTube take beside a video.
// Each caption holds until the next when the gap is short, and for at least a second where there's room;
// a long one breaks onto two lines at the space nearest its middle.
function srt(captions, duration) {
  const stamp = (s) => {
    const ms = Math.round(s * 1000)
    const pad = (n, w = 2) => String(n).padStart(w, '0')
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
  }
  const lines = (text) => {
    if (text.length <= 38 || !text.includes(' ')) return text
    const spaces = [...text.matchAll(/ /g)].map((m) => m.index)
    const cut = spaces.reduce((a, b) => (Math.abs(b - text.length / 2) < Math.abs(a - text.length / 2) ? b : a))
    return text.slice(0, cut) + '\n' + text.slice(cut + 1)
  }
  return captions.map(({ from, to, text }, i) => {
    const next = captions[i + 1]?.from ?? duration
    const end = next - to < 0.6 ? next - 0.08 : Math.min(Math.max(to, from + 1), next - 0.08)
    return `${i + 1}\n${stamp(from)} --> ${stamp(end)}\n${lines(text)}\n`
  }).join('\n')
}

function wav({ buf, rate }) {
  const data = Buffer.alloc(buf.length * 2)
  buf.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2))
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8)
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34)
  head.write('data', 36); head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}
