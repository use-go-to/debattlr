// src/pages/Debate.jsx
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/AppContext'
import { supabase, updateChannelStatus, callGroq } from '../lib/supabase'

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
  const [turnStartedAt, setTurnStartedAt] = useState(null)  // timestamp ISO de début du tour actuel
  const [displayTimer, setDisplayTimer] = useState(0)

  const scrollRef      = useRef(null)
  const timerRef       = useRef(null)
  const prevRound      = useRef(1)
  const autoSubmitRef  = useRef(false)
  const generatingRef  = useRef(false)

  const MAX_ROUNDS    = channel?.max_rounds    || 3
  const TURN_DURATION = channel?.turn_duration || 90
  const MAX_CHARS     = channel?.max_chars     || 500

  const sortedMembers  = [...members].sort((a, b) => new Date(a.joined_at) - new Date(b.joined_at))
  const currentSpeaker = sortedMembers[speakerIndex] || null
  const isMyTurn       = currentSpeaker?.id === member?.id && !waitingReady

  // ── Timer unifié basé sur turnStartedAt ──────────────────────────────────
  // Redémarre à chaque fois que turnStartedAt ou isMyTurn change
  useEffect(() => {
    clearInterval(timerRef.current)
    if (waitingReady || !turnStartedAt) return

    autoSubmitRef.current = false

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

    tick() // valeur immédiate
    timerRef.current = setInterval(tick, 1000)
    return () => clearInterval(timerRef.current)
  }, [turnStartedAt, isMyTurn, waitingReady])

  // ── Redirections ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!channel) { navigate('/', { replace: true }); return }
    if (channel.status === 'ai_summary') { navigate('/summary', { replace: true }); return }
  }, [channel])

  // ── Polling channel (status + speaker + turn_started_at) ─────────────────
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

  // ── Realtime subscriptions ────────────────────────────────────────────────
  useEffect(() => {
    if (!channel) return
    loadAll()
    const turnSub = supabase
      .channel(`turns:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'debate_turns',
        filter: `channel_id=eq.${channel.id}` }, () => setTimeout(loadAll, 300))
      .subscribe()
    const commSub = supabase
      .channel(`commentaries:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'round_commentaries',
        filter: `channel_id=eq.${channel.id}` }, loadAll)
      .subscribe()
    const readySub = supabase
      .channel(`ready:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'round_ready',
        filter: `channel_id=eq.${channel.id}` }, loadAll)
      .subscribe()
    return () => {
      supabase.removeChannel(turnSub)
      supabase.removeChannel(commSub)
      supabase.removeChannel(readySub)
    }
  }, [channel?.id])

  function scrollToBottom() {
    setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }, 50)
  }

  async function loadAll() {
    const [turnsRes, commRes, membersRes, readyRes, channelRes] = await Promise.all([
      supabase.from('debate_turns').select('*').eq('channel_id', channel.id).order('submitted_at'),
      supabase.from('round_commentaries').select('*').eq('channel_id', channel.id).order('round'),
      supabase.from('members').select('*').eq('channel_id', channel.id).order('joined_at'),
      supabase.from('round_ready').select('*').eq('channel_id', channel.id),
      supabase.from('channels').select('current_speaker_index,turn_started_at').eq('id', channel.id).single()
    ])

    const data        = turnsRes.data || []
    const comms       = commRes.data  || []
    const ready       = readyRes.data || []
    const allMembers  = membersRes.data || []
    const memberCount = allMembers.length || members.length
    const chData      = channelRes.data
    const dbIndex     = chData?.current_speaker_index ?? 0
    const dbStartedAt = chData?.turn_started_at ?? null

    setSpeakerIndex(dbIndex)
    setTurnStartedAt(dbStartedAt)
    setTurns(data)
    setCommentaries(comms)
    setReadyList(ready)
    scrollToBottom()

    if (memberCount === 0) return

    const maxRound   = data.length > 0 ? Math.max(...data.map(t => t.round)) : 1
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
          if (member?.is_host) {
            const now = new Date().toISOString()
            await supabase.from('channels').update({ current_speaker_index: 0, turn_started_at: now }).eq('id', channel.id)
            setSpeakerIndex(0)
            setTurnStartedAt(now)
          }
        } else if (allReady && maxRound >= MAX_ROUNDS) {
          setWaitingReady(false)
          if (member?.is_host) await updateChannelStatus(channel.id, 'ai_summary')
        } else {
          setWaitingReady(true)
          setRound(maxRound)
        }
      }
    } else {
      // Avancer le speaker si le locuteur actuel (selon DB) a déjà soumis
      const currentSpeakerInDb = allMembers[dbIndex]
      const currentSpeakerDone = currentSpeakerInDb
        ? roundTurns.some(t => t.member_id === currentSpeakerInDb.id)
        : false

      if (currentSpeakerDone && member?.is_host) {
        const nextIndex = dbIndex + 1
        if (nextIndex < memberCount) {
          const now = new Date().toISOString()
          await supabase.from('channels').update({
            current_speaker_index: nextIndex,
            turn_started_at: now
          }).eq('id', channel.id)
          setSpeakerIndex(nextIndex)
          setTurnStartedAt(now)
        }
      }

      setWaitingReady(comms.some(c => c.round === maxRound))
      setRound(maxRound)
    }
  }

  async function generateCommentary(roundNum, roundTurns) {
    try {
      const res = await callGroq('round_commentary', {
        topic: channel.topic,
        round: roundNum,
        turns: roundTurns.map(t => ({ name: t.member_name, content: t.content }))
      })
      await supabase.from('round_commentaries').insert({
        channel_id: channel.id, round: roundNum, content: res?.result || ''
      })
    } catch (e) {
      console.error('Commentary error', e)
    } finally {
      generatingRef.current = false
      setGeneratingCommentary(false)
    }
  }

  async function handleAutoSubmit() {
    const text = currentText.trim()
    const content = text || '[Temps écoulé — pas de réponse]'
    try {
      await supabase.from('debate_turns').insert({
        channel_id: channel.id, member_id: member.id, member_name: member.name,
        round, content
      })
      setCurrentText('')
      if (!text) showToast('⏰ Temps écoulé, message envoyé automatiquement')
      setTimeout(loadAll, 400)
    } catch (e) {
      showToast('Erreur : ' + e.message)
    }
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
      showToast('Argument soumis ✅')
      setTimeout(loadAll, 400)
    } catch (e) {
      showToast('Erreur : ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReady() {
    const maxRound = turns.length > 0 ? Math.max(...turns.map(t => t.round)) : 1
    await supabase.from('round_ready').upsert({
      channel_id: channel.id, member_id: member.id, round: maxRound
    })
  }

  const timerUrgent  = displayTimer < 20 && displayTimer > 0
  const timerExpired = displayTimer === 0

  const feed = []
  for (let r = 1; r <= MAX_ROUNDS; r++) {
    turns.filter(t => t.round === r).forEach(t => feed.push({ type: 'turn', data: t }))
    const comm = commentaries.find(c => c.round === r)
    if (comm) feed.push({ type: 'commentary', data: comm })
    else if (generatingCommentary && r === round - 1) feed.push({ type: 'loading', round: r })
  }

  if (!channel) return null

  const turnsThisRound = turns.filter(t => t.round === round)
  const myTurnDone     = turnsThisRound.some(t => t.member_id === member?.id)

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

      {/* Header */}
      <div style={{ padding: '0.75rem 1.25rem', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div className="flex items-center justify-between">
          <div style={{ flex: 1, marginRight: '0.75rem' }}>
            <div className="badge badge-accent" style={{ marginBottom: '0.25rem' }}>⚔️ Débat</div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text)', lineHeight: 1.3, fontWeight: 600 }}>{channel.topic}</p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="badge badge-warn">Tour {Math.min(round, MAX_ROUNDS)}/{MAX_ROUNDS}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.3rem', justifyContent: 'flex-end' }}>
              {sortedMembers.map((m, i) => {
                const hasTurn   = turnsThisRound.some(t => t.member_id === m.id)
                const isCurrent = i === speakerIndex && !waitingReady
                return (
                  <div key={m.id} style={{
                    width: 26, height: 26, borderRadius: '50%',
                    background: hasTurn ? 'var(--success)' : isCurrent ? 'var(--accent)' : 'var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.6rem', fontWeight: 700, color: 'var(--bg)',
                    border: isCurrent ? '2px solid white' : 'none',
                    transition: 'all 0.3s'
                  }}>{m.name[0]}</div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Barre de timer visible par tous */}
        {!waitingReady && currentSpeaker && (
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
                background: timerUrgent ? 'var(--danger)' : undefined,
                transition: 'width 1s linear'
              }} />
            </div>
          </div>
        )}
      </div>

      {/* Feed scrollable */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {feed.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem 0' }}>
            <p style={{ fontSize: '2rem' }}>💬</p>
            <p className="text-muted text-sm" style={{ marginTop: '0.5rem' }}>
              {currentSpeaker ? `${currentSpeaker.name} ouvre le débat…` : 'Le débat commence…'}
            </p>
          </div>
        )}
        {feed.map((item) => {
          if (item.type === 'turn') {
            const t = item.data
            const isMe = t.member_id === member?.id
            return (
              <div key={t.id} className={`turn-bubble ${isMe ? 'mine' : ''}`}>
                <div className="turn-meta">
                  <div className="avatar" style={{ width: 22, height: 22, fontSize: '0.7rem' }}>{t.member_name[0]}</div>
                  <strong>{t.member_name}</strong>
                  <span className="badge badge-accent" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>R{t.round}</span>
                </div>
                <p style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>{t.content}</p>
              </div>
            )
          }
          if (item.type === 'commentary') {
            return (
              <div key={`comm-${item.data.round}`} style={{ padding: '1rem', background: 'rgba(124,106,247,0.08)', borderRadius: 'var(--radius)', border: '1px solid var(--accent)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
                  📺 COMMENTATEUR — FIN DU ROUND {item.data.round}
                </div>
                <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text)', fontStyle: 'italic' }}>{item.data.content}</p>
              </div>
            )
          }
          if (item.type === 'loading') {
            return (
              <div key={`loading-${item.round}`} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem', background: 'rgba(124,106,247,0.08)', borderRadius: 'var(--radius)', border: '1px solid var(--accent)' }}>
                <span style={{ fontSize: '1.5rem' }}>📺</span>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '0.25rem' }}>COMMENTATEUR — EN DIRECT</div>
                  <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                </div>
              </div>
            )
          }
          return null
        })}
      </div>

      {/* Zone de saisie */}
      <div style={{ background: 'var(--bg2)', borderTop: '1px solid var(--border)', padding: '0.75rem 1.25rem', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)', flexShrink: 0 }}>

        {isMyTurn && !myTurnDone ? (
          <>
            <textarea className="input" placeholder="Exprime ton argument…"
              value={currentText} onChange={e => setCurrentText(e.target.value)}
              rows={3} maxLength={MAX_CHARS} autoFocus />
            <div className="flex items-center justify-between" style={{ marginTop: '0.5rem', gap: '0.5rem' }}>
              <span className="text-xs text-muted">{currentText.length}/{MAX_CHARS}</span>
              <button className="btn btn-primary" style={{ width: 'auto', padding: '0.6rem 1.25rem' }}
                onClick={handleSubmit} disabled={submitting || !currentText.trim()}>
                {submitting ? '…' : 'Soumettre →'}
              </button>
            </div>
          </>
        ) : waitingReady ? (() => {
          const maxRound   = turns.length > 0 ? Math.max(...turns.map(t => t.round)) : 1
          const iAmReady   = readyList.some(r => r.member_id === member?.id && r.round === maxRound)
          const readyCount = readyList.filter(r => r.round === maxRound).length
          return (
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {generatingCommentary
                ? <><div className="spinner" style={{ margin: '0 auto' }} /><p className="text-muted text-sm">📺 Le commentateur analyse le round…</p></>
                : <>
                    <p className="text-sm" style={{ color: 'var(--text)' }}>📺 Lis le commentaire avant de continuer</p>
                    <button className="btn btn-primary" onClick={handleReady} disabled={iAmReady}>
                      {iAmReady ? `✅ Prêt (${readyCount}/${members.length})` : '✅ Je suis prêt pour le round suivant'}
                    </button>
                  </>
              }
            </div>
          )
        })() : myTurnDone ? (
          <div style={{ textAlign: 'center', padding: '0.5rem' }}>
            <p className="text-muted text-sm">✅ Argument soumis — en attente des autres…</p>
            {currentSpeaker && <p className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>🎤 {currentSpeaker.name} parle maintenant</p>}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '0.5rem' }}>
            <p className="text-muted text-sm">⏳ Attends ton tour…</p>
            {currentSpeaker && <p className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>🎤 {currentSpeaker.name} parle maintenant</p>}
          </div>
        )}

        {member?.is_host && (
          <button className="btn btn-danger" style={{ marginTop: '0.75rem', padding: '0.6rem', fontSize: '0.85rem' }}
            onClick={() => updateChannelStatus(channel.id, 'ai_summary')}>
            🏁 Terminer le débat maintenant
          </button>
        )}
      </div>

      <style>{`
        @keyframes fadeInOut {
          0%   { opacity: 0; transform: scale(0.8); }
          20%  { opacity: 1; transform: scale(1); }
          80%  { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.1); }
        }
      `}</style>
    </div>
  )
}
