// src/pages/TopicVote.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/AppContext'
import { supabase, getTopics, getTopicVotes, voteForTopic, updateChannelStatus } from '../lib/supabase'

export default function TopicVote() {
  const navigate = useNavigate()
  const { channel, member, members, showToast } = useApp()
  const [topics, setTopics]   = useState([])
  const [votes, setVotes]     = useState([])
  const [myVote, setMyVote]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [tie, setTie]         = useState(false) // égalité détectée

  const isHost     = member?.is_host
  const hostPicks  = members.length <= 2 // hôte choisit directement si ≤2 joueurs

  useEffect(() => {
    if (!channel) { navigate('/', { replace: true }); return }
    if (channel.status === 'debate') { navigate('/debate', { replace: true }); return }
  }, [channel])

  useEffect(() => {
    if (!channel) return
    load()
    const topicSub = supabase
      .channel(`topics:${channel.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'topics',
        filter: `channel_id=eq.${channel.id}` }, load)
      .subscribe()
    const voteSub = supabase
      .channel(`topic_votes:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'topic_votes',
        filter: `channel_id=eq.${channel.id}` }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(topicSub)
      supabase.removeChannel(voteSub)
    }
  }, [channel?.id])

  async function load() {
    const [t, v] = await Promise.all([getTopics(channel.id), getTopicVotes(channel.id)])
    setTopics(t)
    setVotes(v)
    const mine = v.find(vt => vt.member_id === member?.id)
    if (mine) setMyVote(mine.topic_id)
    setLoading(false)

    if (!hostPicks && v.length >= members.length && members.length > 0) {
      checkAndAdvance(t, v)
    }
  }

  async function checkAndAdvance(t, v) {
    if (!isHost) return
    const counts = {}
    v.forEach(vt => { counts[vt.topic_id] = (counts[vt.topic_id] || 0) + 1 })
    const maxVotes = Math.max(...Object.values(counts))
    const winners  = t.filter(tp => (counts[tp.id] || 0) === maxVotes)

    if (winners.length > 1) {
      // Égalité — l'hôte tranche
      setTie(true)
      return
    }
    await updateChannelStatus(channel.id, 'debate', { topic: winners[0].text })
  }

  async function handleVote(topicId) {
    if (myVote && !tie) return
    try {
      if (hostPicks || tie) {
        // Choix direct de l'hôte
        await updateChannelStatus(channel.id, 'debate', { topic: topics.find(t => t.id === topicId)?.text })
      } else {
        await voteForTopic(channel.id, member.id, topicId)
        setMyVote(topicId)
        showToast('Vote enregistré ✅')
      }
    } catch (e) {
      showToast('Erreur : ' + e.message)
    }
  }

  // Polling fallback
  useEffect(() => {
    if (!channel) return
    const interval = setInterval(async () => {
      const { data } = await supabase.from('channels').select('status').eq('id', channel.id).single()
      if (data?.status === 'debate') navigate('/debate', { replace: true })
    }, 3000)
    return () => clearInterval(interval)
  }, [channel?.id])

  const totalVotes = votes.length
  const allVoted   = totalVotes >= members.length && members.length > 0

  if (loading) return (
    <div className="page" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div className="spinner" />
      <p className="text-muted text-sm" style={{ marginTop: '1rem' }}>Chargement des sujets…</p>
    </div>
  )

  return (
    <div className="page">
      <div>
        <div className="badge badge-warn" style={{ marginBottom: '0.5rem' }}>
          {hostPicks ? '👑 Choix du sujet' : '🗳️ Vote'}
        </div>
        <h1 className="page-title">Choix du sujet</h1>
        <p className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Thème : {channel?.theme}</p>
      </div>

      {/* Mode vote (3+ joueurs) */}
      {!hostPicks && !tie && (
        <div className="card">
          <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
            <span className="text-sm text-muted">Votes reçus</span>
            <span className="badge badge-accent">{totalVotes} / {members.length}</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: members.length ? `${(totalVotes / members.length) * 100}%` : '0%' }} />
          </div>
        </div>
      )}

      {/* Égalité — hôte tranche */}
      {tie && isHost && (
        <div className="card" style={{ background: 'rgba(251,191,36,0.08)', borderColor: 'var(--warn)' }}>
          <p className="text-sm" style={{ color: 'var(--warn)', fontWeight: 700 }}>⚖️ Égalité ! Tu dois choisir le sujet final.</p>
        </div>
      )}
      {tie && !isHost && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 0.5rem' }} />
          <p className="text-muted text-sm">⚖️ Égalité — l'hôte choisit le sujet…</p>
        </div>
      )}

      {/* Mode hôte choisit directement */}
      {hostPicks && !isHost && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 0.5rem' }} />
          <p className="text-muted text-sm">⏳ L'hôte choisit le sujet du débat…</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {(hostPicks || tie)
          ? <p className="text-sm text-muted">{isHost ? '👆 Choisis le sujet du débat :' : ''}</p>
          : <p className="text-sm text-muted">L'IA propose 3 sujets — vote pour ton préféré :</p>
        }

        {topics.map((topic, i) => {
          const count      = votes.filter(v => v.topic_id === topic.id).length
          const pct        = members.length ? Math.round((count / members.length) * 100) : 0
          const isSelected = myVote === topic.id
          const canClick   = (hostPicks && isHost) || (tie && isHost) || (!hostPicks && !tie && !myVote)

          return (
            <div key={topic.id}
              className={`card ${isSelected ? 'card-glow' : ''}`}
              style={{ cursor: canClick ? 'pointer' : 'default', transition: 'all 0.2s', opacity: !canClick && !isSelected ? 0.6 : 1 }}
              onClick={() => canClick && handleVote(topic.id)}>
              <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
                <span className="badge badge-accent">Sujet {i + 1}</span>
                {isSelected && !hostPicks && <span className="badge badge-success">✓ Mon vote</span>}
                {!hostPicks && <span className="text-sm text-muted">{count} vote{count > 1 ? 's' : ''}</span>}
              </div>
              <p style={{ fontSize: '0.95rem', lineHeight: 1.5, marginBottom: hostPicks ? 0 : '0.5rem' }}>{topic.text}</p>
              {!hostPicks && (
                <div className="progress-bar" style={{ height: 4 }}>
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!hostPicks && !tie && !myVote && (
        <p className="text-center text-sm text-muted">👆 Tape sur un sujet pour voter</p>
      )}
      {!hostPicks && !tie && myVote && !allVoted && (
        <p className="text-center text-sm text-muted">⏳ En attente des autres votes…</p>
      )}
    </div>
  )
}
