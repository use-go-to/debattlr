// src/lib/AppContext.jsx
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [channel, setChannel]   = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('db_channel')) } catch { return null }
  })
  const [member, setMember]     = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('db_member')) } catch { return null }
  })
  const [members, setMembers]   = useState([])
  const [toast, setToast]       = useState(null)

  // Persist to sessionStorage
  useEffect(() => {
    if (channel) sessionStorage.setItem('db_channel', JSON.stringify(channel))
    else sessionStorage.removeItem('db_channel')
  }, [channel])

  useEffect(() => {
    if (member) sessionStorage.setItem('db_member', JSON.stringify(member))
    else sessionStorage.removeItem('db_member')
  }, [member])

  // Subscribe to channel changes (status, topic updates)
  useEffect(() => {
    if (!channel) return
    const sub = supabase
      .channel(`channel:${channel.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'channels',
        filter: `id=eq.${channel.id}`
      }, (payload) => {
        setChannel(prev => ({ ...prev, ...payload.new }))
      })
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [channel?.id])

  // Subscribe to members list
  useEffect(() => {
    if (!channel) return
    const fetchMembers = async () => {
      const { data } = await supabase
        .from('members').select('*').eq('channel_id', channel.id).order('joined_at')
      if (data) setMembers(data)
    }
    fetchMembers()
    const sub = supabase
      .channel(`members:${channel.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'members',
        filter: `channel_id=eq.${channel.id}`
      }, fetchMembers)
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [channel?.id])

  const showToast = useCallback((msg, duration = 2500) => {
    setToast(msg)
    setTimeout(() => setToast(null), duration)
  }, [])

  const reset = useCallback(() => {
    setChannel(null)
    setMember(null)
    setMembers([])
    sessionStorage.clear()
  }, [])

  return (
    <AppContext.Provider value={{ channel, setChannel, member, setMember, members, showToast, reset }}>
      {children}
      {toast && <div className="toast">{toast}</div>}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be inside AppProvider')
  return ctx
}
