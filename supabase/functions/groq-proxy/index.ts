// supabase/functions/groq-proxy/index.ts
// Deno Edge Function — proxy vers l'API Groq

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GroqRequest {
  action: "suggest_topics" | "summarize_member" | "rank_peers" | "generate_manifesto";
  payload: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
    if (!GROQ_KEY) throw new Error("GROQ_API_KEY not set");

    const body: GroqRequest = await req.json();
    const { action, payload } = body;

    let systemPrompt = "";
    let userPrompt = "";

    // ── 1. Suggest 3 debate topics from a theme ──────────────────────────────
    if (action === "suggest_topics") {
      const { theme } = payload as { theme: string };
      systemPrompt = "Tu es un modérateur de débat expert. Réponds UNIQUEMENT en JSON valide, sans markdown.";
      userPrompt = `Thème choisi : "${theme}".
Propose exactement 3 sujets de débat percutants, formulés comme des questions ouvertes stimulantes.
Réponds UNIQUEMENT avec ce JSON :
{"topics": ["sujet 1", "sujet 2", "sujet 3"]}`;
    }

    // ── 2. Summarize one member's arguments ──────────────────────────────────
    else if (action === "summarize_member") {
      const { member_name, topic, turns } = payload as {
        member_name: string; topic: string; turns: string[];
      };
      systemPrompt = "Tu es un analyste de débat bienveillant mais précis. Réponds en JSON valide uniquement.";
      userPrompt = `Problématique : "${topic}"
Participant : ${member_name}
Arguments exprimés :
${turns.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Analyse cet intervenant et réponds UNIQUEMENT avec ce JSON :
{
  "summary": "résumé de sa position principale en 2-3 phrases",
  "ai_feedback": "analyse de la solidité de ses arguments (forces et faiblesses)",
  "score_logic": <1-10>,
  "score_clarity": <1-10>,
  "score_impact": <1-10>
}`;
    }

    // ── 3. Rank peers with chosen criteria ───────────────────────────────────
    else if (action === "rank_peers") {
      const { topic, members, criteria } = payload as {
        topic: string;
        members: Array<{ name: string; summary: string; scores: Record<string, number> }>;
        criteria: string[];
      };
      systemPrompt = "Tu es un juge de débat impartial. Réponds en JSON valide uniquement.";
      userPrompt = `Problématique : "${topic}"
Critères de jugement choisis : ${criteria.join(", ")}

Participants :
${members.map((m) => `- ${m.name}: ${m.summary} (scores IA: logique=${m.scores.logic}, clarté=${m.scores.clarity}, impact=${m.scores.impact})`).join("\n")}

En tenant compte des critères et des votes des pairs, donne un classement et réponds UNIQUEMENT avec :
{
  "ranking": [
    {"name": "prénom", "rank": 1, "justification": "pourquoi cette place"},
    ...
  ],
  "winner": "prénom du gagnant",
  "overall_analysis": "analyse globale du débat en 3-4 phrases"
}`;
    }

    // ── 4. Generate final manifesto ───────────────────────────────────────────
    else if (action === "generate_manifesto") {
      const { topic, winner, ranking, overall_analysis, members } = payload as {
        topic: string;
        winner: string;
        ranking: Array<{ name: string; rank: number; justification: string }>;
        overall_analysis: string;
        members: Array<{ name: string; summary: string }>;
      };
      systemPrompt = "Tu es un rédacteur politique et philosophique éloquent.";
      userPrompt = `Suite à un débat sur : "${topic}"

Participants et leurs positions :
${members.map((m) => `- ${m.name} : ${m.summary}`).join("\n")}

Gagnant du débat : ${winner}
Analyse globale : ${overall_analysis}

Rédige un Manifeste du Débat inspirant et mémorable (300-400 mots) qui :
1. Capture l'essence de la problématique débattue
2. Honore les arguments de chaque participant
3. Célèbre ${winner} comme vainqueur avec ses arguments clés
4. Se termine par une conclusion universelle sur l'importance du débat démocratique

Écris directement le texte du manifeste, sans JSON, sans titre markdown.`;
    }

    else {
      throw new Error(`Unknown action: ${action}`);
    }

    // Call Groq API
    const groqRes = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        max_tokens: 1500,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      throw new Error(`Groq error ${groqRes.status}: ${err}`);
    }

    const groqData = await groqRes.json();
    const text = groqData.choices?.[0]?.message?.content ?? "";

    // For JSON actions, parse and return; for manifesto return raw text
    if (action === "generate_manifesto") {
      return new Response(JSON.stringify({ result: text }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Strip markdown fences if present
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
