# ⚔️ Debattle

> Débattez en groupe, guidés et jugés par l'IA. PWA mobile-first (Android & iOS).


groq api key : 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

supbase : database password : g4SllyrqSqN8BI46

spabase url : https://yrgujorbihfdudnsmbgb.supabase.co

supabase anon : eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyZ3Vqb3JiaWhmZHVkbnNtYmdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMjg0NzAsImV4cCI6MjA5MTcwNDQ3MH0.5sy718XLR3IFGFYsdzP4mDBfKjg1SQ8sLKvAxP5Ix-w

supabase service role : eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyZ3Vqb3JiaWhmZHVkbnNtYmdiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjEyODQ3MCwiZXhwIjoyMDkxNzA0NDcwfQ.2A6FDKFOrufDqsXLReNa1KIesR-QmZ9Zvix0CogXiQ4


SUPABASE_PROJECT_REF: yrgujorbihfdudnsmbgb

SUPABASE_ACCESS_TOKEN : sbp_f3d074022fd0bb303737b5b04daba1dc2f74ab97


---

## 🚀 Stack technique

| Couche | Techno |
|---|---|
| Frontend | React 18 + Vite + React Router |
| PWA | vite-plugin-pwa (offline, installable) |
| Backend/DB | Supabase (PostgreSQL + Realtime + Edge Functions) |
| IA | Groq API (llama3-70b-8192) via Edge Function |
| Déploiement | Vercel (frontend) + Supabase (functions) |
| CI/CD | GitHub Actions |

---

## 📱 Fonctionnement

```
Accueil
├── Créer un groupe  → saisit prénom + thème → code généré (ex: WOLF42)
└── Rejoindre        → saisit prénom + code

Lobby (salle d'attente)
└── Hôte voit tous les membres en temps réel
    └── Lance → l'IA propose 3 sujets (Groq)

Vote du sujet
└── Chaque membre vote → sujet gagnant automatiquement sélectionné

Débat (3 tours)
├── Timer 90s par prise de parole
├── Réfutation directe d'un argument
└── L'hôte peut terminer manuellement

Analyse IA individuelle
└── Groq analyse chaque participant : résumé, feedback, scores logique/clarté/impact

Vote pair-à-pair
└── Chaque participant vote pour les autres sur 3 critères (logique, clarté, conviction)

Manifeste final
├── Groq génère un classement + texte de manifeste éloquent
└── Page publique partageable (/p/:slug)
```

---

## 🛠️ Installation locale

### 1. Cloner et installer

```bash
git clone https://github.com/TON_USERNAME/debattle.git
cd debattle
npm install
```

### 2. Configurer Supabase

1. Crée un projet sur [supabase.com](https://supabase.com)
2. Dans **SQL Editor**, exécute dans l'ordre :
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_rpc_helpers.sql`
3. Récupère ton **URL** et **anon key** dans Settings → API

### 3. Variables d'environnement

```bash
cp .env.example .env
# Édite .env avec tes vraies clés Supabase
```

### 4. Déployer la Edge Function Groq

```bash
# Installer Supabase CLI
npm install -g supabase

# Login
supabase login

# Lier au projet
supabase link --project-ref TON_PROJECT_REF

# Déployer la fonction
supabase functions deploy groq-proxy

# Configurer la clé Groq (obtenir sur console.groq.com)
supabase secrets set GROQ_API_KEY=gsk_TON_API_KEY
```

### 5. Lancer en dev

```bash
npm run dev
# → http://localhost:3000
```

---

## 🚢 Déploiement production

### Vercel (frontend)

1. Connecte le repo GitHub sur [vercel.com](https://vercel.com)
2. Ajoute les variables d'env dans Vercel :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Deploy !

### GitHub Actions (CI/CD automatique)

Ajoute ces **secrets** dans Settings → Secrets → Actions :

| Secret | Valeur |
|---|---|
| `VITE_SUPABASE_URL` | URL du projet Supabase |
| `VITE_SUPABASE_ANON_KEY` | Anon key Supabase |
| `SUPABASE_ACCESS_TOKEN` | `supabase login` → token |
| `SUPABASE_PROJECT_REF` | ID du projet Supabase |
| `GROQ_API_KEY` | Clé API Groq |
| `VERCEL_TOKEN` | Token Vercel |
| `VERCEL_ORG_ID` | ID org Vercel |
| `VERCEL_PROJECT_ID` | ID projet Vercel |

Le pipeline se déclenche automatiquement à chaque push sur `main`.

---

## 📲 Installation PWA

**Android (Chrome) :**  
Menu → "Ajouter à l'écran d'accueil"

**iOS (Safari) :**  
Bouton Partager → "Sur l'écran d'accueil"

---

## 🗂️ Structure du projet

```
debattle/
├── src/
│   ├── pages/
│   │   ├── Home.jsx          # Accueil / créer / rejoindre
│   │   ├── Lobby.jsx         # Salle d'attente
│   │   ├── TopicVote.jsx     # Vote sur la problématique
│   │   ├── Debate.jsx        # Interface de débat
│   │   ├── AiSummary.jsx     # Analyse IA individuelle
│   │   ├── PeerVote.jsx      # Vote pair-à-pair
│   │   ├── Manifesto.jsx     # Résultats + manifeste
│   │   └── Public.jsx        # Page publique partageable
│   └── lib/
│       ├── supabase.js       # Client + helpers DB
│       ├── AppContext.jsx    # État global React
│       └── global.css        # Design system mobile-first
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql
│   │   └── 002_rpc_helpers.sql
│   ├── functions/
│   │   └── groq-proxy/index.ts  # Edge Function Groq
│   └── config.toml
├── .github/workflows/
│   └── deploy.yml            # CI/CD GitHub Actions
├── public/
│   └── favicon.svg
├── .env.example
├── vercel.json
├── vite.config.js
└── index.html
```

---

## 🔑 Obtenir les clés API

- **Supabase** : [supabase.com](https://supabase.com) → nouveau projet → Settings → API
- **Groq** (gratuit) : [console.groq.com](https://console.groq.com) → API Keys → Create
- **Vercel** : [vercel.com](https://vercel.com) → Settings → Tokens

---

## 📄 Licence

MIT — libre d'utilisation et modification.
