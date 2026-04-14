// src/pages/Public.jsx
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getManifestoBySlug } from '../lib/supabase'

export default function Public() {
  const { slug } = useParams()
  const navigate  = useNavigate()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const result = await getManifestoBySlug(slug)
        setData(result)
      } catch {
        setError('Manifeste introuvable.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [slug])

  function handleShare() {
    if (navigator.share) {
      navigator.share({ title: 'Manifeste Debattle', url: window.location.href })
    } else {
      navigator.clipboard.writeText(window.location.href)
    }
  }

  if (loading) return (
    <div className="page" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div className="spinner" />
    </div>
  )

  if (error) return (
    <div className="page" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <p style={{ fontSize: '3rem' }}>🔍</p>
      <p className="fw-bold" style={{ marginTop: '1rem' }}>{error}</p>
      <button className="btn btn-primary" style={{ marginTop: '1.5rem' }} onClick={() => navigate('/')}>
        Créer un débat
      </button>
    </div>
  )

  return (
    <div className="page">
      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{ fontSize: '2.5rem' }}>⚔️</div>
        <div className="logo" style={{ marginTop: '0.25rem' }}>Debattle</div>
        <p className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Manifeste public</p>
      </div>

      {/* Meta */}
      <div className="card" style={{ textAlign: 'center' }}>
        <div className="badge badge-accent" style={{ justifyContent: 'center', marginBottom: '0.5rem' }}>
          🌐 Débat public
        </div>
        <h2 className="fw-bold" style={{ fontSize: '1.1rem', lineHeight: 1.4, color: 'var(--accent2)' }}>
          {data.channels?.theme || 'Débat'}
        </h2>
        {data.winner_name && (
          <div style={{ marginTop: '0.75rem' }}>
            <p className="text-muted text-xs">Gagnant</p>
            <p className="fw-bold text-accent" style={{ fontSize: '1.2rem' }}>🏆 {data.winner_name}</p>
          </div>
        )}
      </div>

      {/* Manifesto */}
      <div className="card" style={{ background: 'linear-gradient(135deg, rgba(124,106,247,0.06), rgba(167,139,250,0.04))' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: '1rem' }}>
          <h3 className="fw-bold">📜 Le Manifeste</h3>
          <span className="badge badge-accent">IA Generated</span>
        </div>
        <p className="manifesto-text">{data.content}</p>
      </div>

      {/* Footer actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <button className="btn btn-primary" onClick={handleShare}>
          📤 Partager ce manifeste
        </button>
        <button className="btn btn-secondary" onClick={() => navigate('/')}>
          ✨ Créer mon propre débat
        </button>
      </div>

      <p className="text-center text-xs text-muted">
        Généré avec Debattle — débats assistés par IA
      </p>
    </div>
  )
}
