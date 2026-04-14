// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider } from './lib/AppContext'
import './lib/global.css'

import Home       from './pages/Home'
import Lobby      from './pages/Lobby'
import TopicVote  from './pages/TopicVote'
import Debate     from './pages/Debate'
import AiSummary  from './pages/AiSummary'
import PeerVote   from './pages/PeerVote'
import Manifesto  from './pages/Manifesto'
import Public     from './pages/Public'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route path="/"           element={<Home />} />
          <Route path="/lobby"      element={<Lobby />} />
          <Route path="/vote"       element={<TopicVote />} />
          <Route path="/debate"     element={<Debate />} />
          <Route path="/summary"    element={<AiSummary />} />
          <Route path="/peervote"   element={<PeerVote />} />
          <Route path="/manifesto"  element={<Manifesto />} />
          <Route path="/p/:slug"    element={<Public />} />
          <Route path="*"           element={<Navigate to="/" replace />} />
        </Routes>
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>
)
