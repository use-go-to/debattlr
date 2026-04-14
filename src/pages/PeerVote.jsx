// src/pages/PeerVote.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/AppContext'
import { supabase, submitPeerVote, getPeerVotes, getAiSummaries, updateChannelStatus } from '../lib/supabase'

const CRITERIA = [
  { id: 'logique',    label: '🧠 Logique',    desc: 'L\'argument le plus solide et cohérent' },
  { id: 'clarte',     label: '💬 Clarté',      desc: 'L\'argument le plus clair et compréhensible' },
  { id: 'conviction', label: '🔥 Conviction',  desc: 'Qui t\'a le plus convaincu ou impressionné' },
]

export default function PeerVote() {
  const navigate = useNavigate()
  const { channel, member, members, showToast } = useApp()
  const [summaries, setSummaries]   = useState([])
  const [myVotes, setMyVotes]       = useState({})
  const [allVotes, setAllVotes]     = useState([])
  const [submitted, setSubmitted]   = useState(false)
  const [loading, setLoading]       = useState(false)
  const [memberCount, setMemberCount] = useState(0)

  const skipVote = memberCount > 0 && memberCount <= 2

  useEffect(() => {
    if (!channel) { navigate('/', { replace: true }); return }
    if (channel.status === 'manifesto') { navigate('/manifesto', { replace: true }); return }
  }, [channel])

  // Polling fallback
  useEffect(() => {
    if (!channel) return
    const interval = setInterval(async () => {
      const { data } = await supabase.from('channels').select('status').eq('id', channel.id).single()
      if (data?.status === 'manifesto') navigate('/manifesto', { replace: true })
    }, 3000)
    return () => clearInterval(interval)
  }, [channel?.id])

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
    const [s, v, m] = await Promise.all([
      getAiSummaries(channel.id),
      getPeerVotes(channel.id),
      supabase.from('members').select('id').eq('channel_id', channel.id)
    ])
    const count = m.data?.length || members.length
    setMemberCount(count)
    setSummaries(s)
    setAllVotes(v)
    const mine = v.filter(x => x.voter_id === member?.id)
    if (mine.length > 0) {
      const map = {}
      mine.forEach(x => { map[x.criteria] = x.voted_for_id })
      setMyVotes(map)
      if (mine.length >= CRITERIA.length) setSubmitted(true)
    }
  }

  async function handleSubmit() {
    if (Object.keys(myVotes).length < CRITERIA.length) return showToast('Vote pour chaque critère !')
    setLoading(true)
    try {
      await Promise.all(CRITERIA.map(c => submitPeerVote(channel.id, member.id, myVotes[c.id], c.id)))
      setSubmitted(true)
      showToast('Votes soumis ✅')
    } catch (e) {
      showToast('Erreur : ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  function getVoteCount(memberId, criteria) {
    return allVotes.filter(v => v.voted_for_id === memberId && v.criteria === criteria).length
  }

  const otherMembers  = members.filter(m => m.id !== member?.id)
  const totalVoters   = new Set(allVotes.map(v => v.voter_id)).size
  const skipVote      = memberCount <= 2
  const allSubmitted  = totalVoters >= memberCount

  if (!channel || memberCount === 0) return (
    <div className="page" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div className="spinner" />
    </div>
  )

  // 2 joueurs — skip le vote, hôte passe directement
  if (skipVote) {
    return (
      <div className="page">
        <div>
          <div className="badge badge-warn" style={{ marginBottom: '0.5rem' }}>🏆 Résultats</div>
          <h1 className="page-title">Fin du débat</h1>
          <p className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>{channel.topic}</p>
        </div>
        <div className="card" style={{ textAlign: 'center', gap: '1rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '2.5rem' }}>⚔️</div>
          <p className="text-muted text-sm">Le débat est terminé. L'IA va maintenant générer le classement et le manifeste final.</p>
        </div>
        {member?.is_host && (
          <button className="btn btn-primary" style={{ fontSize: '1.05rem' }}
            onClick={() => updateChannelStatus(channel.id, 'manifesto')}>
            🏆 Voir le classement final →
          </button>
        )}
        {!member?.is_host && (
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="spinner" style={{ margin: '0 auto 0.75rem' }} />
            <p className="text-muted text-sm">⏳ En attente de l'hôte…</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="page">
      <div>
        <div className="badge badge-warn" style={{ marginBottom: '0.5rem' }}>🏆 Vote pair-à-pair</div>
        <h1 className="page-title">Qui a le mieux débattu ?</h1>
        <p className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Vote pour chacun des critères</p>
      </div>

      <div className="card">
        <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
          <span className="text-sm text-muted">Participants ayant voté</span>
          <span className="badge badge-accent">{totalVoters} / {memberCount}</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${memberCount ? (totalVoters / memberCount) * 100 : 0}%` }} />
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
        <div className="card" style={{ gap: '1rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem' }}>✅</div>
            <h3 className="fw-bold" style={{ marginTop: '0.5rem' }}>Votes soumis !</h3>
          </div>

          {CRITERIA.map(c => (
            <div key={c.id}>
              <p className="text-sm fw-bold" style={{ marginBottom: '0.5rem' }}>{c.label}</p>
              {members.filter(m => m.id !== member?.id).sort((a, b) => getVoteCount(b.id, c.id) - getVoteCount(a.id, c.id)).map(m => (
                <div key={m.id} className="score-row">
                  <div className="avatar" style={{ width: 24, height: 24, fontSize: '0.7rem', flexShrink: 0 }}>{m.name[0]}</div>
                  <span className="score-label" style={{ width: 'auto', flex: 1, textAlign: 'left', paddingLeft: '0.4rem' }}>{m.name}</span>
                  <div className="score-bar" style={{ maxWidth: 120 }}>
                    <div className="score-bar-fill" style={{ width: memberCount > 1 ? `${(getVoteCount(m.id, c.id) / (memberCount - 1)) * 100}%` : '0%' }} />
                  </div>
                  <span className="score-num">{getVoteCount(m.id, c.id)}</span>
                </div>
              ))}
            </div>
          ))}

          {allSubmitted && member?.is_host ? (
            <button className="btn btn-primary" onClick={() => updateChannelStatus(channel.id, 'manifesto')}>
              🏆 Voir le classement final →
            </button>
          ) : (
            <p className="text-muted text-sm" style={{ textAlign: 'center' }}>⏳ En attente des autres participants…</p>
          )}
        </div>
      )}
    </div>
  )
}
