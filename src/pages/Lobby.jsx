// src/pages/Lobby.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/AppContext'
import { supabase, callGroq, saveTopics, updateChannelStatus } from '../lib/supabase'

export default function Lobby() {
  const navigate = useNavigate()
  const { channel, member, members, showToast } = useApp()
  const [loading, setLoading] = useState(false)
  const [copied, setCopied]   = useState(false)

  // Redirect if no session
  useEffect(() => {
    if (!channel) navigate('/', { replace: true })
  }, [channel])

  // Follow channel status changes
  useEffect(() => {
    if (!channel) return
    if (channel.status === 'topic_vote') navigate('/vote', { replace: true })
  }, [channel?.status])

  // Polling fallback si realtime ne déclenche pas
  useEffect(() => {
    if (!channel) return
    const interval = setInterval(async () => {
      const { data } = await supabase.from('channels').select('status,topic').eq('id', channel.id).single()
      if (data?.status === 'topic_vote') navigate('/vote', { replace: true })
    }, 3000)
    return () => clearInterval(interval)
  }, [channel?.id])

  async function handleStart() {
    if (members.length < 2) return showToast('Il faut au moins 2 participants')
    setLoading(true)
    try {
      const data = await callGroq('suggest_topics', { theme: channel.theme, difficulty: channel.difficulty || 'medium' })
      if (!data?.topics?.length) throw new Error('Pas de sujets reçus')
      await saveTopics(channel.id, data.topics)
      await updateChannelStatus(channel.id, 'topic_vote')
    } catch (e) {
      showToast('Erreur : ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  function copyCode() {
    navigator.clipboard.writeText(channel?.code || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    showToast('Code copié ! 📋')
  }

  if (!channel) return null

  const isHost = member?.is_host

  return (
    <div className="page">
      {/* Header */}
      <div>
        <div className="badge badge-accent" style={{ marginBottom: '0.75rem' }}>
          🟢 Salle d'attente
        </div>
        <h1 className="page-title">⚔️ Debattle</h1>
        <p className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>{channel.theme}</p>
      </div>

      {/* Code */}
      <div>
        <label className="label">Code du groupe — partage avec tes amis</label>
        <div className="channel-code" onClick={copyCode}>
          {channel.code}
          <div className="text-xs text-muted" style={{ marginTop: '0.25rem', fontSize: '0.7rem', letterSpacing: '0.02em' }}>
            {copied ? '✅ Copié !' : '👆 Tape pour copier'}
          </div>
        </div>
      </div>

      {/* Members */}
      <div className="card">
        <div className="flex items-center justify-between" style={{ marginBottom: '0.75rem' }}>
          <span className="fw-bold">Participants</span>
          <span className="badge badge-accent">👥 {members.length}</span>
        </div>
        <div className="member-list">
          {members.map(m => (
            <div key={m.id} className="member-item">
              <div className="avatar">{m.name[0].toUpperCase()}</div>
              <div style={{ flex: 1 }}>
                <div className="fw-bold" style={{ fontSize: '0.95rem' }}>{m.name}</div>
              </div>
              {m.is_host && <span className="badge badge-warn">👑 Hôte</span>}
              {m.id === member?.id && !m.is_host && <span className="badge badge-success">Toi</span>}
            </div>
          ))}
        </div>
        {members.length < 2 && (
          <p className="text-muted text-xs text-center" style={{ marginTop: '0.75rem' }}>
            En attente d'au moins un autre participant…
          </p>
        )}
      </div>

      {/* Info */}
      {!isHost && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="text-muted text-sm">⏳ En attente que <span className="text-accent">{channel.host_name}</span> lance le débat</p>
        </div>
      )}

      {/* Start (host only) */}
      {isHost && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="card" style={{ background: 'rgba(124,106,247,0.06)', borderColor: 'var(--accent)' }}>
            <p className="text-sm" style={{ lineHeight: 1.6 }}>
              🎯 <strong>Comment ça marche :</strong><br />
              L'IA va proposer <strong>3 sujets</strong> basés sur ton thème.<br />
              Tout le groupe vote pour choisir la problématique.<br />
              Puis le débat commence !
            </p>
          </div>
          <button className="btn btn-primary" onClick={handleStart}
            disabled={loading || members.length < 2}
            style={{ fontSize: '1.05rem', padding: '1rem' }}>
            {loading
              ? <><span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> L'IA génère les sujets…</>
              : '🚀 Lancer le débat'}
          </button>
        </div>
      )}
    </div>
  )
}
