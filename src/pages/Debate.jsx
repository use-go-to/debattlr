// src/pages/Debate.jsx
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/AppContext'
import { supabase, submitDebateTurn, getDebateTurns, updateChannelStatus, callGroq } from '../lib/supabase'

const TURN_DURATION = 90
const MAX_ROUNDS    = 3

export default function Debate() {
  const navigate = useNavigate()
  const { channel, member, members, showToast } = useApp()
  const [turns, setTurns]               = useState([])
  const [commentaries, setCommentaries] = useState([]) // { round, content }
  const [currentText, setCurrentText]   = useState('')
  const [rebuttalTo, setRebuttalTo]     = useState(null)
  const [timer, setTimer]               = useState(TURN_DURATION)
  const [submitting, setSubmitting]     = useState(false)
  const [round, setRound]               = useState(1)
  const [roundAnim, setRoundAnim]       = useState(null)
  const [generatingCommentary, setGeneratingCommentary] = useState(false)
  const scrollRef  = useRef(null)
  const timerRef   = useRef(null)
  const prevRound  = useRef(1)

  useEffect(() => {
    if (!channel) { navigate('/', { replace: true }); return }
    if (channel.status === 'ai_summary') { navigate('/summary', { replace: true }); return }
  }, [channel])

  // Polling fallback
  useEffect(() => {
    if (!channel) return
    const interval = setInterval(async () => {
      const { data } = await supabase.from('channels').select('status').eq('id', channel.id).single()
      if (data?.status === 'ai_summary') navigate('/summary', { replace: true })
    }, 3000)
    return () => clearInterval(interval)
  }, [channel?.id])

  // Subscribe to new turns
  useEffect(() => {
    if (!channel) return
    loadAll()
    const turnSub = supabase
      .channel(`turns:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'debate_turns',
        filter: `channel_id=eq.${channel.id}` }, loadAll)
      .subscribe()
    // Subscribe to new commentaries
    const commSub = supabase
      .channel(`commentaries:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'round_commentaries',
        filter: `channel_id=eq.${channel.id}` }, loadAll)
      .subscribe()
    return () => {
      supabase.removeChannel(turnSub)
      supabase.removeChannel(commSub)
    }
  }, [channel?.id])

  async function loadAll() {
    const [turnsRes, commRes, membersRes] = await Promise.all([
      supabase.from('debate_turns').select('*').eq('channel_id', channel.id).order('submitted_at'),
      supabase.from('round_commentaries').select('*').eq('channel_id', channel.id).order('round'),
      supabase.from('members').select('id').eq('channel_id', channel.id)
    ])

    const data        = turnsRes.data || []
    const comms       = commRes.data  || []
    const memberCount = membersRes.data?.length || members.length

    setTurns(data)
    setCommentaries(comms)
    scrollRef.current?.scrollTo({ top: 9999, behavior: 'smooth' })

    if (memberCount === 0) return

    const maxRound   = data.length > 0 ? Math.max(...data.map(t => t.round)) : 1
    const roundTurns = data.filter(t => t.round === maxRound)
    const allSubmitted = roundTurns.length >= memberCount

    if (allSubmitted) {
      const commentaryExists = comms.some(c => c.round === maxRound)
      // Seul l'hôte génère le commentaire
      if (!commentaryExists && member?.is_host && !generatingCommentary) {
        if (maxRound < MAX_ROUNDS) {
          // Générer commentaire puis passer au round suivant
          await generateCommentary(maxRound, roundTurns)
          const newRound = maxRound + 1
          if (newRound !== prevRound.current) {
            setRoundAnim(newRound)
            setTimeout(() => setRoundAnim(null), 2500)
            prevRound.current = newRound
          }
          setRound(newRound)
        } else {
          // Dernier round — générer commentaire final puis fin du débat
          await generateCommentary(maxRound, roundTurns)
          await updateChannelStatus(channel.id, 'ai_summary')
        }
      } else if (commentaryExists) {
        // Invité : met à jour le round localement
        const newRound = maxRound < MAX_ROUNDS ? maxRound + 1 : maxRound
        if (newRound !== prevRound.current && newRound <= MAX_ROUNDS) {
          setRoundAnim(newRound)
          setTimeout(() => setRoundAnim(null), 2500)
          prevRound.current = newRound
        }
        setRound(newRound <= MAX_ROUNDS ? newRound : maxRound)
      }
    } else {
      setRound(maxRound)
    }
  }

  async function generateCommentary(roundNum, roundTurns) {
    setGeneratingCommentary(true)
    try {
      const res = await callGroq('round_commentary', {
        topic: channel.topic,
        round: roundNum,
        turns: roundTurns.map(t => ({ name: t.member_name, content: t.content }))
      })
      const text = res?.result || ''
      await supabase.from('round_commentaries').insert({
        channel_id: channel.id,
        round: roundNum,
        content: text
      })
    } catch (e) {
      console.error('Commentary error', e)
    } finally {
      setGeneratingCommentary(false)
    }
  }

  const myTurnsThisRound = turns.filter(t => t.member_id === member?.id && t.round === round).length
  const isMyTurn = myTurnsThisRound === 0 && round <= MAX_ROUNDS

  useEffect(() => {
    if (!isMyTurn) return
    setTimer(TURN_DURATION)
    timerRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [round, isMyTurn])

  async function handleSubmit() {
    if (!currentText.trim()) return showToast('Écris quelque chose !')
    if (submitting) return
    setSubmitting(true)
    clearInterval(timerRef.current)
    try {
      await submitDebateTurn(channel.id, member.id, member.name, round, currentText.trim(), rebuttalTo)
      setCurrentText('')
      setRebuttalTo(null)
      showToast('Argument soumis ✅')
    } catch (e) {
      showToast('Erreur : ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const timerUrgent  = timer < 20 && timer > 0
  const timerExpired = timer === 0

  // Construit le fil chronologique : turns + commentaires intercalés
  const feed = []
  for (let r = 1; r <= MAX_ROUNDS; r++) {
    const roundTurns = turns.filter(t => t.round === r)
    roundTurns.forEach(t => feed.push({ type: 'turn', data: t }))
    const comm = commentaries.find(c => c.round === r)
    if (comm) feed.push({ type: 'commentary', data: comm })
    else if (generatingCommentary && r === round - 1) feed.push({ type: 'loading', round: r })
  }

  if (!channel) return null

  return (
    <div className="page" style={{ padding: '0', gap: 0 }}>

      {/* Animation Round */}
      {roundAnim && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(15,15,26,0.92)', animation: 'fadeInOut 2.5s ease forwards'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1rem', color: 'var(--accent)', letterSpacing: '0.3em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
              ⚔️ Nouveau tour
            </div>
            <div style={{ fontSize: '5rem', fontWeight: 900, color: 'var(--text)', lineHeight: 1 }}>
              Round {roundAnim}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ padding: '1rem 1.25rem', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="badge badge-accent" style={{ marginBottom: '0.25rem' }}>⚔️ Débat</div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text2)', maxWidth: 260, lineHeight: 1.3 }}>{channel.topic}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="badge badge-warn">Tour {Math.min(round, MAX_ROUNDS)}/{MAX_ROUNDS}</div>
            <div className="flex items-center justify-center gap-1" style={{ marginTop: '0.3rem' }}>
              {members.map(m => {
                const hasTurn = turns.some(t => t.member_id === m.id && t.round === round)
                return (
                  <div key={m.id} style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: hasTurn ? 'var(--success)' : 'var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.6rem', fontWeight: 700, color: 'var(--bg)', transition: 'background 0.3s'
                  }}>{m.name[0]}</div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Feed */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {feed.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem 0' }}>
            <p style={{ fontSize: '2rem' }}>💬</p>
            <p className="text-muted text-sm" style={{ marginTop: '0.5rem' }}>Sois le premier à argumenter !</p>
          </div>
        )}

        {feed.map((item, i) => {
          if (item.type === 'turn') {
            const t    = item.data
            const isMe = t.member_id === member?.id
            const parent = t.rebuttal_to ? turns.find(x => x.id === t.rebuttal_to) : null
            return (
              <div key={t.id}>
                {parent && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text2)', marginBottom: '0.25rem', marginLeft: '0.5rem' }}>
                    ↩️ Réfute <em>« {parent.content.slice(0, 60)}… »</em>
                  </div>
                )}
                <div className={`turn-bubble ${isMe ? 'mine' : ''} ${t.rebuttal_to ? 'rebuttal' : ''}`}>
                  <div className="turn-meta">
                    <div className="avatar" style={{ width: 22, height: 22, fontSize: '0.7rem' }}>{t.member_name[0]}</div>
                    <strong>{t.member_name}</strong>
                    <span className="badge badge-accent" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>T{t.round}</span>
                    {!isMe && (
                      <button style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--warn)', cursor: 'pointer', fontSize: '0.75rem' }}
                        onClick={() => setRebuttalTo(rebuttalTo === t.id ? null : t.id)}>
                        {rebuttalTo === t.id ? '✕ Annuler' : '↩️ Réfuter'}
                      </button>
                    )}
                  </div>
                  <p style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>{t.content}</p>
                </div>
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

      {/* Input */}
      <div style={{ background: 'var(--bg2)', borderTop: '1px solid var(--border)', padding: '1rem 1.25rem', paddingBottom: 'calc(var(--safe-bottom) + 1rem)' }}>
        {rebuttalTo && (
          <div style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid var(--warn)', borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.75rem', marginBottom: '0.5rem', fontSize: '0.8rem', color: 'var(--warn)', display: 'flex', justifyContent: 'space-between' }}>
            <span>↩️ Mode réfutation activé</span>
            <button style={{ background: 'none', border: 'none', color: 'var(--warn)', cursor: 'pointer' }} onClick={() => setRebuttalTo(null)}>✕</button>
          </div>
        )}

        {isMyTurn ? (
          <>
            <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
              <span className="text-xs text-muted">Ton tour</span>
              <span className={`timer ${timerUrgent ? 'urgent' : ''}`} style={{ fontSize: '1.2rem' }}>
                {timerExpired ? '⏰ Temps écoulé' : `${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, '0')}`}
              </span>
            </div>
            <div className="progress-bar" style={{ marginBottom: '0.5rem' }}>
              <div className="progress-fill" style={{ width: `${(timer / TURN_DURATION) * 100}%`, background: timerUrgent ? 'var(--danger)' : undefined }} />
            </div>
            <textarea className="input" placeholder={rebuttalTo ? 'Réfute cet argument…' : 'Exprime ton argument…'}
              value={currentText} onChange={e => setCurrentText(e.target.value)}
              rows={3} maxLength={500} />
            <div className="flex items-center justify-between" style={{ marginTop: '0.5rem', gap: '0.5rem' }}>
              <span className="text-xs text-muted">{currentText.length}/500</span>
              <button className="btn btn-primary" style={{ width: 'auto', padding: '0.6rem 1.25rem' }}
                onClick={handleSubmit} disabled={submitting || !currentText.trim()}>
                {submitting ? '…' : 'Soumettre →'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '0.5rem' }}>
            {generatingCommentary
              ? <><div className="spinner" style={{ margin: '0 auto 0.5rem' }} /><p className="text-muted text-sm">📺 Le commentateur analyse le round…</p></>
              : <><p className="text-muted text-sm">✅ Tu as soumis ton argument pour ce tour</p><p className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>En attente des autres…</p></>
            }
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
