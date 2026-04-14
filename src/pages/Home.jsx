// src/pages/Home.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/AppContext'
import { createChannel, joinChannel } from '../lib/supabase'

const THEMES = [
  '🌍 Environnement & Climat',
  '🤖 Intelligence Artificielle',
  '🏛️ Politique & Démocratie',
  '💰 Économie & Inégalités',
  '🎓 Éducation & Avenir',
  '🧬 Science & Éthique',
  '🏙️ Ville & Société',
  '🌐 Mondialisation',
]

const ROUNDS_OPTIONS   = [{ v: 2, l: '2 rounds — Rapide' }, { v: 3, l: '3 rounds — Standard' }, { v: 4, l: '4 rounds — Intense' }, { v: 5, l: '5 rounds — Marathon' }]
const DURATION_OPTIONS = [{ v: 60, l: '1 min — Express' }, { v: 90, l: '1m30 — Standard' }, { v: 120, l: '2 min — Réfléchi' }, { v: 180, l: '3 min — Approfondi' }]
const CHARS_OPTIONS    = [{ v: 280, l: '280 car. — Tweet' }, { v: 500, l: '500 car. — Standard' }, { v: 800, l: '800 car. — Détaillé' }]
const DIFFICULTY_OPTIONS = [
  { v: 'easy',   l: '🟢 Facile',  desc: 'Sujets accessibles, bien connus' },
  { v: 'medium', l: '🟡 Moyen',   desc: 'Sujets nuancés, quelques enjeux' },
  { v: 'hard',   l: '🔴 Difficile', desc: 'Sujets complexes, controversés' },
]

