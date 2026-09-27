# Reels

- Every frame is a pure function of `t`: no CSS transitions, timers or real-time animation, or renders drift. Add sound cues next to the timings they belong to.
- Before pushing a change, render previews of the scenes you touched and check them, then render the full video and watch it.
- A cut (`?cut=30`) is the same page with its own scene list. After touching shared timings, render every cut, and check an unchanged cut's stills are pixel-identical to the last commit's.
- A voiceover is one take cut into lines by silence detection. After a new take, re-measure the line spans and the word times the scenes sit on (README).
- Never commit `out/` or `node_modules/`. Deliver videos as files, not in Git.
- Ads state only facts with a source and a date. Prices carry "confirmed on booking" and are re-checked before posting.
- No third-party names, logos or trademarks (for example WhatsApp) in an ad, and no real person's name or likeness without their permission.
