// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('⚠️  Variables VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY manquantes dans .env')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ─── Channel helpers ──────────────────────────────────────────────────────────

export async function createChannel(hostName, theme) {
  // Generate a unique code via DB function
  const { data: codeData } = await supabase.rpc('generate_channel_code')
  const code = codeData

  const { data: channel, error } = await supabase
    .from('channels')
    .insert({ code, host_name: hostName, theme, status: 'lobby' })
    .select()
    .single()

  if (error) throw error

  // Add host as first member
  const { data: member, error: mErr } = await supabase
    .from('members')
    .insert({ channel_id: channel.id, name: hostName, is_host: true })
    .select()
    .single()

  if (mErr) throw mErr

  return { channel, member }
}

export async function joinChannel(code, name) {
  const { data: channel, error } = await supabase
    .from('channels')
    .select('*')
    .eq('code', code.toUpperCase())
    .single()

  if (error || !channel) throw new Error('Canal introuvable. Vérifie le code.')

  if (channel.status !== 'lobby') throw new Error('Ce débat a déjà commencé.')

  const { data: member, error: mErr } = await supabase
    .from('members')
    .insert({ channel_id: channel.id, name, is_host: false })
    .select()
    .single()

  if (mErr) {
    if (mErr.code === '23505') throw new Error(`Le prénom "${name}" est déjà pris dans ce canal.`)
    throw mErr
  }

  return { channel, member }
}

export async function getChannelByCode(code) {
  const { data, error } = await supabase
    .from('channels')
    .select('*')
    .eq('code', code)
    .single()
  if (error) throw error
  return data
}

export async function getMembers(channelId) {
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('channel_id', channelId)
    .order('joined_at')
  if (error) throw error
  return data
}

export async function updateChannelStatus(channelId, status, extra = {}) {
  const { error } = await supabase
    .from('channels')
    .update({ status, ...extra })
    .eq('id', channelId)
  if (error) throw error
}

// ─── Groq proxy helper ────────────────────────────────────────────────────────

export async function callGroq(action, payload) {
  const { data, error } = await supabase.functions.invoke('groq-proxy', {
    body: { action, payload }
  })
  if (error) throw error
  return data
}

// ─── Topics helpers ───────────────────────────────────────────────────────────

export async function saveTopics(channelId, topics) {
  const rows = topics.map((text, i) => ({ channel_id: channelId, text, position: i + 1, votes: 0 }))
  const { data, error } = await supabase.from('topics').insert(rows).select()
  if (error) throw error
  return data
}

export async function getTopics(channelId) {
  const { data, error } = await supabase
    .from('topics')
    .select('*')
    .eq('channel_id', channelId)
    .order('position')
  if (error) throw error
  return data
}

export async function voteForTopic(channelId, memberId, topicId) {
  // Insert vote
  const { error: vErr } = await supabase
    .from('topic_votes')
    .insert({ channel_id: channelId, member_id: memberId, topic_id: topicId })
  if (vErr) throw vErr

  // Increment votes count
  const { error: uErr } = await supabase.rpc('increment_topic_votes', { p_topic_id: topicId })
  // Fallback if RPC doesn't exist — manual update
  if (uErr) {
    const { data: topic } = await supabase.from('topics').select('votes').eq('id', topicId).single()
    await supabase.from('topics').update({ votes: (topic?.votes || 0) + 1 }).eq('id', topicId)
  }
}

export async function getTopicVotes(channelId) {
  const { data, error } = await supabase
    .from('topic_votes')
    .select('*')
    .eq('channel_id', channelId)
  if (error) throw error
  return data
}

// ─── Debate helpers ───────────────────────────────────────────────────────────

export async function submitDebateTurn(channelId, memberId, memberName, round, content, rebuttalTo = null) {
  const { data, error } = await supabase
    .from('debate_turns')
    .insert({ channel_id: channelId, member_id: memberId, member_name: memberName, round, content, rebuttal_to: rebuttalTo })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getDebateTurns(channelId) {
  const { data, error } = await supabase
    .from('debate_turns')
    .select('*')
    .eq('channel_id', channelId)
    .order('submitted_at')
  if (error) throw error
  return data
}

// ─── AI Summary helpers ────────────────────────────────────────────────────────

export async function saveAiSummary(channelId, memberId, memberName, summaryData) {
  const { error } = await supabase
    .from('ai_summaries')
    .upsert({
      channel_id: channelId,
      member_id: memberId,
      member_name: memberName,
      ...summaryData
    })
  if (error) throw error
}

export async function getAiSummaries(channelId) {
  const { data, error } = await supabase
    .from('ai_summaries')
    .select('*')
    .eq('channel_id', channelId)
  if (error) throw error
  return data
}

// ─── Peer vote helpers ────────────────────────────────────────────────────────

export async function submitPeerVote(channelId, voterId, votedForId, criteria) {
  const { error } = await supabase
    .from('peer_votes')
    .upsert({ channel_id: channelId, voter_id: voterId, voted_for_id: votedForId, criteria })
  if (error) throw error
}

export async function getPeerVotes(channelId) {
  const { data, error } = await supabase
    .from('peer_votes')
    .select('*')
    .eq('channel_id', channelId)
  if (error) throw error
  return data
}

// ─── Manifesto helpers ────────────────────────────────────────────────────────

export async function saveManifesto(channelId, content, winnerName) {
  const slug = Math.random().toString(36).slice(2, 10)
  const { error } = await supabase
    .from('manifesto')
    .upsert({ channel_id: channelId, content, winner_name: winnerName, public_slug: slug })
  if (error) throw error
  return slug
}

export async function getManifestoBySlug(slug) {
  const { data, error } = await supabase
    .from('manifesto')
    .select('*, channels(theme, code)')
    .eq('public_slug', slug)
    .single()
  if (error) throw error
  return data
}

export async function getManifestoByChannel(channelId) {
  const { data, error } = await supabase
    .from('manifesto')
    .select('*')
    .eq('channel_id', channelId)
    .single()
  if (error) throw error
  return data
}
