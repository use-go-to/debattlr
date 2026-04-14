// src/pages/Manifesto.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/AppContext'
import { callGroq, getAiSummaries, getPeerVotes, saveManifesto, getManifestoByChannel } from '../lib/supabase'

export default function Manifesto() {
  const navigate = useNavigate()
  const { channel, member, members, showToast, reset } = useApp()
  const [manifesto, setManifesto]   = useState(null)
  const [ranking, setRanking]       = useState([])
  const [winner, setWinner]         = useState(null)
  const [loading, setLoading]       = useState(true)
  const [shareUrl, setShareUrl]     = useState(null)

  useEffect(() => {
    if (!channel) { navigate('/', { replace: true }); return }
    init()
  }, [channel?.id])

  async function init() {
    setLoading(true)
    try {
      // Check if manifesto already generated
      const existing = await getManifestoByChannel(channel.id).catch(() => null)
      if (existing) {
        setManifesto(existing.content)
        setRanking(existing.ranking || [])
        setWinner(existing.winner_name)
        setShareUrl(`${window.location.origin}/debattle/p/${existing.public_slug}`)
        setLoading(false)
        return
      }
      // Generate if host
      if (member?.is_host) await generate()
      else {
        // Poll until generated
        const interval = setInterval(async () => {
          const m = await getManifestoByChannel(channel.id).catch(() => null)
          if (m) {
            clearInterval(interval)
            setManifesto(m.content)
            setRanking(m.ranking || [])
            setWinner(m.winner_name)
            setShareUrl(`${window.location.origin}/debattle/p/${m.public_slug}`)
            setLoading(false)
          }
        }, 2000)
      }
    } catch (e) {
      showToast('Erreur : ' + e.message)
      setLoading(false)
    }
  }

  async function generate() {
    const [summaries, peerVotes] = await Promise.all([
      getAiSummaries(channel.id),
      getPeerVotes(channel.id)
    ])

    const scores = {}
    members.forEach(m => { scores[m.id] = 0 })
    peerVotes.forEach(v => { scores[v.voted_for_id] = (scores[v.voted_for_id] || 0) + 1 })

    const rankResult = await callGroq('rank_peers', {
      topic: channel.topic,
      criteria: ['logique', 'clarté', 'conviction'],
      members: summaries.map(s => ({
        name: s.member_name,
        summary: s.summary,
        scores: {
          logic: s.score_logic,
          clarity: s.score_clarity,
          impact: s.score_impact,
          peer: scores[s.member_id] || 0
        }
      }))
    })

    setRanking(rankResult.ranking || [])
    setWinner(rankResult.winner)

    const mResult = await callGroq('generate_manifesto', {
      topic: channel.topic,
      winner: rankResult.winner,
      ranking: rankResult.ranking,
      overall_analysis: rankResult.overall_analysis,
      members: summaries.map(s => ({ name: s.member_name, summary: s.summary }))
    })

    const slug = await saveManifesto(channel.id, mResult.result, rankResult.winner, rankResult.ranking)
    setManifesto(mResult.result)
    setShareUrl(`${window.location.origin}/debattle/p/${slug}`)
    setLoading(false)
  }

  function handleShare() {
    if (!shareUrl) return
    if (navigator.share) {
      navigator.share({ title: 'Manifeste Debattle', url: shareUrl })
    } else {
      navigator.clipboard.writeText(shareUrl)
      showToast('Lien copié ! 📋')
    }
  }

  function handleNewDebate() {
    reset()
    navigate('/')
  }

  if (loading) return (
    <div className="page" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div className="spinner" />
      <p className="text-accent fw-bold" style={{ marginTop: '1rem' }}>
        {member?.is_host ? '🤖 Génération du manifeste…' : '⏳ En attente du manifeste…'}
      </p>
      <p className="text-muted text-sm" style={{ marginTop: '0.5rem', textAlign: 'center' }}>
        L'IA rédige le résumé final du débat
      </p>
    </div>
  )

  return (
    <div className="page">
      {/* Header */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '3rem' }}>🏆</div>
        <h1 className="page-title" style={{ fontSize: '1.75rem', marginTop: '0.5rem' }}>Manifeste du Débat</h1>
        <p className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>{channel?.topic}</p>
      </div>

      {/* Winner */}
      {winner && (
        <div className="card card-glow" style={{ textAlign: 'center' }}>
          <div className="badge badge-warn" style={{ justifyContent: 'center', marginBottom: '0.5rem' }}>👑 Gagnant</div>
          <div className="avatar" style={{ width: 64, height: 64, fontSize: '1.5rem', margin: '0 auto 0.5rem' }}>
            {winner[0]}
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 900 }}>{winner}</h2>
        </div>
      )}

      {/* Ranking */}
      {ranking.length > 0 && (
        <div className="card">
          <h3 className="fw-bold" style={{ marginBottom: '0.75rem' }}>🏅 Classement</h3>
          {ranking.sort((a, b) => a.rank - b.rank).map(r => (
            <div key={r.name} className="member-item" style={{ marginBottom: '0.5rem' }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: r.rank === 1 ? 'linear-gradient(135deg, #fbbf24, #f59e0b)' : r.rank === 2 ? 'linear-gradient(135deg, #9ca3af, #6b7280)' : 'linear-gradient(135deg, #92400e, #78350f)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 900, fontSize: '1rem', color: '#fff'
              }}>
                {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉'}
              </div>
              <div style={{ flex: 1 }}>
                <div className="fw-bold" style={{ fontSize: '0.95rem' }}>{r.name}</div>
                <div className="text-muted text-xs" style={{ lineHeight: 1.3 }}>{r.justification}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Manifesto text */}
      {manifesto && (
        <div className="card" style={{ background: 'linear-gradient(135deg, rgba(124,106,247,0.06), rgba(167,139,250,0.04))' }}>
          <div className="flex items-center justify-between" style={{ marginBottom: '1rem' }}>
            <h3 className="fw-bold">📜 Le Manifeste</h3>
            <span className="badge badge-accent">IA Generated</span>
          </div>
          <p className="manifesto-text">{manifesto}</p>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {shareUrl && (
          <button className="btn btn-primary" onClick={handleShare} style={{ fontSize: '1.05rem' }}>
            📤 Partager le manifeste
          </button>
        )}
        <button className="btn btn-secondary" onClick={handleNewDebate}>
          🔄 Nouveau débat
        </button>
      </div>

      <p className="text-center text-xs text-muted">
        Ce manifeste est accessible publiquement via le lien de partage
      </p>
    </div>
  )
}
