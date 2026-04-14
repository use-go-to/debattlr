// src/pages/Debate.jsx
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/AppContext'
import { supabase, submitDebateTurn, getDebateTurns, updateChannelStatus } from '../lib/supabase'

const TURN_DURATION = 90  // seconds per turn
const MAX_ROUNDS    = 3   // each member speaks this many times

export default function Debate() {
  const navigate = useNavigate()
  const { channel, member, members, showToast } = useApp()
  const [turns, setTurns]         = useState([])
  const [currentText, setCurrentText] = useState('')
  const [rebuttalTo, setRebuttalTo]   = useState(null)
  const [timer, setTimer]             = useState(TURN_DURATION)
  const [phase, setPhase]             = useState('debate') // debate | done
  const [submitting, setSubmitting]   = useState(false)
  const [round, setRound]             = useState(1)
  const scrollRef = useRef(null)
  const timerRef  = useRef(null)

  useEffect(() => {
    if (!channel) { navigate('/', { replace: true }); return }
    if (channel.status === 'ai_summary') { navigate('/summary', { replace: true }); return }
  }, [channel])

  useEffect(() => {
    if (!channel) return
    loadTurns()
    const sub = supabase
      .channel(`turns:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'debate_turns',
        filter: `channel_id=eq.${channel.id}` }, loadTurns)
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [channel?.id])

  async function loadTurns() {
    const data = await getDebateTurns(channel.id)
    setTurns(data)
    // determine current round from turns count
    const maxRound = Math.max(1, ...data.map(t => t.round))
    setRound(maxRound)
    scrollRef.current?.scrollTo({ top: 9999, behavior: 'smooth' })
  }

  // Timer: reset when it's my turn
  const myTurnsThisRound = turns.filter(t => t.member_id === member?.id && t.round === round).length
  const isMyTurn = myTurnsThisRound === 0 // simple: each member submits once per round

  useEffect(() => {
    if (!isMyTurn || phase !== 'debate') return
    setTimer(TURN_DURATION)
    timerRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [round, isMyTurn, phase])

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
      // Check if everyone submitted for this round
      const updated = await getDebateTurns(channel.id)
      const roundTurns = updated.filter(t => t.round === round)
      if (roundTurns.length >= members.length) {
        if (round >= MAX_ROUNDS) {
          // End debate
          if (member?.is_host) await updateChannelStatus(channel.id, 'ai_summary')
        } else {
          setRound(r => r + 1)
        }
      }
    } catch (e) {
      showToast('Erreur : ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleEndDebate() {
    if (!member?.is_host) return
    await updateChannelStatus(channel.id, 'ai_summary')
  }

  const timerUrgent = timer < 20 && timer > 0
  const timerExpired = timer === 0

  if (!channel) return null

  return (
    <div className="page" style={{ padding: '0', gap: 0 }}>
      {/* Header */}
      <div style={{ padding: '1rem 1.25rem', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="badge badge-accent" style={{ marginBottom: '0.25rem' }}>⚔️ Débat</div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text2)', maxWidth: 260, lineHeight: 1.3 }}>
              {channel.topic}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="badge badge-warn">Tour {round}/{MAX_ROUNDS}</div>
            <div className="flex items-center justify-center gap-1" style={{ marginTop: '0.3rem' }}>
              {members.map(m => {
                const hasTurn = turns.some(t => t.member_id === m.id && t.round === round)
                return (
                  <div key={m.id} style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: hasTurn ? 'var(--success)' : 'var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.6rem', fontWeight: 700, color: 'var(--bg)',
                    transition: 'background 0.3s'
                  }}>
                    {m.name[0]}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Turns feed */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {turns.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem 0' }}>
            <p style={{ fontSize: '2rem' }}>💬</p>
            <p className="text-muted text-sm" style={{ marginTop: '0.5rem' }}>Sois le premier à argumenter !</p>
          </div>
        )}
        {turns.map(t => {
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
                  <div className="avatar" style={{ width: 22, height: 22, fontSize: '0.7rem' }}>
                    {t.member_name[0]}
                  </div>
                  <strong>{t.member_name}</strong>
                  <span className="badge badge-accent" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>T{t.round}</span>
                  {!isMe && (
                    <button
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--warn)', cursor: 'pointer', fontSize: '0.75rem' }}
                      onClick={() => setRebuttalTo(rebuttalTo === t.id ? null : t.id)}>
                      {rebuttalTo === t.id ? '✕ Annuler' : '↩️ Réfuter'}
                    </button>
                  )}
                </div>
                <p style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>{t.content}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Input area */}
      <div style={{ background: 'var(--bg2)', borderTop: '1px solid var(--border)', padding: '1rem 1.25rem', paddingBottom: 'calc(var(--safe-bottom) + 1rem)' }}>
        {rebuttalTo && (
          <div style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid var(--warn)', borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.75rem', marginBottom: '0.5rem', fontSize: '0.8rem', color: 'var(--warn)', display: 'flex', justifyContent: 'space-between' }}>
            <span>↩️ Mode réfutation activé</span>
            <button style={{ background: 'none', border: 'none', color: 'var(--warn)', cursor: 'pointer' }} onClick={() => setRebuttalTo(null)}>✕</button>
          </div>
        )}

        {isMyTurn ? (
          <>
            {/* Timer */}
            <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
              <span className="text-xs text-muted">Ton tour</span>
              <span className={`timer ${timerUrgent ? 'urgent' : ''}`} style={{ fontSize: '1.2rem' }}>
                {timerExpired ? '⏰ Temps écoulé' : `${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, '0')}`}
              </span>
            </div>
            <div className="progress-bar" style={{ marginBottom: '0.5rem' }}>
              <div className="progress-fill" style={{ width: `${(timer / TURN_DURATION) * 100}%`, background: timerUrgent ? 'var(--danger)' : undefined }} />
            </div>
            <textarea className="input" placeholder={rebuttalTo ? "Réfute cet argument…" : "Exprime ton argument…"}
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
            <p className="text-muted text-sm">✅ Tu as soumis ton argument pour ce tour</p>
            <p className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>En attente des autres…</p>
          </div>
        )}

        {member?.is_host && (
          <button className="btn btn-danger" style={{ marginTop: '0.75rem', padding: '0.6rem', fontSize: '0.85rem' }}
            onClick={handleEndDebate}>
            🏁 Terminer le débat maintenant
          </button>
        )}
      </div>
    </div>
  )
}
