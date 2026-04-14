// src/pages/PeerVote.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/AppContext'
import { supabase, submitPeerVote, getPeerVotes, getAiSummaries, updateChannelStatus } from '../lib/supabase'

const CRITERIA = [
  { id: 'logique',     label: '🧠 Logique',     desc: 'L\'argument le plus solide et cohérent' },
  { id: 'clarte',      label: '💬 Clarté',       desc: 'L\'argument le plus clair et compréhensible' },
  { id: 'conviction',  label: '🔥 Conviction',   desc: 'Qui t\'a le plus convaincu ou impressionné' },
]

export default function PeerVote() {
  const navigate = useNavigate()
  const { channel, member, members, showToast } = useApp()
  const [summaries, setSummaries] = useState([])
  const [myVotes, setMyVotes]     = useState({})   // criteria -> memberId
  const [allVotes, setAllVotes]   = useState([])
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading]     = useState(false)

  useEffect(() => {
    if (!channel) { navigate('/', { replace: true }); return }
    if (channel.status === 'manifesto') { navigate('/manifesto', { replace: true }); return }
  }, [channel])

  useEffect(() => {
    if (!channel) return
    loadData()
    const sub = supabase
      .channel(`peervotes:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'peer_votes',
        filter: `channel_id=eq.${channel.id}` }, loadData)
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [channel?.id])

  async function loadData() {
    const [s, v] = await Promise.all([getAiSummaries(channel.id), getPeerVotes(channel.id)])
    setSummaries(s)
    setAllVotes(v)
    const mine = v.filter(x => x.voter_id === member?.id)
    if (mine.length > 0) {
      const map = {}
      mine.forEach(x => { map[x.criteria] = x.voted_for_id })
      setMyVotes(map)
      if (mine.length >= CRITERIA.length) setSubmitted(true)
    }
    // Auto-advance: all members voted on all criteria
    const expectedVotes = members.length * CRITERIA.length
    if (v.length >= expectedVotes && member?.is_host) {
      await updateChannelStatus(channel.id, 'manifesto')
    }
  }

  async function handleSubmit() {
    if (Object.keys(myVotes).length < CRITERIA.length) {
      return showToast('Vote pour chaque critère !')
    }
    setLoading(true)
    try {
      await Promise.all(
        CRITERIA.map(c => submitPeerVote(channel.id, member.id, myVotes[c.id], c.id))
      )
      setSubmitted(true)
      showToast('Votes soumis ✅')
    } catch (e) {
      showToast('Erreur : ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // Count votes per member per criteria
  function getVoteCount(memberId, criteria) {
    return allVotes.filter(v => v.voted_for_id === memberId && v.criteria === criteria).length
  }

  const otherMembers = members.filter(m => m.id !== member?.id)
  const totalVoters  = new Set(allVotes.map(v => v.voter_id)).size

  if (!channel) return null

  return (
    <div className="page">
      <div>
        <div className="badge badge-warn" style={{ marginBottom: '0.5rem' }}>🏆 Vote pair-à-pair</div>
        <h1 className="page-title">Qui a le mieux débattu ?</h1>
        <p className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Vote pour chacun des critères</p>
      </div>

      {/* Progress */}
      <div className="card">
        <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
          <span className="text-sm text-muted">Participants ayant voté</span>
          <span className="badge badge-accent">{totalVoters} / {members.length}</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${members.length ? (totalVoters / members.length) * 100 : 0}%` }} />
        </div>
      </div>

      {!submitted ? (
        <>
          {CRITERIA.map(c => (
            <div key={c.id} className="card">
              <h3 className="fw-bold" style={{ marginBottom: '0.25rem' }}>{c.label}</h3>
              <p className="text-muted text-sm" style={{ marginBottom: '0.75rem' }}>{c.desc}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {otherMembers.map(m => {
                  const selected = myVotes[c.id] === m.id
                  const summary  = summaries.find(s => s.member_id === m.id)
                  return (
                    <button key={m.id}
                      className={`btn ${selected ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ justifyContent: 'flex-start', padding: '0.75rem 1rem', textAlign: 'left', height: 'auto', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}
                      onClick={() => setMyVotes(prev => ({ ...prev, [c.id]: m.id }))}>
                      <div className="flex items-center gap-sm">
                        <div className="avatar" style={{ width: 28, height: 28, fontSize: '0.8rem' }}>{m.name[0]}</div>
                        <strong>{m.name}</strong>
                        {selected && <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>✓</span>}
                      </div>
                      {summary && (
                        <span style={{ fontSize: '0.75rem', color: selected ? 'rgba(255,255,255,0.7)' : 'var(--text2)', marginLeft: '2.25rem', lineHeight: 1.3 }}>
                          {summary.summary?.slice(0, 80)}…
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <button className="btn btn-primary" style={{ padding: '1rem', fontSize: '1.05rem' }}
            onClick={handleSubmit}
            disabled={loading || Object.keys(myVotes).length < CRITERIA.length}>
            {loading
              ? <><span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> Envoi…</>
              : `🗳️ Valider mes ${CRITERIA.length} votes`}
          </button>
        </>
      ) : (
        <div className="card" style={{ textAlign: 'center', gap: '1rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '2.5rem' }}>✅</div>
          <h3 className="fw-bold">Votes soumis !</h3>

          {/* Live tallies */}
          {CRITERIA.map(c => (
            <div key={c.id}>
              <p className="text-sm fw-bold" style={{ marginBottom: '0.5rem' }}>{c.label}</p>
              {members.filter(m => m.id !== member?.id).sort((a, b) => getVoteCount(b.id, c.id) - getVoteCount(a.id, c.id)).map(m => (
                <div key={m.id} className="score-row">
                  <div className="avatar" style={{ width: 24, height: 24, fontSize: '0.7rem', flexShrink: 0 }}>{m.name[0]}</div>
                  <span className="score-label" style={{ width: 'auto', flex: 1, textAlign: 'left', paddingLeft: '0.4rem' }}>{m.name}</span>
                  <div className="score-bar" style={{ maxWidth: 120 }}>
                    <div className="score-bar-fill" style={{ width: members.length > 1 ? `${(getVoteCount(m.id, c.id) / (members.length - 1)) * 100}%` : '0%' }} />
                  </div>
                  <span className="score-num">{getVoteCount(m.id, c.id)}</span>
                </div>
              ))}
            </div>
          ))}

          <p className="text-muted text-sm">⏳ En attente des autres participants…</p>
        </div>
      )}
    </div>
  )
}