export default function Home() {
  const navigate = useNavigate()
  const { setChannel, setMember, showToast } = useApp()
  const [mode, setMode]         = useState(null)      // 'create' | 'join'
  const [name, setName]         = useState('')
  const [theme, setTheme]       = useState('')
  const [customTheme, setCustomTheme] = useState('')
  const [code, setCode]         = useState('')
  const [loading, setLoading]   = useState(false)
  const [step, setStep]         = useState(1)         // multi-step for create
  const [maxRounds, setMaxRounds]       = useState(3)
  const [turnDuration, setTurnDuration] = useState(90)
  const [maxChars, setMaxChars]         = useState(500)
  const [difficulty, setDifficulty]     = useState('medium')

  const finalTheme = theme === 'custom' ? customTheme : theme

  async function handleCreate() {
    if (!name.trim()) return showToast('Entre ton prénom 👋')
    if (!finalTheme.trim()) return showToast('Choisis un thème')
    setLoading(true)
    try {
      const { channel, member } = await createChannel(name.trim(), finalTheme, maxRounds, turnDuration, maxChars, difficulty)
      setChannel(channel)
      setMember(member)
      navigate('/lobby')
    } catch (e) {
      showToast('Erreur : ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleJoin() {
    if (!name.trim()) return showToast('Entre ton prénom 👋')
    if (code.trim().length < 4) return showToast('Code invalide')
    setLoading(true)
    try {
      const { channel, member } = await joinChannel(code.trim(), name.trim())
      setChannel(channel)
      setMember(member)
      navigate('/lobby')
    } catch (e) {
      showToast(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page" style={{ justifyContent: 'center', minHeight: '100dvh' }}>
      {/* Logo */}
      <div className="text-center" style={{ marginBottom: '0.5rem' }}>
        <div className="logo" style={{ fontSize: '3rem' }}>⚔️ Debattle</div>
        <p className="text-muted text-sm" style={{ marginTop: '0.5rem' }}>
          Débattez en groupe, jugés par l'IA
        </p>
      </div>

      {!mode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <button className="btn btn-primary" style={{ fontSize: '1.1rem', padding: '1.1rem' }}
            onClick={() => setMode('create')}>
            ✨ Créer un groupe
          </button>
          <button className="btn btn-secondary" style={{ fontSize: '1.1rem', padding: '1.1rem' }}
            onClick={() => setMode('join')}>
            🔗 Rejoindre avec un code
          </button>
          <p className="text-center text-xs text-muted" style={{ marginTop: '0.5rem' }}>
            Pas de compte nécessaire — juste ton prénom
          </p>
        </div>
      )}

      {/* ── CREATE ──────────────────────────────────────────── */}
      {mode === 'create' && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="flex items-center justify-between">
            <h2 className="fw-bold" style={{ fontSize: '1.1rem' }}>Nouveau groupe</h2>
            <div className="steps">
              {[1, 2, 3, 4].map(s => (
                <div key={s} className={`step-dot ${step === s ? 'active' : step > s ? 'done' : ''}`} />
              ))}
            </div>
          </div>

          {step === 1 && (
            <>
              <div>
                <label className="label">Ton prénom</label>
                <input className="input" placeholder="Ex: Maxime"
                  value={name} onChange={e => setName(e.target.value)}
                  maxLength={20} autoFocus />
              </div>
              <button className="btn btn-primary" disabled={!name.trim()}
                onClick={() => setStep(2)}>
                Continuer →
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <label className="label">Thème du débat</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {THEMES.map(t => (
                    <button key={t}
                      className={`btn ${theme === t ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ justifyContent: 'flex-start', padding: '0.7rem 1rem', fontSize: '0.9rem' }}
                      onClick={() => setTheme(t)}>
                      {t}
                    </button>
                  ))}
                  <button
                    className={`btn ${theme === 'custom' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ justifyContent: 'flex-start', padding: '0.7rem 1rem', fontSize: '0.9rem' }}
                    onClick={() => setTheme('custom')}>
                    ✏️ Thème personnalisé…
                  </button>
                  {theme === 'custom' && (
                    <input className="input" placeholder="Décris ton thème"
                      value={customTheme} onChange={e => setCustomTheme(e.target.value)}
                      autoFocus />
                  )}
                </div>
              </div>
              <button className="btn btn-primary" disabled={!finalTheme.trim()}
                onClick={() => setStep(3)}>
                Continuer →
              </button>
              <button className="btn btn-secondary" onClick={() => setStep(1)}>← Retour</button>
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <label className="label">Difficulté des problématiques</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {DIFFICULTY_OPTIONS.map(o => (
                    <button key={o.v}
                      className={`btn ${difficulty === o.v ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ justifyContent: 'flex-start', padding: '0.7rem 1rem', fontSize: '0.9rem' }}
                      onClick={() => setDifficulty(o.v)}>
                      <span>{o.l}</span>
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', opacity: 0.7 }}>{o.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary" onClick={() => setStep(4)}>Continuer →</button>
              <button className="btn btn-secondary" onClick={() => setStep(2)}>← Retour</button>
            </>
          )}

          {step === 4 && (
            <>
              <div>
                <label className="label">Nombre de rounds</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {ROUNDS_OPTIONS.map(o => (
                    <button key={o.v}
                      className={`btn ${maxRounds === o.v ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ justifyContent: 'flex-start', padding: '0.7rem 1rem', fontSize: '0.9rem' }}
                      onClick={() => setMaxRounds(o.v)}>
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Temps de parole</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {DURATION_OPTIONS.map(o => (
                    <button key={o.v}
                      className={`btn ${turnDuration === o.v ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ justifyContent: 'flex-start', padding: '0.7rem 1rem', fontSize: '0.9rem' }}
                      onClick={() => setTurnDuration(o.v)}>
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Limite de caractères</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {CHARS_OPTIONS.map(o => (
                    <button key={o.v}
                      className={`btn ${maxChars === o.v ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ justifyContent: 'flex-start', padding: '0.7rem 1rem', fontSize: '0.9rem' }}
                      onClick={() => setMaxChars(o.v)}>
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary" disabled={loading} onClick={handleCreate}>
                {loading ? <span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> : '🚀 Créer le groupe'}
              </button>
              <button className="btn btn-secondary" onClick={() => setStep(3)}>← Retour</button>
            </>
          )}
        </div>
      )}

      {/* ── JOIN ──────────────────────────────────────────────── */}
      {mode === 'join' && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h2 className="fw-bold" style={{ fontSize: '1.1rem' }}>Rejoindre un groupe</h2>
          <div>
            <label className="label">Ton prénom</label>
            <input className="input" placeholder="Ex: Sophie"
              value={name} onChange={e => setName(e.target.value)}
              maxLength={20} autoFocus />
          </div>
          <div>
            <label className="label">Code du groupe</label>
            <input className="input" placeholder="Ex: WOLF42"
              value={code} onChange={e => setCode(e.target.value.toUpperCase())}
              maxLength={8} style={{ textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: '1.2rem' }} />
          </div>
          <button className="btn btn-primary" disabled={!name.trim() || code.length < 4 || loading}
            onClick={handleJoin}>
            {loading ? <span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> : '🔗 Rejoindre'}
          </button>
          <button className="btn btn-secondary" onClick={() => setMode(null)}>← Retour</button>
        </div>
      )}
    </div>
  )
}
