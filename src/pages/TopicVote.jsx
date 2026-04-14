// src/pages/TopicVote.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/AppContext'
import { supabase } from '../lib/supabase'
import { getTopics, getTopicVotes, voteForTopic, updateChannelStatus } from '../lib/supabase'

export default function TopicVote() {
  const navigate = useNavigate()
  const { channel, member, members, showToast } = useApp()
  const [topics, setTopics]       = useState([])
  const [votes, setVotes]         = useState([])   // topic_votes rows
  const [myVote, setMyVote]       = useState(null)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    if (!channel) { navigate('/', { replace: true }); return }
    if (channel.status === 'debate') { navigate('/debate', { replace: true }); return }
  }, [channel])

  useEffect(() => {
    if (!channel) return
    load()
    // Subscribe to topics updates (vote counts)
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
    const [t, v] = await Promise.all([
      getTopics(channel.id),
      getTopicVotes(channel.id)
    ])
    setTopics(t)
    setVotes(v)
    const mine = v.find(vt => vt.member_id === member?.id)
    if (mine) setMyVote(mine.topic_id)
    setLoading(false)

    // Auto-advance: all members voted → host picks winner
    if (v.length >= members.length && members.length > 0) {
      checkAndAdvance(t, v)
    }
  }

  async function checkAndAdvance(t, v) {
    if (!member?.is_host) return
    // Find topic with most votes
    const counts = {}
    v.forEach(vt => { counts[vt.topic_id] = (counts[vt.topic_id] || 0) + 1 })
    let winner = null; let max = 0
    t.forEach(tp => {
      if ((counts[tp.id] || 0) > max) { max = counts[tp.id] || 0; winner = tp }
    })
    if (!winner) return
    await updateChannelStatus(channel.id, 'debate', { topic: winner.text })
  }

  async function handleVote(topicId) {
    if (myVote) return
    try {
      await voteForTopic(channel.id, member.id, topicId)
      setMyVote(topicId)
      showToast('Vote enregistré ✅')
    } catch (e) {
      showToast('Erreur : ' + e.message)
    }
  }

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
        <div className="badge badge-warn" style={{ marginBottom: '0.5rem' }}>🗳️ Vote</div>
        <h1 className="page-title">Choix du sujet</h1>
        <p className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Thème : {channel?.theme}</p>
      </div>

      <div className="card">
        <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
          <span className="text-sm text-muted">Votes reçus</span>
          <span className="badge badge-accent">{totalVotes} / {members.length}</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: members.length ? `${(totalVotes / members.length) * 100}%` : '0%' }} />
        </div>
        {allVoted && member?.is_host && (
          <p className="text-sm text-success" style={{ marginTop: '0.5rem', textAlign: 'center' }}>
            ✅ Tous ont voté — passage en débat…
          </p>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <p className="text-sm text-muted">L'IA propose 3 sujets — vote pour ton préféré :</p>
        {topics.map((topic, i) => {
          const count = votes.filter(v => v.topic_id === topic.id).length
          const pct   = members.length ? Math.round((count / members.length) * 100) : 0
          const isSelected = myVote === topic.id
          return (
            <div key={topic.id}
              className={`card ${isSelected ? 'card-glow' : ''}`}
              style={{ cursor: myVote ? 'default' : 'pointer', transition: 'all 0.2s' }}
              onClick={() => handleVote(topic.id)}>
              <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
                <span className="badge badge-accent">Sujet {i + 1}</span>
                {isSelected && <span className="badge badge-success">✓ Mon vote</span>}
                <span className="text-sm text-muted">{count} vote{count > 1 ? 's' : ''}</span>
              </div>
              <p style={{ fontSize: '0.95rem', lineHeight: 1.5, marginBottom: '0.5rem' }}>{topic.text}</p>
              <div className="progress-bar" style={{ height: 4 }}>
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      {!myVote && (
        <p className="text-center text-sm text-muted">👆 Tape sur un sujet pour voter</p>
      )}
    </div>
  )
}
