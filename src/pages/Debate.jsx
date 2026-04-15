import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/AppContext'
import { supabase, updateChannelStatus, callGroq } from '../lib/supabase'
import { soundSubmit, soundMessage, soundMyTurn, soundAI, soundNewRound, soundDebateEnd, soundClick, speak } from '../lib/sounds'

export default function Debate() {
  const navigate = useNavigate()
  const { channel, member, members, showToast } = useApp()
  const [turns, setTurns]               = useState([])
  const [commentaries, setCommentaries] = useState([])
  const [readyList, setReadyList]       = useState([])
  const [currentText, setCurrentText]   = useState('')
  const [submitting, setSubmitting]     = useState(false)
  const [round, setRound]               = useState(1)
  const [roundAnim, setRoundAnim]       = useState(null)
  const [generatingCommentary, setGeneratingCommentary] = useState(false)
  const [waitingReady, setWaitingReady] = useState(false)
  const [speakerIndex, setSpeakerIndex] = useState(0)
  const [turnStartedAt, setTurnStartedAt] = useState(null)
  const [displayTimer, setDisplayTimer] = useState(0)
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState(() => {
    try { return localStorage.getItem(`brainstorm-${channel?.id}-${member?.id}`) || '' } catch { return '' }
  })
  const [readingTurn, setReadingTurn] = useState(null)   // { turnId, memberCount, readList }
  const [turnReadList, setTurnReadList] = useState([])
  const lastTurnKeyRef = useRef(null)

  const scrollRef      = useRef(null)
  const timerRef       = useRef(null)
  const prevRound      = useRef(1)
  const autoSubmitRef  = useRef(false)
  const generatingRef  = useRef(false)
  const loadingRef     = useRef(false)
  const pendingRef     = useRef(false)
  
  const currentTextRef = useRef('')
  const roundRef = useRef(1)

  const MAX_ROUNDS    = channel?.max_rounds    || 3
  const TURN_DURATION = channel?.turn_duration || 90
  const MAX_CHARS      = channel?.max_chars     || 500

  const sortedMembers  = [...members].sort((a, b) => new Date(a.joined_at) - new Date(b.joined_at))
  const currentSpeaker = sortedMembers[speakerIndex] || null
  const isMyTurn       = currentSpeaker?.id === member?.id && !waitingReady

  useEffect(() => {
    clearInterval(timerRef.current)
    if (waitingReady || readingTurn || !turnStartedAt) return

    // Crée une clé unique pour ce tour (speaker + timestamp) pour éviter les faux resets
    const turnKey = `${speakerIndex}-${turnStartedAt}`
    if (lastTurnKeyRef.current !== turnKey) {
      lastTurnKeyRef.current = turnKey
      autoSubmitRef.current = false
      if (isMyTurn) {
        setCurrentText('')
        currentTextRef.current = ''
      }
    }

    if (isMyTurn) soundMyTurn()

    function tick() {
      const elapsed = Math.floor((Date.now() - new Date(turnStartedAt).getTime()) / 1000)
      const remaining = Math.max(0, TURN_DURATION - elapsed)
      setDisplayTimer(remaining)

      if (remaining === 0 && isMyTurn && !autoSubmitRef.current) {
        autoSubmitRef.current = true
        clearInterval(timerRef.current)
        handleAutoSubmit()
      }
    }

    tick()
    timerRef.current = setInterval(tick, 1000)
    return () => clearInterval(timerRef.current)
  }, [turnStartedAt, isMyTurn, waitingReady, readingTurn])

  useEffect(() => {
    if (!channel) { navigate('/', { replace: true }); return }
    if (channel.status === 'ai_summary') { navigate('/summary', { replace: true }); return }
  }, [channel])

  useEffect(() => {
    if (!channel) return
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('channels')
        .select('status,current_speaker_index,turn_started_at')
        .eq('id', channel.id)
        .single()
      if (!data) return
      if (data.status === 'ai_summary') navigate('/summary', { replace: true })
      setSpeakerIndex(data.current_speaker_index ?? 0)
      setTurnStartedAt(data.turn_started_at)
    }, 2000)
    return () => clearInterval(interval)
  }, [channel?.id])

  useEffect(() => {
    if (!channel) return
    loadAll()
    const turnSub = supabase.channel(`turns:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'debate_turns', filter: `channel_id=eq.${channel.id}` }, loadAll).subscribe()
    const commSub = supabase.channel(`commentaries:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'round_commentaries', filter: `channel_id=eq.${channel.id}` }, loadAll).subscribe()
    const readySub = supabase.channel(`ready:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'round_ready', filter: `channel_id=eq.${channel.id}` }, loadAll).subscribe()
    const readSub = supabase.channel(`turn_read:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'turn_read', filter: `channel_id=eq.${channel.id}` }, loadAll).subscribe()
    return () => {
      supabase.removeChannel(turnSub)
      supabase.removeChannel(commSub)
      supabase.removeChannel(readySub)
      supabase.removeChannel(readSub)
    }
  }, [channel?.id])

  function scrollToBottom() {
    setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, 50)
  }

  async function loadAll() {
    if (loadingRef.current) { pendingRef.current = true; return }
    loadingRef.current = true
    pendingRef.current = false
    try {
      const [turnsRes, commRes, membersRes, readyRes, channelRes, turnReadRes] = await Promise.all([
        supabase.from('debate_turns').select('*').eq('channel_id', channel.id).order('submitted_at'),
        supabase.from('round_commentaries').select('*').eq('channel_id', channel.id).order('round'),
        supabase.from('members').select('*').eq('channel_id', channel.id).order('joined_at'),
        supabase.from('round_ready').select('*').eq('channel_id', channel.id),
        supabase.from('channels').select('current_speaker_index,turn_started_at').eq('id', channel.id).single(),
        supabase.from('turn_read').select('*').eq('channel_id', channel.id)
      ])

      const data = turnsRes.data || []
      const comms = commRes.data || []
      const ready = readyRes.data || []
      const allMembers = membersRes.data || []
      const turnReads = turnReadRes.data || []
      const memberCount = allMembers.length || members.length
      const chData = channelRes.data
      const dbIndex = chData?.current_speaker_index ?? 0
      const dbStartedAt = chData?.turn_started_at ?? null

      if (data.length > turns.length) soundMessage()
      if (comms.length > commentaries.length) soundAI()

      setSpeakerIndex(dbIndex)
      setTurnStartedAt(dbStartedAt)
      setTurns(data)
      setCommentaries(comms)
      setReadyList(ready)
      setTurnReadList(turnReads)
      scrollToBottom()

      const maxRound = data.length > 0 ? Math.max(...data.map(t => t.round)) : 1
      const roundTurns = data.filter(t => t.round === maxRound)
      const allSubmitted = roundTurns.length >= memberCount

      if (allSubmitted) {
        const commentaryExists = comms.some(c => c.round === maxRound)
        if (!commentaryExists && member?.is_host && !generatingRef.current) {
          generatingRef.current = true
          setGeneratingCommentary(true)
          await generateCommentary(maxRound, roundTurns)
          return
        }
        if (commentaryExists) {
          const allReady = ready.filter(r => r.round === maxRound).length >= memberCount
          if (allReady && maxRound < MAX_ROUNDS) {
            const newRound = maxRound + 1
            setWaitingReady(false)
            if (newRound !== prevRound.current) {
              prevRound.current = newRound
              setRoundAnim(newRound)
              setTimeout(() => setRoundAnim(null), 2500)
            }
            setRound(newRound)
            roundRef.current = newRound
            soundNewRound()
            if (member?.is_host) {
              const now = new Date().toISOString()
              await supabase.from('channels').update({ current_speaker_index: 0, turn_started_at: now }).eq('id', channel.id)
            }
          } else if (allReady && maxRound >= MAX_ROUNDS) {
            setWaitingReady(false)
            soundDebateEnd()
            if (member?.is_host) await updateChannelStatus(channel.id, 'ai_summary')
          } else {
            setWaitingReady(true)
            setRound(maxRound)
          }
        }
      } else {
        const currentSpeakerInDb = allMembers[dbIndex]
        const currentSpeakerDone = currentSpeakerInDb ? roundTurns.some(t => t.member_id === currentSpeakerInDb.id) : false

        if (currentSpeakerDone) {
          const lastTurn = roundTurns.find(t => t.member_id === currentSpeakerInDb.id)
          const nextIndex = dbIndex + 1
          const isLastOfRound = nextIndex >= memberCount

          if (!isLastOfRound) {
            // Phase lecture : attendre que tous aient lu avant de passer au suivant
            const readsForTurn = turnReads.filter(r => r.turn_id === lastTurn?.id)
            const allRead = readsForTurn.length >= memberCount
            if (allRead) {
              const now = new Date().toISOString()
              const { error } = await supabase.from('channels')
                .update({ current_speaker_index: nextIndex, turn_started_at: now })
                .eq('id', channel.id)
                .eq('current_speaker_index', dbIndex)
              if (!error) { setSpeakerIndex(nextIndex); setTurnStartedAt(now) }
              setReadingTurn(null)
            } else {
              setReadingTurn({ turnId: lastTurn?.id, readList: readsForTurn })
            }
          } else {
            setReadingTurn(null)
          }
        } else {
          setReadingTurn(null)
        }
        setWaitingReady(comms.some(c => c.round === maxRound))
        setRound(maxRound)
        roundRef.current = maxRound
      }
    } finally {
      loadingRef.current = false
      if (pendingRef.current) { pendingRef.current = false; loadAll() }
    }
  }

  async function generateCommentary(roundNum, roundTurns) {
    try {
      const res = await callGroq('round_commentary', {
        topic: channel.topic, round: roundNum,
        turns: roundTurns.map(t => ({ name: t.member_name, content: t.content }))
      })
      await supabase.from('round_commentaries').insert({ channel_id: channel.id, round: roundNum, content: res?.result || '' })
    } catch (e) { console.error(e) } finally { generatingRef.current = false; setGeneratingCommentary(false) }
  }

  async function handleAutoSubmit() {
    const text = currentTextRef.current.trim()
    const content = text || '[Temps écoulé — pas de réponse]'
    
    try {
      await supabase.from('debate_turns').insert({
        channel_id: channel.id, member_id: member.id, member_name: member.name,
        round: roundRef.current, content
      })
      setCurrentText('')
      currentTextRef.current = ''
      if (!text) showToast('⏰ Temps écoulé, message vide envoyé')
      else showToast('⏰ Temps écoulé — argument envoyé tel quel')
      loadAll()
    } catch (e) { showToast('Erreur : ' + e.message) }
  }

  async function handleSubmit() {
    if (!currentText.trim()) return showToast('Écris quelque chose !')
    if (submitting) return
    clearInterval(timerRef.current)
    autoSubmitRef.current = true
    setSubmitting(true)
    try {
      await supabase.from('debate_turns').insert({
        channel_id: channel.id, member_id: member.id, member_name: member.name,
        round, content: currentText.trim()
      })
      setCurrentText('')
      currentTextRef.current = ''
      showToast('Argument soumis ✅')
      loadAll()
    } catch (e) { showToast('Erreur : ' + e.message) } finally { setSubmitting(false) }
  }

  async function handleReady() {
    const maxRound = turns.length > 0 ? Math.max(...turns.map(t => t.round)) : 1
    await supabase.from('round_ready').upsert({ channel_id: channel.id, member_id: member.id, round: maxRound })
  }

  async function handleRead() {
    if (!readingTurn?.turnId) return
    await supabase.from('turn_read').upsert({ channel_id: channel.id, turn_id: readingTurn.turnId, member_id: member.id })
  }

  const noteTagsRef = useRef(null)

  const PASTEL_COLORS = [
    { bg: 'rgba(255,182,193,0.18)', border: 'rgba(255,182,193,0.5)', text: '#ffb6c1' },
    { bg: 'rgba(180,220,255,0.18)', border: 'rgba(180,220,255,0.5)', text: '#a8d8ff' },
    { bg: 'rgba(180,255,200,0.18)', border: 'rgba(180,255,200,0.5)', text: '#90f0a8' },
    { bg: 'rgba(255,220,120,0.18)', border: 'rgba(255,220,120,0.5)', text: '#ffd878' },
    { bg: 'rgba(220,180,255,0.18)', border: 'rgba(220,180,255,0.5)', text: '#d4b0ff' },
    { bg: 'rgba(255,200,150,0.18)', border: 'rgba(255,200,150,0.5)', text: '#ffcc96' },
  ]

  function saveNote(val) {
    setNoteText(val)
    try { localStorage.setItem(`brainstorm-${channel?.id}-${member?.id}`, val) } catch {}
    setTimeout(() => {
      if (noteTagsRef.current) noteTagsRef.current.scrollTop = noteTagsRef.current.scrollHeight
    }, 20)
  }

  const MEMBER_COLORS = [
    { bg: 'rgba(251,146,60,0.15)',  border: 'rgba(251,146,60,0.5)',  name: '#fb923c' },
    { bg: 'rgba(34,197,94,0.15)',   border: 'rgba(34,197,94,0.5)',   name: '#4ade80' },
    { bg: 'rgba(236,72,153,0.15)',  border: 'rgba(236,72,153,0.5)',  name: '#f472b6' },
    { bg: 'rgba(14,165,233,0.15)',  border: 'rgba(14,165,233,0.5)',  name: '#38bdf8' },
    { bg: 'rgba(250,204,21,0.15)',  border: 'rgba(250,204,21,0.5)',  name: '#facc15' },
  ]
  function getMemberColor(memberId) {
    const idx = sortedMembers.findIndex(m => m.id === memberId)
    return MEMBER_COLORS[(idx < 0 ? 0 : idx) % MEMBER_COLORS.length]
  }
  const timerUrgent = displayTimer < 20 && displayTimer > 0 && !!turnStartedAt
  const timerExpired = displayTimer === 0 && !!turnStartedAt
  const feed = []
  for (let r = 1; r <= MAX_ROUNDS; r++) {
    turns.filter(t => t.round === r).forEach(t => feed.push({ type: 'turn', data: t }))
    const comm = commentaries.find(c => c.round === r)
    if (comm) feed.push({ type: 'commentary', data: comm })
    else if (generatingCommentary && r === round - 1) feed.push({ type: 'loading', round: r })
  }

  if (!channel) return null
  const turnsThisRound = turns.filter(t => t.round === round)
  const myTurnDone = turnsThisRound.some(t => t.member_id === member?.id)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', position: 'fixed', width: '100%', top: 0, left: 0 }}>
      {roundAnim && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,15,26,0.92)', animation: 'fadeInOut 2.5s ease forwards' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1rem', color: 'var(--accent)', letterSpacing: '0.3em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>⚔️ Nouveau tour</div>
            <div style={{ fontSize: '5rem', fontWeight: 900, color: 'var(--text)', lineHeight: 1 }}>Round {roundAnim}</div>
          </div>
        </div>
      )}

      {isMyTurn && !myTurnDone && !readingTurn && (
        <div key={turnStartedAt} style={{ position: 'fixed', inset: 0, zIndex: 998, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', animation: 'myTurnPulse 1s ease forwards' }}>
          <div style={{ textAlign: 'center', padding: '1.5rem 2.5rem', background: 'rgba(251,146,60,0.15)', border: '2px solid rgba(251,146,60,0.6)', borderRadius: 20 }}>
            <div style={{ fontSize: '2.5rem' }}>🎤</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#fb923c', marginTop: '0.4rem' }}>C'est ton tour !</div>
          </div>
        </div>
      )}

      <div style={{ padding: '0.75rem 1.25rem', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', flexShrink: 0, position: 'sticky', top: 0, zIndex: 10 }}>
        <div className="flex items-center justify-between">
          <div style={{ flex: 1, marginRight: '0.75rem' }}>
            <div className="badge badge-accent" style={{ marginBottom: '0.25rem' }}>⚔️ Débat</div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text)', lineHeight: 1.3, fontWeight: 600 }}>{channel.topic}</p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="badge badge-warn">Tour {Math.min(round, MAX_ROUNDS)}/{MAX_ROUNDS}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.3rem', justifyContent: 'flex-end' }}>
              {sortedMembers.map((m, i) => {
                const hasTurn = turnsThisRound.some(t => t.member_id === m.id)
                const isCurrent = i === speakerIndex && !waitingReady
                return (
                  <div key={m.id} style={{
                    width: 26, height: 26, borderRadius: '50%',
                    background: hasTurn ? 'var(--success)' : isCurrent ? 'var(--accent)' : 'var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.6rem', fontWeight: 700, color: 'var(--bg)',
                    border: isCurrent ? '2px solid white' : 'none', transition: 'all 0.3s'
                  }}>{m.name[0]}</div>
                )
              })}
            </div>
          </div>
        </div>

        {!waitingReady && !readingTurn && currentSpeaker && (
          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '0.75rem', color: isMyTurn ? 'var(--accent)' : 'var(--text2)' }}>
                {isMyTurn ? '🎤 Ton tour !' : `🎤 ${currentSpeaker.name} parle…`}
              </span>
              <span className={`timer ${timerUrgent ? 'urgent' : ''}`} style={{ fontSize: '1rem' }}>
                {timerExpired ? '⏰' : `${Math.floor(displayTimer / 60)}:${String(displayTimer % 60).padStart(2, '0')}`}
              </span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{
                width: `${(displayTimer / TURN_DURATION) * 100}%`,
                background: timerUrgent ? 'var(--danger)' : undefined, transition: 'width 1s linear'
              }} />
            </div>
          </div>
        )}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {feed.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem 0' }}>
            <p style={{ fontSize: '2rem' }}>💬</p>
            <p className="text-muted text-sm" style={{ marginTop: '0.5rem' }}>Le débat commence…</p>
          </div>
        )}
        {feed.map((item) => {
          if (item.type === 'turn') {
            const t = item.data
            const mc = getMemberColor(t.member_id)
            return (
              <div key={t.id} style={{ background: mc.bg, border: `1px solid ${mc.border}`, borderRadius: 'var(--radius)', padding: '0.75rem' }}>
                <div className="turn-meta">
                  <div className="avatar" style={{ width: 22, height: 22, fontSize: '0.7rem', background: mc.border }}>{t.member_name[0]}</div>
                  <strong style={{ color: mc.name }}>{t.member_name}</strong>
                  <span className="badge" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', background: mc.border, color: 'var(--bg)' }}>R{t.round}</span>
                  <button onClick={() => speak(t.content)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', opacity: 0.6 }} title="Écouter">🔊</button>
                </div>
                <p style={{ fontSize: '0.9rem', lineHeight: 1.5, marginTop: '0.4rem' }}>{t.content}</p>
              </div>
            )
          }
          if (item.type === 'commentary') return (
            <div key={`comm-${item.data.round}`} style={{ padding: '1rem', background: 'rgba(124,106,247,0.08)', borderRadius: 'var(--radius)', border: '1px solid var(--accent)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.1em' }}>📺 COMMENTATEUR — ROUND {item.data.round}</div>
                <button onClick={() => speak(item.data.content)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', opacity: 0.6 }} title="Écouter">🔊</button>
              </div>
              <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text)', fontStyle: 'italic' }}>{item.data.content}</p>
            </div>
          )
          if (item.type === 'loading') return (
            <div key={`loading-${item.round}`} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem', background: 'rgba(124,106,247,0.08)', borderRadius: 'var(--radius)', border: '1px solid var(--accent)' }}>
              <span style={{ fontSize: '1.5rem' }}>📺</span>
              <div><div style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '0.25rem' }}>ANALYSE EN COURS…</div><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /></div>
            </div>
          )
          return null
        })}
      </div>

      <div style={{ background: 'var(--bg2)', borderTop: '1px solid var(--border)', padding: '0.75rem 1.25rem', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)', flexShrink: 0 }}>
        {/* Bloc-notes brainstorming */}
        {noteOpen && (
          <div style={{ marginBottom: '0.75rem', background: 'rgba(15,15,26,0.95)', border: '1px solid rgba(255,220,80,0.25)', borderRadius: 'var(--radius)', padding: '0.6rem 0.75rem', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'rgba(255,220,80,0.9)', letterSpacing: '0.08em' }}>✏️ BROUILLON</span>
              {noteText.trim() && (
                <button onClick={() => saveNote('')} style={{ fontSize: '0.65rem', opacity: 0.45, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text2)' }}>🗑 Effacer</button>
              )}
            </div>
            {/* Tags par ligne */}
            {noteText.trim() && (
              <div ref={noteTagsRef} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', maxHeight: 90, overflowY: 'auto', marginBottom: '0.5rem' }}>
                {noteText.split('\n').filter(l => l.trim()).map((line, i) => {
                  const c = PASTEL_COLORS[i % PASTEL_COLORS.length]
                  const trimmed = line.trim()
                  return (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: c.bg, border: `1px solid ${c.border}`, color: c.text, borderRadius: 20, padding: '0.2rem 0.5rem 0.2rem 0.65rem', fontSize: '0.8rem', lineHeight: 1.4, wordBreak: 'break-word', cursor: 'pointer' }}
                      onClick={() => {
                        if (!isMyTurn || myTurnDone) return
                        const next = currentText ? currentText + ' ' + trimmed : trimmed
                        setCurrentText(next)
                        currentTextRef.current = next
                      }}
                    >
                      {trimmed}
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          const lines = noteText.split('\n')
                          const filtered = lines.filter((_, idx) => {
                            let count = -1
                            for (let j = 0; j <= idx; j++) if (lines[j].trim()) count++
                            return count !== i
                          })
                          saveNote(filtered.join('\n'))
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.text, opacity: 0.6, fontSize: '0.75rem', padding: 0, lineHeight: 1, flexShrink: 0 }}
                      >×</button>
                    </span>
                  )
                })}
              </div>
            )}
            <textarea
              placeholder="Une idée par ligne…"
              value={noteText}
              onChange={e => saveNote(e.target.value)}
              rows={2}
              style={{ width: '100%', background: 'transparent', border: 'none', borderTop: noteText.trim() ? '1px solid rgba(255,255,255,0.06)' : 'none', outline: 'none', resize: 'none', fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--text2)', fontFamily: 'inherit', padding: noteText.trim() ? '0.4rem 0 0' : 0, marginTop: noteText.trim() ? '0.4rem' : 0 }}
            />
          </div>
        )}
        {readingTurn ? (() => {
          const iHaveRead = readingTurn.readList.some(r => r.member_id === member?.id)
          const readCount = readingTurn.readList.length
          return (
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>📖 Prends le temps de lire l'argument…</p>
              <button className="btn btn-primary" onClick={handleRead} disabled={iHaveRead}>
                {iHaveRead ? `✅ Lu (${readCount}/${members.length})` : '✅ J\'ai lu — au suivant'}
              </button>
            </div>
          )
        })() : isMyTurn && !myTurnDone ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text2)' }}>Ton argument</span>
              <button
                onClick={() => setNoteOpen(o => !o)}
                style={{ background: noteOpen ? 'rgba(255,220,80,0.15)' : 'rgba(255,255,255,0.05)', border: `1px solid ${noteOpen ? 'rgba(255,220,80,0.4)' : 'var(--border)'}`, borderRadius: 6, padding: '0.2rem 0.6rem', cursor: 'pointer', fontSize: '0.75rem', color: noteOpen ? 'rgba(255,220,80,0.9)' : 'var(--text2)', fontWeight: 600 }}>
                ✏️ {noteOpen ? 'Fermer' : 'Brouillon'}{noteText ? ' •' : ''}
              </button>
            </div>
            <textarea className="input" placeholder="Ton argument…"
              value={currentText}
              onChange={e => {
                setCurrentText(e.target.value)
                currentTextRef.current = e.target.value
              }}
              rows={3} maxLength={MAX_CHARS} autoFocus />
            <div className="flex items-center justify-between" style={{ marginTop: '0.5rem', gap: '0.5rem' }}>
              <span className="text-xs text-muted">{currentText.length}/{MAX_CHARS}</span>
              <button className="btn btn-primary" style={{ width: 'auto', padding: '0.6rem 1.25rem' }} onClick={handleSubmit} disabled={submitting || !currentText.trim()}>
                {submitting ? '…' : 'Soumettre →'}
              </button>
            </div>
          </>
        ) : waitingReady ? (() => {
          const maxRound = turns.length > 0 ? Math.max(...turns.map(t => t.round)) : 1
          const iAmReady = readyList.some(r => r.member_id === member?.id && r.round === maxRound)
          const readyCount = readyList.filter(r => r.round === maxRound).length
          return (
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {generatingCommentary ? <><div className="spinner" style={{ margin: '0 auto' }} /><p className="text-muted text-sm">Analyse du round…</p></> :
                <button className="btn btn-primary" onClick={handleReady} disabled={iAmReady}>{iAmReady ? `✅ Prêt (${readyCount}/${members.length})` : '✅ Prêt pour le round suivant'}</button>
              }
            </div>
          )
        })() : (
          <div style={{ textAlign: 'center', padding: '0.5rem' }}>
            <p className="text-muted text-sm">{myTurnDone ? '✅ Soumis — attente des autres…' : '⏳ Attends ton tour…'}</p>
            {currentSpeaker && <p className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>🎤 {currentSpeaker.name} parle</p>}
            <button
              onClick={() => setNoteOpen(o => !o)}
              style={{ marginTop: '0.6rem', background: noteOpen ? 'rgba(255,220,80,0.15)' : 'rgba(255,255,255,0.05)', border: `1px solid ${noteOpen ? 'rgba(255,220,80,0.4)' : 'var(--border)'}`, borderRadius: 8, padding: '0.4rem 0.9rem', cursor: 'pointer', fontSize: '0.8rem', color: noteOpen ? 'rgba(255,220,80,0.9)' : 'var(--text2)', fontWeight: 600, transition: 'all 0.2s' }}>
              ✏️ {noteOpen ? 'Fermer le brouillon' : 'Ouvrir le brouillon'}{noteText ? ' •' : ''}
            </button>
          </div>
        )}
        {member?.is_host && (
          <button className="btn btn-danger" style={{ marginTop: '0.75rem', padding: '0.6rem', fontSize: '0.85rem' }} onClick={() => updateChannelStatus(channel.id, 'ai_summary')}>🏁 Terminer le débat</button>
        )}
      </div>

      <style>{`
        @keyframes fadeInOut {
          0% { opacity: 0; transform: scale(0.8); }
          20% { opacity: 1; transform: scale(1); }
          80% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.1); }
        }
        @keyframes myTurnPulse {
          0%   { opacity: 0; transform: scale(0.7); }
          25%  { opacity: 1; transform: scale(1.05); }
          60%  { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.95); }
        }
      `}</style>
    </div>
  )
}
