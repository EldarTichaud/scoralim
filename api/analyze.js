import { createClient } from "@supabase/supabase-js";

/* Ces valeurs sont des clés PUBLIQUES Supabase (identiques à celles de src/supabase.js) —
   elles servent uniquement à vérifier la validité d'un token, pas à s'authentifier en tant qu'admin. */
const SUPABASE_URL = "https://uxhjqinnyyhxjbveyhom.supabase.co";
const SUPABASE_KEY = "sb_publishable_1Ublru-RGZvC7KKlBss1Hg_J5rABoSb";

/* Domaine autorisé à appeler ce proxy en cross-origin (protège contre l'inclusion depuis un site tiers) */
const ALLOWED_ORIGIN = "https://scoralim.vercel.app";

/* Modèle et limite de tokens fixés côté serveur — le client ne peut pas les modifier */
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1000;

export default async function handler(req, res) {
  // CORS : n'autorise que le domaine de production (bloque les appels cross-origin depuis un site tiers)
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Authentification : exige un token de session Supabase valide
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Authentification requise" });
  }

  const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: userData, error: authErr } = await supabaseAuth.auth.getUser(token);
  if (authErr || !userData?.user) {
    return res.status(401).json({ error: "Session invalide ou expirée" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured on server" });

  // Validation minimale du corps de requête
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Requête invalide : 'messages' manquant" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "interleaved-thinking-2025-05-14",
      },
      // model et max_tokens sont fixés côté serveur, ignorés depuis le client
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, messages }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: "Proxy error: " + err.message });
  }
}
