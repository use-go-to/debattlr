// src/pages/AiSummary.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/AppContext'
import { supabase, callGroq, getDebateTurns, saveAiSummary, getAiSummaries, updateChannelStatus } from '../lib/supabase'
import { speak } from '../lib/sounds'

export default function AiSummary() {
  const navigate = useNavigate()
  const { channel, member, members, showToast } = useApp()
  const [mySummary, setMySummary]       = useState(null)
  const [allSummaries, setAllSummaries] = useState([])
  const [readyList, setReadyList]       = useState([])
  const [loading, setLoading]           = useState(false)
  const [analyzed, setAnalyzed]         = useState(false)
  const [memberCount, setMemberCount]   = useState(members.length)

  useEffect(() => {
    if (!channel) { navigate('/', { replace: true }); return }
    if (channel.status === 'peer_vote') { navigate('/peervote', { replace: true }); return }
  }, [channel])

  // Polling fallback
  useEffect(() => {
    if (!channel) return
    const interval = setInterval(async () => {
      const { data } = await supabase.from('channels').select('status').eq('id', channel.id).single()
      if (data?.status === 'peer_vote') navigate('/peervote', { replace: true })
    }, 3000)
    return () => clearInterval(interval)
  }, [channel?.id])

  useEffect(() => {
    if (!channel) return
    loadAll()
    const summarySub = supabase
      .channel(`summaries:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ai_summaries',
        filter: `channel_id=eq.${channel.id}` }, loadAll)
      .subscribe()
    const readySub = supabase
      .channel(`summary_ready:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'summary_ready',
        filter: `channel_id=eq.${channel.id}` }, loadAll)
      .subscribe()
    return () => {
      supabase.removeChannel(summarySub)
      supabase.removeChannel(readySub)
    }
  }, [channel?.id])

  async function loadAll() {
    const [summariesRes, readyRes, membersRes] = await Promise.all([
      getAiSummaries(channel.id),
      supabase.from('summary_ready').select('*').eq('channel_id', channel.id),
      supabase.from('members').select('id').eq('channel_id', channel.id),
    ])
    const count = membersRes.data?.length || members.length
    setMemberCount(count)
    setAllSummaries(summariesRes)
    setReadyList(readyRes.data || [])
    const mine = summariesRes.find(s => s.member_id === member?.id)
    if (mine) { setMySummary(mine); setAnalyzed(true) }

    // L'hôte avance automatiquement quand tout le monde est prêt
    const ready = readyRes.data || []
    if (ready.length >= count && count > 0 && member?.is_host) {
      await updateChannelStatus(channel.id, 'peer_vote')
    }
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

  async function handleReady() {
    try {
      await supabase.from('summary_ready').upsert({ channel_id: channel.id, member_id: member.id })
    } catch (e) {
      showToast('Erreur : ' + e.message)
    }
  }

  if (!channel) return null

  const allAnalyzed = allSummaries.length >= memberCount && memberCount > 0
  const iAmReady    = readyList.some(r => r.member_id === member?.id)
  const readyCount  = readyList.length

  return (
    <div className="page">
      <div>
        <div className="badge badge-accent" style={{ marginBottom: '0.5rem' }}>🤖 Analyse IA</div>
        <h1 className="page-title">Synthèse individuelle</h1>
        <p className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>{channel.topic}</p>
      </div>

      {/* Progress analyses */}
      <div className="card">
        <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
          <span className="text-sm text-muted">Analyses reçues</span>
          <span className="badge badge-accent">{allSummaries.length} / {memberCount}</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${memberCount ? (allSummaries.length / memberCount) * 100 : 0}%` }} />
        </div>
        <div className="flex" style={{ gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          {members.map(m => {
            const hasSummary = allSummaries.some(s => s.member_id === m.id)
            const isReady    = readyList.some(r => r.member_id === m.id)
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: isReady ? 'var(--success)' : hasSummary ? 'var(--warn)' : 'var(--border)' }} />
                <span style={{ color: isReady ? 'var(--success)' : hasSummary ? 'var(--warn)' : 'var(--text2)' }}>{m.name}</span>
              </div>
            )
          })}
        </div>
        {allAnalyzed && (
          <p className="text-xs text-muted" style={{ marginTop: '0.5rem' }}>
            🟡 analysé · 🟢 prêt à continuer
          </p>
        )}
      </div>

      {/* Bouton analyser */}
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

      {/* Mon analyse */}
      {analyzed && mySummary && (
        <div className="card card-glow">
          <div className="badge badge-success" style={{ marginBottom: '0.75rem' }}>✅ Ton analyse</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <h3 className="fw-bold">📝 Position principale</h3>
            <button onClick={() => speak(mySummary.summary)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', opacity: 0.6 }} title="Écouter">🔊</button>
          </div>
          <p style={{ fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1rem', color: 'var(--text)' }}>
            {mySummary.summary}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <h3 className="fw-bold">💬 Avis de l'IA</h3>
            <button onClick={() => speak(mySummary.ai_feedback)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', opacity: 0.6 }} title="Écouter">🔊</button>
          </div>
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

      {/* En attente que tout le monde ait son analyse */}
      {analyzed && !allAnalyzed && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ marginBottom: '0.75rem' }} />
          <p className="text-muted text-sm">En attente des analyses des autres…</p>
        </div>
      )}

      {/* Bouton continuer — visible par TOUS une fois toutes les analyses reçues */}
      {allAnalyzed && analyzed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div className="card" style={{ background: 'rgba(124,106,247,0.06)', borderColor: 'var(--accent)', textAlign: 'center' }}>
            <div className="flex" style={{ justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              {members.map(m => {
                const isReady = readyList.some(r => r.member_id === m.id)
                return (
                  <span key={m.id} style={{ fontSize: '0.8rem', color: isReady ? 'var(--success)' : 'var(--text2)' }}>
                    {isReady ? '✅' : '⏳'} {m.name}
                  </span>
                )
              })}
            </div>
            <p className="text-xs text-muted">{readyCount}/{memberCount} prêts à continuer</p>
          </div>
          <button className="btn btn-primary" onClick={handleReady} disabled={iAmReady}>
            {iAmReady ? `✅ Prêt (${readyCount}/${memberCount})` : '✅ J\'ai lu mon analyse — Continuer'}
          </button>
        </div>
      )}
    </div>
  )
}
