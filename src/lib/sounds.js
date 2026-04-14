// src/lib/sounds.js
// Sons synthétiques via Web Audio API — zéro fichier externe

let ctx = null

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  // Reprendre si suspendu (politique autoplay navigateur)
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function play(fn) {
  try { fn(getCtx()) } catch (e) { /* silencieux si audio non dispo */ }
}

// ── Utilitaires ───────────────────────────────────────────────────────────────

function osc(ctx, type, freq, start, duration, gainVal = 0.3, fadeOut = true) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(gainVal, start)
  if (fadeOut) g.gain.exponentialRampToValueAtTime(0.001, start + duration)
  g.connect(ctx.destination)

  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, start)
  o.connect(g)
  o.start(start)
  o.stop(start + duration)
}

function note(ctx, freq, start, duration, gainVal = 0.25) {
  osc(ctx, 'sine', freq, start, duration, gainVal)
}

// ── Sons ──────────────────────────────────────────────────────────────────────

// Clic bouton — tick léger
export function soundClick() {
  play(ctx => {
    const t = ctx.currentTime
    osc(ctx, 'sine', 880, t, 0.06, 0.15)
    osc(ctx, 'sine', 1100, t + 0.02, 0.04, 0.08)
  })
}

// Clic bouton primaire — un peu plus affirmé
export function soundClickPrimary() {
  play(ctx => {
    const t = ctx.currentTime
    osc(ctx, 'sine', 660, t, 0.05, 0.2)
    osc(ctx, 'sine', 990, t + 0.03, 0.07, 0.15)
  })
}

// Soumission d'argument — confirmation satisfaisante
export function soundSubmit() {
  play(ctx => {
    const t = ctx.currentTime
    note(ctx, 523, t,        0.1, 0.2)   // Do
    note(ctx, 659, t + 0.08, 0.1, 0.2)   // Mi
    note(ctx, 784, t + 0.16, 0.18, 0.25) // Sol
  })
}

// Nouveau message / notif — ping doux
export function soundMessage() {
  play(ctx => {
    const t = ctx.currentTime
    osc(ctx, 'sine', 1046, t,        0.12, 0.18)
    osc(ctx, 'sine', 1318, t + 0.07, 0.1,  0.12)
  })
}

// Ton tour — alerte douce mais claire
export function soundMyTurn() {
  play(ctx => {
    const t = ctx.currentTime
    note(ctx, 784, t,        0.1,  0.3)
    note(ctx, 784, t + 0.15, 0.1,  0.3)
    note(ctx, 1046, t + 0.3, 0.2,  0.4)
  })
}

// Commentaire IA — son mystérieux/électronique
export function soundAI() {
  play(ctx => {
    const t = ctx.currentTime
    osc(ctx, 'sawtooth', 220, t,        0.15, 0.08)
    osc(ctx, 'sawtooth', 330, t + 0.1,  0.15, 0.08)
    osc(ctx, 'sine',     660, t + 0.2,  0.2,  0.15)
    osc(ctx, 'sine',     880, t + 0.35, 0.15, 0.12)
  })
}

// Nouveau round — fanfare épique courte
export function soundNewRound() {
  play(ctx => {
    const t = ctx.currentTime
    // Accord de fanfare montant
    note(ctx, 392, t,        0.15, 0.35) // Sol
    note(ctx, 523, t + 0.12, 0.15, 0.35) // Do
    note(ctx, 659, t + 0.24, 0.15, 0.35) // Mi
    note(ctx, 784, t + 0.36, 0.3,  0.5)  // Sol octave
    // Harmonie
    note(ctx, 523, t + 0.36, 0.3,  0.3)
    note(ctx, 659, t + 0.36, 0.3,  0.3)
    // Coup de caisse (bruit blanc court)
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.3, t + 0.36)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.44)
    src.connect(g)
    g.connect(ctx.destination)
    src.start(t + 0.36)
  })
}

// Fin de débat — résolution finale
export function soundDebateEnd() {
  play(ctx => {
    const t = ctx.currentTime
    note(ctx, 523, t,        0.2, 0.3)
    note(ctx, 659, t + 0.15, 0.2, 0.3)
    note(ctx, 784, t + 0.3,  0.2, 0.3)
    note(ctx, 1046, t + 0.45, 0.4, 0.5)
    note(ctx, 784,  t + 0.45, 0.4, 0.3)
    note(ctx, 659,  t + 0.45, 0.4, 0.2)
  })
}

// ── Text-to-Speech (Web Speech API) ─────────────────────────────────────────

let activeSpeech = null
let resumeTimer = null

function getBestFrVoice() {
  const voices = window.speechSynthesis.getVoices()
  return (
    voices.find(v => v.lang === 'fr-FR' && v.localService) ||
    voices.find(v => v.lang === 'fr-FR') ||
    voices.find(v => v.lang.startsWith('fr')) ||
    null
  )
}

function doSpeak(text) {
  window.speechSynthesis.cancel()
  clearInterval(resumeTimer)

  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'fr-FR'
  utter.rate = 1.05
  const voice = getBestFrVoice()
  if (voice) utter.voice = voice

  // Workaround bug iOS + Android PWA : speechSynthesis se coupe sur les longs textes
  resumeTimer = setInterval(() => {
    if (!window.speechSynthesis.speaking) { clearInterval(resumeTimer); return }
    window.speechSynthesis.pause()
    window.speechSynthesis.resume()
  }, 10000)

  utter.onend = () => { activeSpeech = null; clearInterval(resumeTimer) }
  utter.onerror = () => { activeSpeech = null; clearInterval(resumeTimer) }
  activeSpeech = text
  window.speechSynthesis.speak(utter)
}

function waitForVoicesThenSpeak(text, attempts = 0) {
  const voices = window.speechSynthesis.getVoices()
  if (voices.length > 0 || attempts >= 20) {
    doSpeak(text)
    return
  }
  // Polling 50ms — fiable sur Android Chrome où onvoiceschanged ne se déclenche pas
  setTimeout(() => waitForVoicesThenSpeak(text, attempts + 1), 50)
}

export function speak(text) {
  if (!window.speechSynthesis) return
  // Toggle : même texte en cours → stop
  if (activeSpeech === text && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel()
    clearInterval(resumeTimer)
    activeSpeech = null
    return
  }
  waitForVoicesThenSpeak(text)
}

// Vote enregistré — petit ding
export function soundVote() {
  play(ctx => {
    const t = ctx.currentTime
    osc(ctx, 'sine', 1318, t,        0.08, 0.2)
    osc(ctx, 'sine', 1760, t + 0.06, 0.12, 0.18)
  })
}
