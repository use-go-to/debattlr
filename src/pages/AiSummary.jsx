// src/pages/AiSummary.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/AppContext'
import { supabase, callGroq, getDebateTurns, saveAiSummary, getAiSummaries, updateChannelStatus } from '../lib/supabase'

export default function AiSummary() {
  const navigate = useNavigate()
  const { channel, member, members, showToast } = useApp()
  const [mySummary, setMySummary]   = useState(null)
  const [allSummaries, setAllSummaries] = useState([])
  const [loading, setLoading]       = useState(false)
  const [analyzed, setAnalyzed]     = useState(false)

  useEffect(() => {
    if (!channel) { navigate('/', { replace: true }); return }
    if (channel.status === 'peer_vote') { navigate('/peervote', { replace: true }); return }
  }, [channel])

  useEffect(() => {
    if (!channel) return
    loadSummaries()
    const sub = supabase
      .channel(`summaries:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ai_summaries',
        filter: `channel_id=eq.${channel.id}` }, loadSummaries)
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [channel?.id])

  async function loadSummaries() {
    const data = await getAiSummaries(channel.id)
    setAllSummaries(data)
    const mine = data.find(s => s.member_id === member?.id)
    if (mine) { setMySummary(mine); setAnalyzed(true) }
    // Ne pas auto-avancer — l'hôte décide quand passer au vote
  }

  async function handleAnalyze() {
    setLoading(true)
    try {
      const turns = await getDebateTurns(channel.id)
      const myTurns = turns.filter(t => t.member_id === member.id).map(t => t.content)
      if (myTurns.length === 0) throw new Error('Aucun argument trouvé')
      const result = await callGroq('summarize_member', {
        member_name: member.name,
        topic: channel.topic,
        turns: myTurns
      })
      await saveAiSummary(channel.id, member.id, member.name, {
        summary: result.summary,
        ai_feedback: result.ai_feedback,
        score_logic: result.score_logic,
        score_clarity: result.score_clarity,
        score_impact: result.score_impact,
      })
      setMySummary(result)
      setAnalyzed(true)
      showToast('Analyse reçue ! 🤖')
    } catch (e) {
      showToast('Erreur : ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  if (!channel) return null

  const waiting = allSummaries.length < members.length

  return (
    <div className="page">
      <div>
        <div className="badge badge-accent" style={{ marginBottom: '0.5rem' }}>🤖 Analyse IA</div>
        <h1 className="page-title">Synthèse individuelle</h1>
        <p className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>{channel.topic}</p>
      </div>

      {/* Progress */}
      <div className="card">
        <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
          <span className="text-sm text-muted">Analyses reçues</span>
          <span className="badge badge-accent">{allSummaries.length} / {members.length}</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${members.length ? (allSummaries.length / members.length) * 100 : 0}%` }} />
        </div>
        <div className="flex" style={{ gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          {members.map(m => {
            const done = allSummaries.some(s => s.member_id === m.id)
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: done ? 'var(--success)' : 'var(--border)' }} />
                <span style={{ color: done ? 'var(--success)' : 'var(--text2)' }}>{m.name}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* My analysis */}
      {!analyzed && (
        <div className="card" style={{ textAlign: 'center', gap: '1rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '2.5rem' }}>🤖</div>
          <h3 className="fw-bold">Analyse de tes arguments</h3>
          <p className="text-muted text-sm">
            L'IA va analyser tous tes arguments du débat et te donner un retour sur leur solidité, clarté et impact.
          </p>
          <button className="btn btn-primary" onClick={handleAnalyze} disabled={loading}>
            {loading
              ? <><span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> Analyse en cours…</>
              : '🔍 Analyser mes arguments'}
          </button>
        </div>
      )}

      {analyzed && mySummary && (
        <div className="card card-glow">
          <div className="badge badge-success" style={{ marginBottom: '0.75rem' }}>✅ Ton analyse</div>
          <h3 className="fw-bold" style={{ marginBottom: '0.5rem' }}>📝 Position principale</h3>
          <p style={{ fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1rem', color: 'var(--text)' }}>
            {mySummary.summary}
          </p>

          <h3 className="fw-bold" style={{ marginBottom: '0.5rem' }}>💬 Avis de l'IA</h3>
          <p style={{ fontSize: '0.875rem', lineHeight: 1.6, marginBottom: '1rem', color: 'var(--text2)' }}>
            {mySummary.ai_feedback}
          </p>

          <h3 className="fw-bold" style={{ marginBottom: '0.75rem' }}>📊 Scores</h3>
          {[
            ['Logique', mySummary.score_logic],
            ['Clarté', mySummary.score_clarity],
            ['Impact', mySummary.score_impact],
          ].map(([label, score]) => (
            <div key={label} className="score-row">
              <span className="score-label">{label}</span>
              <div className="score-bar">
                <div className="score-bar-fill" style={{ width: `${(score || 0) * 10}%` }} />
              </div>
              <span className="score-num">{score || '–'}</span>
            </div>
          ))}
        </div>
      )}

      {analyzed && waiting && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ marginBottom: '0.75rem' }} />
          <p className="text-muted text-sm">En attente des analyses des autres…</p>
        </div>
      )}

      {!waiting && member?.is_host && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
          <div className="badge badge-success" style={{ justifyContent: 'center' }}>
            ✅ Tout le monde a été analysé
          </div>
          <button className="btn btn-primary" onClick={() => updateChannelStatus(channel.id, 'peer_vote')}>
            Passer au vote pair-à-pair →
          </button>
        </div>
      )}
    </div>
  )
}
