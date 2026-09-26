// Timeline helpers for reels. Every visual is a pure function of the time t (seconds),
// so a frame renders the same way however it is reached, and render.mjs can step through them.
window.Reel = (() => {
  const $ = (id) => document.getElementById(id)
  const clamp01 = (x) => Math.max(0, Math.min(1, x))
  const ease = (x) => 1 - Math.pow(1 - x, 3)
  const prog = (t, start, dur) => ease(clamp01((t - start) / dur))

  // Fade in and rise into place. `el.dataset.base` keeps any transform the element already needs.
  function show(el, t, start, dur = 0.35, rise = 18) {
    const p = prog(t, start, dur)
    el.style.opacity = p
    el.style.transform = `${el.dataset.base || ''} translateY(${(1 - p) * rise}px)`
    return p
  }

  function type(el, text, t, start, dur) {
    el.textContent = text.slice(0, Math.floor(clamp01((t - start) / dur) * text.length))
  }

  // Scenes are [id, start, end]; each fades out over its last `fade` seconds.
  function scenes(list, t, fade = 0.3) {
    for (const [id, start, end, keep] of list) {
      const el = $(id)
      const on = t >= start && t < end
      el.style.display = on ? 'block' : 'none'
      el.style.opacity = keep ? 1 : clamp01((end - t) / fade)
    }
  }

  // Steps through `values` at `times`, rolling each change over `dur` seconds.
  function steps(times, values, t, from = 0, dur = 0.3) {
    let i = -1
    while (i + 1 < times.length && t >= times[i + 1]) i++
    if (i < 0) return from
    const prev = i === 0 ? from : values[i - 1]
    return prev + (values[i] - prev) * prog(t, times[i], dur)
  }

  const fmt = (n) => Math.round(n).toLocaleString('en-AU')

  function icon(name, size = 56) {
    return (window.ICONS[name] || '').replace('width="24" height="24"', `width="${size}" height="${size}"`)
  }

  // Seeded film grain, so every render of a frame is identical.
  function grain(canvas, frame) {
    const g = canvas.getContext('2d')
    const img = grain.img || (grain.img = g.createImageData(canvas.width, canvas.height))
    let s = ((frame + 1) * 2654435761) >>> 0
    for (let i = 0; i < img.data.length; i += 4) {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0
      img.data[i] = img.data[i + 1] = img.data[i + 2] = s & 255
      img.data[i + 3] = 255
    }
    g.putImageData(img, 0, 0)
  }

  // A group chat whose messages arrive at set times and slide the thread up as they land.
  // messages: [{ at, from, text, time, out }]; members: header subtitle when nobody is typing.
  function chat(root, { title, avatar, members, messages }) {
    root.innerHTML = `
      <div class="chat-head"><div class="chat-avatar">${avatar}</div>
        <div><div class="chat-title">${title}</div><div class="chat-sub"></div></div></div>
      <div class="chat-body"><div class="chat-stack"></div></div>`
    const stack = root.querySelector('.chat-stack')
    const sub = root.querySelector('.chat-sub')
    const colours = {}
    const palette = ['#53bdeb', '#ff8f6b', '#a5b337', '#ffd279', '#e26ab6', '#5bd6a5', '#c792ff']
    const nodes = messages.map((m) => {
      if (!m.out && !(m.from in colours)) colours[m.from] = palette[Object.keys(colours).length % palette.length]
      const el = document.createElement('div')
      el.className = 'msg' + (m.out ? ' out' : '')
      el.innerHTML = (m.out ? '' : `<div class="msg-from" style="color:${colours[m.from]}">${m.from}</div>`) +
        `<div class="msg-text">${m.text}<span class="msg-time">${m.time}${m.out ? ' <span class="ticks">✓✓</span>' : ''}</span></div>`
      el.style.display = 'none'
      stack.appendChild(el)
      return el
    })
    return (t) => {
      let newest = -1
      nodes.forEach((el, i) => {
        const on = t >= messages[i].at
        el.style.display = on ? 'block' : 'none'
        if (on) newest = i
      })
      nodes.forEach((el, i) => { el.style.opacity = i === newest ? prog(t, messages[i].at, 0.18) : 1 })
      const p = newest < 0 ? 1 : prog(t, messages[newest].at, 0.22)
      const h = newest < 0 ? 0 : nodes[newest].offsetHeight + 14
      stack.style.transform = `translateY(${(1 - p) * h}px)`
      const next = messages.find((m) => !m.out && t < m.at && t >= m.at - 0.5)
      sub.textContent = next ? `${next.from} is typing…` : members
      sub.classList.toggle('typing', Boolean(next))
    }
  }

  return { $, clamp01, ease, prog, show, type, scenes, steps, fmt, icon, grain, chat }
})()
