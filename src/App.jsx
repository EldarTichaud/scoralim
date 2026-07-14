import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";
import * as mammoth from "mammoth";
import JSZip from "jszip";
import * as pdfjsLib from "pdfjs-dist";
import { jsPDF } from "jspdf";
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

/* ─── QUESTIONNAIRES VIERGES (téléchargement) ───────────────────── */
const BLANK_FILES = {
  DEBQ:  { pdf: "/questionnaires/DEBQ_questionnaire.pdf",  docx: "/questionnaires/DEBQ_questionnaire.docx" },
  IES2:  { pdf: "/questionnaires/IES2_questionnaire.pdf",  docx: "/questionnaires/IES2_questionnaire.docx" },
  BES:   { pdf: "/questionnaires/BES_questionnaire.pdf",   docx: "/questionnaires/BES_questionnaire.docx" },
  EQVOD: { pdf: "/questionnaires/EQVOD_questionnaire.pdf", docx: "/questionnaires/EQVOD_questionnaire.docx" },
};

/* ─── CONFIG ─────────────────────────────────────────────────── */
const CONFIGS = {
  DEBQ: {
    name: "DEBQ", fullName: "Dutch Eating Behavior Questionnaire",
    color: "#4f46e5", light: "#eef2ff", itemCount: 33,
    caption: "33 items · Restriction · Émotionnel · Externe",
    subscales: [
      { key: "restriction", label: "Restriction cognitive",       items: [4,7,11,14,17,19,22,26,29,31] },
      { key: "emotionnel",  label: "Alimentation émotionnelle",   items: [1,3,5,8,10,13,16,20,23,25,28,32] },
      { key: "externe",     label: "Alimentation externe",        items: [2,6,9,12,15,18,21,24,27,30,33] },
    ],
    reverseItems: [21],
    norms: {
      restriction: { low: 2.0, high: 3.0, ref: "seuil ≥ 3" },
      emotionnel:  { low: 2.0, high: 3.0, ref: "seuil ≥ 3" },
      externe:     { low: 2.0, high: 3.0, ref: "seuil ≥ 3" },
    },
    ref: "van Strien et al. (1986)"
  },
  IES2: {
    name: "IES-2", fullName: "Intuitive Eating Scale-2",
    color: "#059669", light: "#ecfdf5", itemCount: 18,
    caption: "18 items · 3 dimensions · Alimentation intuitive",
    subscales: [
      { key: "permission",  label: "Permission inconditionnelle",          items: [1,3,8,15] },
      { key: "physique",    label: "Raisons physiques vs émotionnelles",   items: [2,4,9,10,11,12,13,14] },
      { key: "signaux",     label: "Signaux faim / satiété",               items: [5,6,7,16,17,18] },
    ],
    reverseItems: [1,2,3,4,8,9,10],
    ref: "Tylka & Kroon Van Diest (2013)"
  },
  BES: {
    name: "BES", fullName: "Binge Eating Scale",
    color: "#d97706", light: "#fffbeb", itemCount: 16,
    caption: "16 items · Accès hyperphagiques",
    weights: [
      [0,0,1,3],   // item 1
      [0,1,2,3],   // item 2
      [0,1,3,3],   // item 3
      [0,0,0,2],   // item 4
      [0,1,2,3],   // item 5
      [0,1,3],     // item 6 — 3 propositions
      [0,2,3,3],   // item 7
      [0,1,2,3],   // item 8
      [0,1,2,3],   // item 9
      [0,1,2,3],   // item 10
      [0,1,2,3],   // item 11
      [0,1,2,3],   // item 12
      [0,0,2,3],   // item 13
      [0,1,2,3],   // item 14
      [0,1,2,3],   // item 15
      [0,1,2],     // item 16 — 3 propositions
    ],
    thresholds: [
      { min:0,  max:17, label:"Absent / Minimal",            color:"#16a34a", bg:"#f0fdf4" },
      { min:18, max:26, label:"Modéré (probable BED)",       color:"#d97706", bg:"#fffbeb" },
      { min:27, max:46, label:"Sévère",                      color:"#dc2626", bg:"#fef2f2" },
    ],
    ref: "Gormally et al. (1982)"
  },
  EQVOD: {
    name: "EQVOD", fullName: "Échelle Qualité de Vie, Obésité et Diététique",
    color: "#0891b2", light: "#ecfeff", itemCount: 36,
    caption: "36 items · 5 dimensions · Qualité de vie",
    // Pour chaque dimension : items (1-based), min brut, max brut
    subscales: [
      { key: "physique",     label: "Impact physique",             items: [1,2,3,4,5,6,7,8,9,10,11],    minBrut: 11, maxBrut: 55 },
      { key: "psychosocial", label: "Impact psycho-social",        items: [12,13,14,15,16,17,18,19,20,21,22], minBrut: 11, maxBrut: 55 },
      { key: "sexuelle",     label: "Impact sur la vie sexuelle",  items: [23,24,25,26],                 minBrut: 4,  maxBrut: 20 },
      { key: "bienetre",     label: "Bien-être alimentaire",       items: [27,28,29,30,31],              minBrut: 5,  maxBrut: 25 },
      { key: "regime",       label: "Vécu du régime / Diététique", items: [32,33,34,35,36],              minBrut: 5,  maxBrut: 25 },
    ],
    ref: "Ziegler O et al. Diabetes Metab 2005;31:273-283"
  }
};

/* Logique commune : parse le texte DEBQ (cases ☒/☐) quel que soit l'origine */
function parseDebqText(text) {
  const allBoxes = [];
  const boxRe = /([☒☐])\s*([^☒☐]{1,120})/g;
  let m;
  while ((m = boxRe.exec(text)) !== null) {
    allBoxes.push({ mark: m[1], label: m[2].trim() });
  }
  const groups = [];
  let current = [];
  for (const box of allBoxes) {
    if (box.label.toLowerCase().startsWith("jamais") && current.length > 0) {
      groups.push(current);
      current = [box];
    } else {
      current.push(box);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups.map(grp => {
    const checked = grp.find(b => b.mark === "☒");
    if (!checked) return { v: null, c: 0 };
    const ll = checked.label.toLowerCase();
    let v;
    if (ll.startsWith("je ") || ll.startsWith("j\u2019") || ll.startsWith("j'")) v = 0;
    else if (ll.startsWith("très souvent")) v = 5;
    else if (ll.startsWith("souvent"))      v = 4;
    else if (ll.startsWith("parfois"))      v = 3;
    else if (ll.startsWith("rarement"))     v = 2;
    else if (ll.startsWith("jamais"))       v = 1;
    else                                     v = null;
    return { v, c: v !== null ? 1 : 0 };
  });
}

/* Parse un DOCX DEBQ : extrait le texte des balises <w:t> puis parse */
function parseDebqDocx(xml) {
  const textBlocks = [];
  const tagRe = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let m;
  while ((m = tagRe.exec(xml)) !== null) textBlocks.push(m[1]);
  return parseDebqText(textBlocks.join(" "));
}

/* Parse le texte BES (cases ☒/☐, options numérotées 1- à 4-) */
function parseBesText(text) {
  const allBoxes = [];
  const boxRe = /([☒☐])\s*([^☒☐]{1,150})/g;
  let m;
  while ((m = boxRe.exec(text)) !== null) {
    allBoxes.push({ mark: m[1], label: m[2].trim() });
  }
  // Grouper par question : chaque groupe commence par l'option "1-"
  const groups = [];
  let current = [];
  for (const box of allBoxes) {
    if (/^1[\-\s]/.test(box.label) && current.length > 0) {
      groups.push(current);
      current = [box];
    } else {
      current.push(box);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups.map(grp => {
    const checked = grp.find(b => b.mark === "☒");
    if (!checked) return { v: null, c: 0 };
    const numMatch = checked.label.match(/^(\d)/);
    const v = numMatch ? parseInt(numMatch[1]) - 1 : null; // 0-based index pour calcScores
    return { v, c: v !== null ? 1 : 0 };
  });
}

/* Parse un DOCX BES : extrait le texte des balises <w:t> puis parse */
function parseBesDocx(xml) {
  const textBlocks = [];
  const tagRe = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let m;
  while ((m = tagRe.exec(xml)) !== null) textBlocks.push(m[1]);
  return parseBesText(textBlocks.join(" "));
}

/* Parse le texte IES-2 (cases ☒/☐, options Pas du tout d'accord → Tout à fait d'accord) */
function parseIesText(text) {
  const IES_LABELS = [
    "Pas du tout d\u2019accord",
    "Plut\u00f4t pas d\u2019accord",
    "Ni d\u2019accord, ni pas d\u2019accord",
    "Plut\u00f4t d\u2019accord",
    "Tout \u00e0 fait d\u2019accord"
  ];
  const allBoxes = [];
  const boxRe = /([☒☐])\s*([^☒☐]{1,150})/g;
  let m;
  while ((m = boxRe.exec(text)) !== null) {
    allBoxes.push({ mark: m[1], label: m[2].trim() });
  }
  // Grouper par question : chaque groupe commence par "Pas du tout"
  const groups = [];
  let current = [];
  for (const box of allBoxes) {
    if (box.label.startsWith("Pas du tout") && current.length > 0) {
      groups.push(current);
      current = [box];
    } else {
      current.push(box);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups.map(grp => {
    const checked = grp.find(b => b.mark === "☒");
    if (!checked) return { v: null, c: 0 };
    const v = IES_LABELS.findIndex(l => checked.label.startsWith(l));
    return { v: v >= 0 ? v + 1 : null, c: v >= 0 ? 1 : 0 };
  });
}

/* Parse un DOCX IES-2 : extrait le texte des balises <w:t> puis parse */
function parseIesDocx(xml) {
  const textBlocks = [];
  const tagRe = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let m;
  while ((m = tagRe.exec(xml)) !== null) textBlocks.push(m[1]);
  return parseIesText(textBlocks.join(" "));
}

const PROMPTS = {
  DEBQ: `Tu analyses une photo du questionnaire DEBQ (Dutch Eating Behavior Questionnaire), 33 questions.

MISE EN PAGE :
Chaque question est en gras et numérotée implicitement (de haut en bas, 1 à 33).
Sous chaque question, les options sont disposées horizontalement sur une ligne :
  ☐ Jamais   ☐ Rarement   ☐ Parfois   ☐ Souvent   ☐ Très souvent
Certaines questions ont une option supplémentaire sur la ligne suivante, formulée "Je ne [verbe] jamais..." (ex : "Je ne suis jamais irrité(e)"). C'est une 6e option à part entière.
Le patient coche une seule case en traçant une croix à l'intérieur (☒).

VALEURS À RETOURNER :
Je ne... = 0 · Jamais = 1 · Rarement = 2 · Parfois = 3 · Souvent = 4 · Très souvent = 5

RÈGLES DE LECTURE STRICTES :
- Inspecte l'intérieur de chaque case individuellement — ne déduis jamais d'après la position.
- L'option "Je ne..." peut déborder sur la ligne suivante : c'est la 6e option, valeur 0.
- Si deux cases semblent cochées sur un item, mets c=0 et v=valeur la plus probable.
- Si la croix est à cheval entre deux cases ou ambiguë, mets c=0.
- Si aucune case n'est cochée, mets v=null, c=0.
- Ne suppose jamais une réponse "logique" — lis strictement ce qui est coché.
- c=1 uniquement si tu es certain à 100%. Dès le moindre doute : c=0.

Réponds UNIQUEMENT avec ce JSON, sans texte ni balises markdown :
{"items":[{"v":3,"c":1},{"v":0,"c":1},...]}
33 objets exactement. "v" = entier 0-5 ou null. "c" = 1 (certain) ou 0 (moindre doute).`,

  IES2: `Tu analyses une photo du questionnaire IES-2 (Intuitive Eating Scale-2), 18 items.

MISE EN PAGE :
Chaque item est numéroté (1 à 18) et présente une affirmation suivie de 5 cases à cocher disposées VERTICALEMENT, dans cet ordre exact :
  ☐ Pas du tout d'accord       → valeur 1
  ☐ Plutôt pas d'accord        → valeur 2
  ☐ Ni d'accord, ni pas d'accord → valeur 3
  ☐ Plutôt d'accord            → valeur 4
  ☐ Tout à fait d'accord       → valeur 5
Le patient coche une seule case par item.
Attention : une note de bas de page (ex : "Cette affirmation ne concerne pas les interdits...") peut apparaître entre deux items — ignore-la, elle ne compte pas comme un item.

RÈGLES DE LECTURE STRICTES :
- Lis les items dans l'ordre numérique strict (1 à 18) — ne saute pas.
- La case cochée est celle qui contient une marque visible à l'intérieur (croix, crochet, trait).
- Si deux cases sont cochées sur un même item, mets c=0 et v=valeur la plus probable.
- Si la marque est entre deux cases, mets c=0.
- Si aucune case n'est cochée, mets v=null, c=0.
- Ne suppose jamais une réponse "cohérente" avec les autres items.
- c=1 uniquement si tu es certain à 100%. Dès le moindre doute : c=0.

Réponds UNIQUEMENT avec ce JSON, sans texte ni balises markdown :
{"items":[{"v":3,"c":1},{"v":2,"c":0},...]}
18 objets exactement. "v" = entier 1-5 ou null. "c" = 1 (certain) ou 0 (moindre doute).`,

  BES: `Tu analyses une photo du questionnaire BES (Binge Eating Scale), 16 groupes (items I à XVI).

MISE EN PAGE :
Chaque item est introduit par un numéro en chiffres romains (I, II, III... XVI) suivi d'une ligne horizontale.
Sous ce séparateur, 3 ou 4 propositions sont listées verticalement, précédées d'une case et d'un chiffre :
  ☐ 1- [texte de la première proposition]
  ☐ 2- [texte de la deuxième proposition]
  ☐ 3- [texte de la troisième proposition]
  ☐ 4- [texte de la quatrième proposition, si elle existe]
Le patient coche une seule case par groupe.

VALEURS À RETOURNER (index 0-based) :
Proposition 1 cochée → v=0
Proposition 2 cochée → v=1
Proposition 3 cochée → v=2
Proposition 4 cochée → v=3

NOMBRE DE PROPOSITIONS PAR ITEM :
Items I, II, III, IV, V, VII, VIII, IX, X, XI, XII, XIV, XV, XVI → 4 propositions (v possible : 0,1,2,3)
Items VI, XIII → 3 propositions (v possible : 0,1,2)

RÈGLES DE LECTURE STRICTES :
- Parcours les items dans l'ordre I à XVI (1 à 16).
- Identifie la case cochée (croix ou marque visible à l'intérieur de ☐).
- Si deux cases sont cochées, mets c=0 et v=index le plus probable.
- Si la marque est ambiguë ou entre deux cases, mets c=0.
- Si aucune case n'est cochée, mets v=null, c=0.
- c=1 uniquement si tu es certain à 100%. Dès le moindre doute : c=0.

Réponds UNIQUEMENT avec ce JSON, sans texte ni balises markdown :
{"items":[{"v":0,"c":1},{"v":2,"c":0},...]}
16 objets exactement. "v" = index 0-based ou null. "c" = 1 (certain) ou 0 (moindre doute).`,

  EQVOD: `Tu analyses une photo du questionnaire EQVOD (Échelle Qualité de Vie, Obésité, Diététique), 36 items.

MISE EN PAGE :
Chaque item est numéroté (1 à 36) et présente une affirmation commençant par "À cause de mon poids...".
Le patient répond en entourant UN chiffre parmi 1 · 2 · 3 · 4 · 5 disposés horizontalement.
Échelle : 1 = Énormément / tout le temps → 5 = Jamais / pas du tout.

Le questionnaire est structuré en 5 dimensions séparées par des lignes horizontales pleines et des sous-titres :
- Items 1–11   : Impact physique
- Items 12–22  : Impact psycho-social
- Items 23–26  : Impact sur la vie sexuelle
- Items 27–31  : Bien-être alimentaire
- Items 32–36  : Vécu du régime / Diététique
Ces séparateurs t'aident à repérer les frontières entre dimensions si un numéro est difficile à lire.

RÈGLES DE LECTURE STRICTES :
- Un chiffre "entouré" = cercle visible autour du chiffre. Un simple trait ou point ne suffit pas.
- Si le cercle chevauche deux chiffres, mets c=0 et v=chiffre le plus probable.
- Si aucun chiffre n'est entouré, mets v=null, c=0.
- Ne suppose pas qu'un chiffre est entouré parce qu'il "semble logique" au regard de l'item.
- Vérifie le numéro de chaque item : les sous-titres de dimension ne sont pas des items.
- c=1 uniquement si tu es certain à 100%. Dès le moindre doute : c=0.

Réponds UNIQUEMENT avec ce JSON, sans texte ni balises markdown :
{"items":[{"v":3,"c":1},{"v":5,"c":1},...]}
36 objets exactement. "v" = entier 1-5 ou null. "c" = 1 (certain) ou 0 (moindre doute).`
};

/* ─── SCORING ────────────────────────────────────────────────── */
function calcScores(q, items) {
  if (q === "BES") {
    const { weights, thresholds } = CONFIGS.BES;
    let total = 0, nullCount = 0;
    items.forEach((idx, i) => {
      if (idx == null) { nullCount++; return; }
      const w = weights[i] || [];
      total += w[idx] ?? 0;
    });
    const sev = thresholds.find(t => total >= t.min && total <= t.max) || thresholds[2];
    return { type:"BES", total, severity:sev, nullCount };
  }
  if (q === "EQVOD") {
    const { subscales } = CONFIGS.EQVOD;
    const subs = {};
    subscales.forEach(s => {
      const vals = s.items.map(n => items[n-1]).filter(v => v != null);
      if (!vals.length) { subs[s.key] = null; return; }
      const sumBrut = vals.reduce((a, b) => a + b, 0);
      let score;
      if (s.key === "physique" || s.key === "psychosocial") {
        score = sumBrut * 1.8;
      } else if (s.key === "sexuelle") {
        score = sumBrut * 5;
      } else if (s.key === "bienetre") {
        score = Math.abs(sumBrut * 4 - 100);
      } else if (s.key === "regime") {
        score = sumBrut * 4;
      }
      subs[s.key] = Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
    });
    const allVals = Object.values(subs).filter(v => v != null);
    const total = allVals.length ? Math.round(allVals.reduce((a,b)=>a+b,0)/allVals.length * 10) / 10 : null;
    return { type:"EQVOD", subscales: subs, total, nullCount: items.filter(v=>v==null).length };
  }
  const cfg = CONFIGS[q];
  const rev = cfg.reverseItems || [];
  // v=0 = réponse "Je ne..." → toujours 0, jamais inversé
  const proc = items.map((v,i) => v == null ? null : (v === 0 ? 0 : rev.includes(i+1) ? 6-v : v));
  const subs = {};
  cfg.subscales.forEach(s => {
    const vals = s.items.map(n => proc[n-1]).filter(v => v != null);
    subs[s.key] = vals.length ? Math.ceil(vals.reduce((a,b)=>a+b,0)/vals.length * 10) / 10 : null;
  });
  const allVals = Object.values(subs).filter(v => v != null);
  const total = allVals.length ? Math.ceil(allVals.reduce((a,b)=>a+b,0)/allVals.length * 10) / 10 : null;
  return { type:q, subscales:subs, total, nullCount: items.filter(v=>v==null).length };
}

function barColor(q, key, val) {
  if (val == null) return "#cbd5e1";
  if (q === "DEBQ") {
    return val > 3 ? "#dc2626" : "#2563eb"; // Positif / Négatif
  }
  return val >= 3.5 ? "#16a34a" : val >= 2.5 ? "#d97706" : "#dc2626";
}

/* ─── MAIN APP ───────────────────────────────────────────────── */
export default function ScorAlim() {
  const [step, setStep]               = useState("select"); // select | upload | processing | review | results | history | downloads
  const [q, setQ]                     = useState(null);
  const [fileList, setFileList]       = useState([]);
  const [extractedItems, setExtracted]= useState(null); // [{v, c}]
  const [scores, setScores]           = useState(null);
  const [error, setError]             = useState(null);
  const [patient, setPatient]         = useState({ nom:"", prenom:"", date: new Date().toISOString().slice(0,10) });

  // Auth
  const [user, setUser]               = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode]       = useState("login"); // login | register
  const [authEmail, setAuthEmail]     = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError]     = useState(null);
  const [authBusy, setAuthBusy]       = useState(false);

  // Historique
  const [history, setHistory]         = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearch, setHistorySearch]   = useState("");
  const [historyFilter, setHistoryFilter]   = useState("ALL");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const buildRef = () => {
    const n = (patient.nom.slice(0,3) + patient.prenom.slice(0,3)).toUpperCase();
    const d = patient.date.replace(/-/g, "");
    return n + d; // ex: LECROM20260527
  };

  const handleAuth = async () => {
    setAuthBusy(true); setAuthError(null);
    const fn = authMode === "login"
      ? supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
      : supabase.auth.signUp({ email: authEmail, password: authPassword });
    const { error } = await fn;
    if (error) setAuthError(error.message);
    setAuthBusy(false);
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    const { data } = await supabase
      .from("analyses")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setHistory(data || []);
    setHistoryLoading(false);
  };

  const saveAnalysis = async (scoresData, itemsData) => {
    if (!user) return;
    await supabase.from("analyses").insert({
      user_id: user.id,
      reference: buildRef(),
      questionnaire: q,
      scores: scoresData,
      items: itemsData,
      date_analyse: patient.date,
    });
  };

  /* File reading */
  const toB64 = f => new Promise((res,rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(f);
  });

  /* Compress image via canvas — max 1200px, quality 0.75 — keeps under Vercel 4.5MB limit */
  const compressImage = (dataUrl) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1200;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else                { width = Math.round(width * MAX / height);  height = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.75).split(",")[1]);
    };
    img.src = dataUrl;
  });

  const readFile = async (file) => {
    if (!file) return;
    setError(null);
    const ext = (file.name?.split(".").pop() || "").toLowerCase();
    try {
      if (file.type?.startsWith("image/") || ["jpg","jpeg","png","webp"].includes(ext)) {
        const b64full = await toB64(file);
        const compressed = await compressImage(b64full);
        setFileList(prev => [...prev, { type:"image", data:compressed, mediaType:"image/jpeg", name:file.name }]);
      } else if (ext==="pdf" || file.type?.includes("pdf")) {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let b64 = "";
        for (let i = 0; i < bytes.length; i += 8192) {
          b64 += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        b64 = btoa(b64);
        // PDF replaces everything (auto-paginated)
        setFileList([{ type:"pdf", data:b64, arrayBuffer:buf, name:file.name }]);
      } else if (ext==="docx") {
        const buf = await file.arrayBuffer();
        setFileList([{ type:"docx", arrayBuffer:buf, name:file.name }]);
      } else {
        setError("Format non supporté. Utilisez JPG, PNG, PDF ou DOCX.");
      }
    } catch(e) { setError("Erreur lecture : " + e.message); }
  };

  /* Analysis */
  const analyze = async () => {
    if (!fileList.length || !q) return;
    setStep("processing"); setError(null);
    try {
      const prompt = PROMPTS[q];
      let content;
      const first = fileList[0];

      if (first.type === "pdf") {
        // Tenter d'abord un parsing texte (PDF numérique avec ☒)
        if (q === "DEBQ" || q === "BES" || q === "IES2") {
          try {
            const pdfDoc = await pdfjsLib.getDocument({ data: first.arrayBuffer.slice(0) }).promise;
            let fullText = "";
            for (let p = 1; p <= pdfDoc.numPages; p++) {
              const page = await pdfDoc.getPage(p);
              const tc = await page.getTextContent();
              fullText += tc.items.map(i => i.str).join(" ") + " ";
            }
            if (fullText.includes("☒")) {
              if (q === "DEBQ") {
                const items = parseDebqText(fullText);
                while (items.length < 33) items.push({ v: null, c: 0 });
                const normalized = items.slice(0, 33).map(item => ({ v: item.v ?? null, c: item.c ?? 1 }));
                setExtracted(normalized); setStep("review"); return;
              } else if (q === "BES") {
                const items = parseBesText(fullText);
                while (items.length < 16) items.push({ v: null, c: 0 });
                const normalized = items.slice(0, 16).map(item => ({ v: item.v ?? null, c: item.c ?? 1 }));
                setExtracted(normalized); setStep("review"); return;
              } else if (q === "IES2") {
                const items = parseIesText(fullText);
                while (items.length < 18) items.push({ v: null, c: 0 });
                const normalized = items.slice(0, 18).map(item => ({ v: item.v ?? null, c: item.c ?? 1 }));
                setExtracted(normalized); setStep("review"); return;
              }
            }
          } catch(e) { /* PDF non textuel → fallback vision */ }
        }
        // Fallback vision (PDF scanné ou autre questionnaire)
        content = [
          { type:"document", source:{ type:"base64", media_type:"application/pdf", data:first.data } },
          { type:"text", text:prompt }
        ];
      } else if (first.type === "docx") {
        // DOCX numérique DEBQ ou BES : lecture XML directe via JSZip
        if (q === "DEBQ" || q === "BES" || q === "IES2") {
          const zip = await JSZip.loadAsync(first.arrayBuffer);
          const xmlRaw = await zip.file("word/document.xml").async("string");
          if (q === "DEBQ") {
            const items = parseDebqDocx(xmlRaw);
            while (items.length < 33) items.push({ v: null, c: 0 });
            const normalized = items.slice(0, 33).map(item => ({ v: item.v ?? null, c: item.c ?? 1 }));
            setExtracted(normalized); setStep("review"); return;
          } else if (q === "BES") {
            const items = parseBesDocx(xmlRaw);
            while (items.length < 16) items.push({ v: null, c: 0 });
            const normalized = items.slice(0, 16).map(item => ({ v: item.v ?? null, c: item.c ?? 1 }));
            setExtracted(normalized); setStep("review"); return;
          } else {
            const items = parseIesDocx(xmlRaw);
            while (items.length < 18) items.push({ v: null, c: 0 });
            const normalized = items.slice(0, 18).map(item => ({ v: item.v ?? null, c: item.c ?? 1 }));
            setExtracted(normalized); setStep("review"); return;
          }
        }
        // Autres questionnaires en DOCX : fallback mammoth
        const res = await mammoth.extractRawText({ arrayBuffer: first.arrayBuffer });
        content = `${prompt}\n\nContenu du questionnaire :\n${res.value}`;
      } else {
        // One or more images — send all image blocks + prompt at the end
        const pageLabel = fileList.length > 1
          ? `Le questionnaire est réparti sur ${fileList.length} photos (pages 1 à ${fileList.length}). Analyse l'ensemble pour retrouver tous les items.\n\n`
          : "";
        content = [
          ...fileList.map((f, i) => ({
            type:"image",
            source:{ type:"base64", media_type:f.mediaType, data:f.data }
          })),
          { type:"text", text: pageLabel + prompt }
        ];
      }

      const res = await fetch("/api/analyze", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:1000, messages:[{role:"user",content}] })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Erreur API");

      const text = data.content.map(c=>c.text||"").join("");
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("JSON introuvable dans la réponse");
      const parsed = JSON.parse(m[0]);
      if (!Array.isArray(parsed.items)) throw new Error("Format de réponse inattendu");

      // Normalize — accept both {v,c} objects and bare values (fallback)
      const normalized = parsed.items.map(item =>
        item !== null && typeof item === "object"
          ? { v: item.v ?? null, c: item.c ?? 1 }
          : { v: item ?? null, c: 1 }
      );

      setExtracted(normalized);
      setStep("review");
    } catch(e) {
      setError("Erreur : " + e.message);
      setStep("upload");
    }
  };

  const confirmItems = (items) => {
    const s = calcScores(q, items.map(i => i.v));
    setScores(s);
    setStep("results");
    saveAnalysis(s, items);
  };

  const reset = () => { setStep("select"); setQ(null); setFileList([]); setExtracted(null); setScores(null); setError(null); };
  const cfg = q ? CONFIGS[q] : null;

  const chartData = () => {
    if (!scores || !cfg || q==="BES") return [];
    return cfg.subscales.map(s => ({
      name: s.label.length > 26 ? s.label.slice(0,26)+"…" : s.label,
      key: s.key,
      value: scores.subscales[s.key] ?? 0
    }));
  };

  /* ─── RENDER ─────────────────────────────────────────────── */
  // Chargement auth
  if (authLoading) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:"DM Sans"}}>Chargement…</div>;

  // Écran de connexion
  if (!user) return (
    <div style={{minHeight:"100vh",background:"#f8fafc",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"DM Sans",padding:16}}>
      <div style={{background:"white",borderRadius:20,padding:32,width:"100%",maxWidth:380,boxShadow:"0 4px 24px rgba(0,0,0,0.08)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:24}}>
          <div style={{background:"#4f46e5",borderRadius:10,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{color:"white",fontSize:18}}>ψ</span>
          </div>
          <span style={{fontSize:20,fontWeight:800,color:"#1e293b"}}>Scor<span style={{color:"#818cf8"}}>&#x2019;</span>Alim</span>
        </div>
        <h2 style={{fontSize:16,fontWeight:700,color:"#1e293b",marginBottom:20}}>
          {authMode === "login" ? "Connexion" : "Créer un compte"}
        </h2>
        <input type="email" placeholder="Email" value={authEmail}
          onChange={e => setAuthEmail(e.target.value)}
          style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1px solid #e2e8f0",marginBottom:10,fontSize:14,boxSizing:"border-box"}} />
        <input type="password" placeholder="Mot de passe" value={authPassword}
          onChange={e => setAuthPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAuth()}
          style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1px solid #e2e8f0",marginBottom:16,fontSize:14,boxSizing:"border-box"}} />
        {authError && <div style={{color:"#dc2626",fontSize:12,marginBottom:12}}>{authError}</div>}
        <button onClick={handleAuth} disabled={authBusy}
          style={{width:"100%",padding:"12px",borderRadius:12,border:"none",background:"#4f46e5",color:"white",fontWeight:700,fontSize:14,cursor:"pointer",opacity:authBusy?0.6:1}}>
          {authBusy ? "…" : authMode === "login" ? "Se connecter" : "Créer le compte"}
        </button>
        {authMode === "register" && <p style={{fontSize:11,color:"#94a3b8",marginTop:10,textAlign:"center"}}>Un email de confirmation vous sera envoyé.</p>}
        <button onClick={() => { setAuthMode(m => m === "login" ? "register" : "login"); setAuthError(null); }}
          style={{width:"100%",marginTop:12,padding:"8px",borderRadius:10,border:"1px solid #e2e8f0",background:"transparent",fontSize:13,color:"#6366f1",cursor:"pointer"}}>
          {authMode === "login" ? "Créer un compte" : "Déjà un compte ? Se connecter"}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { font-family: 'DM Sans', sans-serif; background: #f8f7f4; }
        .mono { font-family: 'DM Mono', monospace; }
        .slide-up { animation: su 0.35s cubic-bezier(.22,.68,0,1.2); }
        @keyframes su { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
        .spin { animation: sp 0.9s linear infinite; }
        @keyframes sp { to { transform: rotate(360deg); } }
        .bar-fill { transition: width 0.8s cubic-bezier(.22,.68,0,1.2); }
        @media print {
          .no-print { display:none !important; }
          body { background:white; }
          .print-card { box-shadow:none !important; border:1px solid #e2e8f0 !important; }
          .print-header { display:block !important; }
        }
        .print-header { display:none; }
      `}</style>

      <div style={{minHeight:"100vh", background:"#f8f7f4", fontFamily:"'DM Sans',sans-serif"}}>

        {/* ── HEADER ── */}
        <div className="no-print" style={{background:"#1a1a2e", color:"white", padding:"14px 20px"}}>
          <div style={{maxWidth:560, margin:"0 auto", display:"flex", alignItems:"center", gap:10}}>
            {/* Logo mark — fork in a rounded square */}
            <div style={{width:36,height:36,borderRadius:10,background:"#4f46e5",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round">
                <line x1="6"  y1="3" x2="6"  y2="9"/>
                <line x1="10" y1="3" x2="10" y2="9"/>
                <line x1="14" y1="3" x2="14" y2="9"/>
                <path d="M6 9 Q6 13 10 13 Q14 13 14 9"/>
                <line x1="10" y1="13" x2="10" y2="17"/>
              </svg>
            </div>

            <div style={{flex:1}}>
              {/* Wordmark */}
              <div style={{display:"flex", alignItems:"center", gap:1, lineHeight:1}}>
                <span style={{fontWeight:800, fontSize:17, color:"white", letterSpacing:"-0.03em", fontFamily:"'DM Sans',sans-serif"}}>Scor</span>
                {/* Inline fork as apostrophe */}
                <svg viewBox="0 0 9 20" width="6" height="14" style={{marginBottom:4, flexShrink:0}} fill="none" stroke="#818cf8" strokeWidth="1.7" strokeLinecap="round">
                  <line x1="1.8" y1="1" x2="1.8" y2="8"/>
                  <line x1="4.5" y1="1" x2="4.5" y2="8"/>
                  <line x1="7.2" y1="1" x2="7.2" y2="8"/>
                  <path d="M1.8 8 Q1.8 12 4.5 12 Q7.2 12 7.2 8"/>
                  <line x1="4.5" y1="12" x2="4.5" y2="19"/>
                </svg>
                <span style={{fontWeight:800, fontSize:17, color:"white", letterSpacing:"-0.03em", fontFamily:"'DM Sans',sans-serif"}}>Alim</span>
              </div>
              <div style={{fontSize:11,color:"#64748b",letterSpacing:"0.05em", marginTop:2}}>DEBQ · IES-2 · BES · EQVOD · ANALYSE AUTOMATIQUE</div>
            </div>

            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              {step !== "select" && (
                <button onClick={reset} style={{fontSize:12,color:"#94a3b8",border:"1px solid #334155",borderRadius:8,padding:"5px 12px",background:"transparent",cursor:"pointer"}}>← Menu</button>
              )}
              <button onClick={()=>{loadHistory();setStep("history");}} style={{fontSize:12,color:"#94a3b8",border:"1px solid #334155",borderRadius:8,padding:"5px 12px",background:"transparent",cursor:"pointer"}}>📋</button>
              <button onClick={()=>setStep("downloads")} title="Questionnaires vierges" style={{fontSize:12,color:"#94a3b8",border:"1px solid #334155",borderRadius:8,padding:"5px 12px",background:"transparent",cursor:"pointer"}}>📄</button>
              <button onClick={()=>supabase.auth.signOut()} style={{fontSize:12,color:"#94a3b8",border:"1px solid #334155",borderRadius:8,padding:"5px 12px",background:"transparent",cursor:"pointer"}}>Déco</button>
            </div>
          </div>
        </div>

        {/* Print header */}
        <div className="print-header" style={{maxWidth:560,margin:"0 auto",padding:"20px 20px 0",display:"none"}}>
          <h1 style={{fontSize:20,fontWeight:700,margin:0}}>Scor'Alim — {cfg?.fullName}</h1>
          {buildRef() && <p style={{margin:"4px 0 0",color:"#475569"}}>{buildRef()}</p>}
          <p style={{margin:"2px 0 12px",color:"#94a3b8",fontSize:13}}>{patient.date}</p>
          <hr style={{borderColor:"#e2e8f0"}}/>
        </div>

        <div style={{maxWidth:560, margin:"0 auto", padding:"20px 16px", display:"flex", flexDirection:"column", gap:14}}>

          {/* ══ HISTORIQUE ══ */}
          {step === "history" && (
            <div className="slide-up" style={{display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <p style={{fontSize:12,fontWeight:600,color:"#94a3b8",letterSpacing:"0.08em",textTransform:"uppercase",margin:0}}>Historique des analyses</p>
                <button onClick={reset} style={{fontSize:12,color:"#6366f1",border:"none",background:"none",cursor:"pointer"}}>← Retour</button>
              </div>

              {/* Barre de recherche + filtre */}
              <div style={{display:"flex",gap:8}}>
                <input
                  type="text"
                  placeholder="🔍 Rechercher une référence…"
                  value={historySearch}
                  onChange={e=>setHistorySearch(e.target.value)}
                  style={{flex:1,fontSize:13,padding:"8px 12px",borderRadius:10,border:"1px solid #e2e8f0",background:"white",outline:"none",color:"#1e293b"}}
                />
                <select
                  value={historyFilter}
                  onChange={e=>setHistoryFilter(e.target.value)}
                  style={{fontSize:12,padding:"8px 10px",borderRadius:10,border:"1px solid #e2e8f0",background:"white",color:"#475569",cursor:"pointer"}}
                >
                  <option value="ALL">Tous</option>
                  {Object.keys(CONFIGS).map(k=>(
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>

              {historyLoading ? (
                <p style={{color:"#94a3b8",fontSize:13}}>Chargement…</p>
              ) : history.length === 0 ? (
                <p style={{color:"#94a3b8",fontSize:13}}>Aucune analyse enregistrée.</p>
              ) : (() => {
                const filtered = history.filter(h => {
                  const matchRef = h.reference?.toLowerCase().includes(historySearch.toLowerCase());
                  const matchQ   = historyFilter === "ALL" || h.questionnaire === historyFilter;
                  return matchRef && matchQ;
                });
                return filtered.length === 0 ? (
                  <p style={{color:"#94a3b8",fontSize:13}}>Aucun résultat pour cette recherche.</p>
                ) : (
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {filtered.map(h => {
                    const s    = h.scores || {};
                    const cfg2 = CONFIGS[h.questionnaire];
                    const its  = h.items  || [];
                    const DEBQ_LBL = {0:"Je ne...",1:"Jamais",2:"Rarement",3:"Parfois",4:"Souvent",5:"Très sou."};
                    const IES_LBL  = {1:"Pas du tout",2:"Plutôt pas",3:"Ni/ni",4:"Plutôt",5:"Tout à fait"};

                    const exportHistoryPdf = () => {
                      const doc = new jsPDF({ unit:"pt", format:"a4" });
                      const W = 595, M = 50;
                      let y = 50;
                      doc.setFontSize(16).setFont(undefined,"bold").setTextColor(30,41,59);
                      doc.text("Scor’Alim — " + (cfg2?.fullName||h.questionnaire), M, y); y+=20;
                      doc.setFontSize(11).setFont(undefined,"normal").setTextColor(100,116,139);
                      doc.text("Réf : " + h.reference + "   |   " + h.date_analyse, M, y); y+=24;
                      doc.setDrawColor(226,232,240).line(M,y,W-M,y); y+=16;
                      if (h.questionnaire !== "BES" && s.subscales) {
                        (cfg2?.subscales||[]).forEach(sub => {
                          const val = s.subscales[sub.key];
                          doc.setFontSize(12).setFont(undefined,"normal").setTextColor(55,65,81);
                          doc.text(sub.label, M, y);
                          doc.setFont(undefined,"bold").setTextColor(30,41,59);
                          const suffix = h.questionnaire === "EQVOD" ? " / 100" : "";
                          doc.text((val?.toFixed(1)??"—") + suffix, W-M, y, {align:"right"});
                          y += 22;
                        });
                        y+=6; doc.setDrawColor(241,245,249).line(M,y,W-M,y); y+=14;
                        doc.setFontSize(12).setFont(undefined,"normal").setTextColor(100,116,139);
                        doc.text("Score global moyen", M, y);
                        doc.setFont(undefined,"bold").setTextColor(30,41,59);
                        const totalSuffix = h.questionnaire === "EQVOD" ? " / 100" : " / 5";
                        doc.text((s.total?.toFixed(1)??"—") + totalSuffix, W-M, y, {align:"right"}); y+=28;
                      }
                      if (h.questionnaire === "BES") {
                        doc.setFontSize(24).setFont(undefined,"bold").setTextColor(30,41,59);
                        doc.text(String(s.total??"—"), W/2, y+10, {align:"center"}); y+=36;
                        doc.setFontSize(13).setFont(undefined,"normal").setTextColor(100,116,139);
                        doc.text(s.severity?.label||"", W/2, y, {align:"center"}); y+=28;
                      }
                      doc.setFontSize(9).setTextColor(148,163,184);
                      doc.text("Scor’Alim · Romain Lecomte, diététicien-nutritionniste · scoralim.vercel.app", W/2, 820, {align:"center"});
                      doc.save("ScorAlim_" + h.questionnaire + "_" + h.reference + ".pdf");
                    };

                    const deleteAnalysis = async () => {
                      if (!window.confirm("Supprimer cette analyse ? Cette action est irréversible.")) return;
                      await supabase.from("analyses").delete().eq("id", h.id);
                      setHistory(prev => prev.filter(x => x.id !== h.id));
                    };

                    return (
                      <div key={h.id} style={{background:"white",borderRadius:14,padding:14,border:"1px solid #f1f5f9"}}>
                        {/* En-tête */}
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <span className="mono" style={{padding:"2px 8px",borderRadius:20,background:cfg2?.color||"#6366f1",color:"white",fontSize:10,fontWeight:700}}>{h.questionnaire}</span>
                            <span style={{fontSize:13,fontWeight:700,fontFamily:"'DM Mono',monospace",color:"#1e293b"}}>{h.reference}</span>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span style={{fontSize:11,color:"#94a3b8"}}>{h.date_analyse}</span>
                            <button onClick={exportHistoryPdf} style={{fontSize:11,padding:"3px 8px",borderRadius:8,border:"1px solid #e2e8f0",background:"white",cursor:"pointer",color:"#6366f1"}}>⬇️ PDF</button>
                            <button onClick={deleteAnalysis} style={{fontSize:11,padding:"3px 8px",borderRadius:8,border:"1px solid #fecaca",background:"#fef2f2",cursor:"pointer",color:"#dc2626"}}>🗑</button>
                          </div>
                        </div>
                        {/* Score résumé */}
                        {h.questionnaire !== "BES" && s.total != null && (
                          <div style={{fontSize:13,color:"#475569",marginBottom:8}}>
                            Score global : <strong>{s.total?.toFixed(1)}</strong>
                            {h.questionnaire === "EQVOD" ? " / 100" : " / 5"}
                          </div>
                        )}
                        {h.questionnaire === "BES" && s.total != null && (
                          <div style={{fontSize:13,color:"#475569",marginBottom:8}}>Score : <strong>{s.total}</strong> — {s.severity?.label}</div>
                        )}
                        {/* Tableau items */}
                        {its.length > 0 && (
                          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(72px, 1fr))",gap:4,marginTop:6}}>
                            {its.map((it, idx) => {
                              const lbl = h.questionnaire==="DEBQ" ? DEBQ_LBL[it.v] : h.questionnaire==="IES2" ? IES_LBL[it.v] : null;
                              return (
                                <div key={idx} style={{background:"#f8fafc",borderRadius:8,padding:"4px",textAlign:"center"}}>
                                  <div style={{fontSize:9,color:"#94a3b8"}}>Q{idx+1}</div>
                                  <div style={{fontSize:12,fontWeight:700,color:"#1e293b"}}>{h.questionnaire==="BES"?`P${(it.v??0)+1}`:(it.v??""!==""?it.v:"—")}</div>
                                  {lbl && <div style={{fontSize:8,color:"#64748b"}}>{lbl}</div>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                );
              })()}
            </div>
          )}

          {/* ══ TÉLÉCHARGEMENTS — QUESTIONNAIRES VIERGES ══ */}
          {step === "downloads" && (
            <div className="slide-up" style={{display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <p style={{fontSize:12,fontWeight:600,color:"#94a3b8",letterSpacing:"0.08em",textTransform:"uppercase",margin:0}}>Questionnaires vierges</p>
                <button onClick={reset} style={{fontSize:12,color:"#6366f1",border:"none",background:"none",cursor:"pointer"}}>← Retour</button>
              </div>
              <p style={{fontSize:13,color:"#64748b",margin:0}}>À distribuer à vos patients avant l'analyse. PDF pour impression ou consultation mobile, Word pour remplissage numérique (cases cochables).</p>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {Object.entries(CONFIGS).map(([key, c]) => (
                  <div key={key} style={{background:"white",borderRadius:14,border:"2px solid #f1f5f9",padding:"14px 16px",display:"flex",alignItems:"center",gap:14}}>
                    <div style={{width:44,height:44,borderRadius:12,background:c.light,border:`2px solid ${c.color}33`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <span style={{fontWeight:800,fontSize:11,color:c.color,fontFamily:"'DM Mono',monospace"}}>{c.name}</span>
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,fontSize:14,color:"#1e293b",letterSpacing:"-0.01em"}}>{c.fullName}</div>
                      <div style={{fontSize:12,color:"#94a3b8",marginTop:2}}>{c.itemCount} items</div>
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      <a href={BLANK_FILES[key].pdf} target="_blank" rel="noopener noreferrer"
                        style={{fontSize:11,fontWeight:600,padding:"5px 10px",borderRadius:8,border:"1px solid #e2e8f0",background:"#f8fafc",color:"#475569",textDecoration:"none",display:"flex",alignItems:"center",gap:4}}>
                        ⬇️ PDF
                      </a>
                      <a href={BLANK_FILES[key].docx} target="_blank" rel="noopener noreferrer"
                        style={{fontSize:11,fontWeight:600,padding:"5px 10px",borderRadius:8,border:"1px solid #dbeafe",background:"#eff6ff",color:"#2563eb",textDecoration:"none",display:"flex",alignItems:"center",gap:4}}>
                        ⬇️ Word
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══ STEP 1 — SELECT ══ */}
          {step === "select" && (
            <div className="slide-up" style={{display:"flex",flexDirection:"column",gap:10}}>
              <p style={{fontSize:12,fontWeight:600,color:"#94a3b8",letterSpacing:"0.08em",textTransform:"uppercase",margin:0}}>Sélectionner le questionnaire</p>
              {Object.entries(CONFIGS).map(([key, c]) => (
                <button key={key} onClick={() => { setQ(key); setStep("upload"); }}
                  style={{background:"white",borderRadius:16,border:"2px solid #f1f5f9",padding:"16px",textAlign:"left",cursor:"pointer",transition:"all 0.2s",display:"flex",alignItems:"center",gap:14}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=c.color;e.currentTarget.style.boxShadow=`0 4px 20px ${c.color}22`;}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor="#f1f5f9";e.currentTarget.style.boxShadow="none";}}>
                  <div style={{width:52,height:52,borderRadius:14,background:c.light,border:`2px solid ${c.color}33`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <span style={{fontWeight:800,fontSize:13,color:c.color,fontFamily:"'DM Mono',monospace"}}>{c.name}</span>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:14,color:"#1e293b",letterSpacing:"-0.01em"}}>{c.fullName}</div>
                    <div style={{fontSize:12,color:"#94a3b8",marginTop:2}}>{c.caption}</div>
                  </div>
                  <span style={{color:"#cbd5e1",fontSize:20}}>›</span>
                </button>
              ))}
              <button onClick={()=>setStep("downloads")}
                style={{marginTop:4,fontSize:13,color:"#6366f1",border:"none",background:"none",cursor:"pointer",textAlign:"left",padding:"4px 2px"}}>
                📄 Télécharger les questionnaires vierges
              </button>
            </div>
          )}

          {/* ══ STEP 2 — UPLOAD ══ */}
          {step === "upload" && cfg && (
            <div className="slide-up" style={{display:"flex",flexDirection:"column",gap:12}}>
              {/* Badge */}
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{padding:"3px 10px",borderRadius:20,background:cfg.color,color:"white",fontSize:12,fontWeight:700,fontFamily:"'DM Mono',monospace"}}>{cfg.name}</span>
                <span style={{fontSize:13,color:"#64748b"}}>{cfg.fullName}</span>
              </div>

              {/* Patient info */}
              <div style={{background:"white",borderRadius:16,padding:16,border:"1px solid #f1f5f9"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10}}>
                  <p style={{fontSize:11,fontWeight:600,color:"#94a3b8",letterSpacing:"0.08em",textTransform:"uppercase",margin:0}}>Référence dossier</p>
                  <span style={{fontSize:10,color:"#94a3b8"}}>🔒 3 lettres nom + 3 lettres prénom</span>
                </div>
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <input type="text" placeholder="NOM" maxLength={3} value={patient.nom}
                    onChange={e=>setPatient(p=>({...p,nom:e.target.value.toUpperCase().replace(/[^A-Z]/g,"")}))}
                    style={{flex:1,border:"1.5px solid #e2e8f0",borderRadius:10,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"'DM Mono',monospace",textTransform:"uppercase",letterSpacing:"0.1em"}}
                    onFocus={e=>e.target.style.borderColor="#6366f1"} onBlur={e=>e.target.style.borderColor="#e2e8f0"}/>
                  <input type="text" placeholder="PRÉ" maxLength={3} value={patient.prenom}
                    onChange={e=>setPatient(p=>({...p,prenom:e.target.value.toUpperCase().replace(/[^A-Z]/g,"")}))}
                    style={{flex:1,border:"1.5px solid #e2e8f0",borderRadius:10,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"'DM Mono',monospace",textTransform:"uppercase",letterSpacing:"0.1em"}}
                    onFocus={e=>e.target.style.borderColor="#6366f1"} onBlur={e=>e.target.style.borderColor="#e2e8f0"}/>
                  <input type="date" value={patient.date}
                    onChange={e=>setPatient(p=>({...p,date:e.target.value}))}
                    style={{width:130,border:"1.5px solid #e2e8f0",borderRadius:10,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"'DM Sans',sans-serif"}}
                    onFocus={e=>e.target.style.borderColor="#6366f1"} onBlur={e=>e.target.style.borderColor="#e2e8f0"}/>
                </div>
                {(patient.nom || patient.prenom) && (
                  <div style={{fontSize:11,color:"#6366f1",fontWeight:600,fontFamily:"'DM Mono',monospace"}}>
                    Référence : {buildRef()}
                  </div>
                )}
              </div>

              {/* File zone */}
              <div style={{background:"white",borderRadius:16,padding:16,border:"1px solid #f1f5f9"}}>
                <p style={{fontSize:11,fontWeight:600,color:"#94a3b8",letterSpacing:"0.08em",textTransform:"uppercase",margin:"0 0 10px"}}>Document(s) à analyser</p>

                {/* Add buttons — always visible so user can add more pages */}
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <label style={{display:"flex",alignItems:"center",gap:12,padding:14,borderRadius:12,border:"2px dashed #c7d2fe",background:"#eef2ff",cursor:"pointer",transition:"all 0.2s"}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor="#6366f1"} onMouseLeave={e=>e.currentTarget.style.borderColor="#c7d2fe"}>
                    <input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>readFile(e.target.files[0])}/>
                    <span style={{fontSize:24}}>📷</span>
                    <div>
                      <div style={{fontWeight:600,fontSize:13,color:"#4f46e5"}}>Prendre une photo</div>
                      <div style={{fontSize:12,color:"#94a3b8"}}>Questionnaire papier — autant que nécessaire</div>
                      <div style={{fontSize:11,color:"#6366f1",marginTop:2}}>💡 Activez le flash pour une meilleure lecture</div>
                    </div>
                  </label>
                  <label style={{display:"flex",alignItems:"center",gap:12,padding:14,borderRadius:12,border:"2px dashed #e2e8f0",background:"#f8fafc",cursor:"pointer",transition:"all 0.2s"}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor="#94a3b8"} onMouseLeave={e=>e.currentTarget.style.borderColor="#e2e8f0"}>
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf,.docx" style={{display:"none"}} onChange={e=>readFile(e.target.files[0])}/>
                    <span style={{fontSize:24}}>📎</span>
                    <div>
                      <div style={{fontWeight:600,fontSize:13,color:"#334155"}}>Importer un fichier</div>
                      <div style={{fontSize:12,color:"#94a3b8"}}>JPG · PNG · PDF · DOCX</div>
                    </div>
                  </label>
                </div>

                {/* File list */}
                {fileList.length > 0 && (
                  <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:6}}>
                    <p style={{fontSize:11,color:"#94a3b8",margin:0}}>{fileList.length} fichier{fileList.length>1?"s":""} · {fileList[0].type==="image"?"Photos accumulées":"Document unique"}</p>
                    {fileList.map((f, i) => (
                      <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:10,background:"#f0fdf4",border:"1px solid #bbf7d0"}}>
                        <span style={{fontSize:16}}>{f.type==="image"?"🖼️":f.type==="pdf"?"📄":"📝"}</span>
                        <span style={{flex:1,fontSize:12,fontWeight:500,color:"#166534",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {fileList.length > 1 ? `Page ${i+1} — ` : ""}{f.name||"Fichier"}
                        </span>
                        <button onClick={()=>setFileList(prev=>prev.filter((_,j)=>j!==i))}
                          style={{fontSize:16,color:"#86efac",background:"none",border:"none",cursor:"pointer",fontWeight:700,lineHeight:1,padding:"0 2px"}}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {error && (
                <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:12,padding:12,fontSize:13,color:"#dc2626"}}>
                  ⚠️ {error}
                </div>
              )}

              {/* Notice RGPD */}
              <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:12,padding:"10px 12px",display:"flex",gap:8,alignItems:"flex-start"}}>
                <span style={{fontSize:14,flexShrink:0,marginTop:1}}>🔒</span>
                <p style={{fontSize:11,color:"#0369a1",margin:0,lineHeight:1.6}}>
                  <strong>Traitement des données</strong> — Les documents sont analysés par l'API Anthropic (États-Unis).
                  Ne photographiez pas les questionnaires s'ils contiennent des données identifiantes (nom, prénom, date de naissance).
                  Utilisez un code ou des initiales comme référence dossier.
                </p>
              </div>

              {fileList.length > 0 && (
                <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:12,padding:"8px 12px",fontSize:11,color:"#92400e"}}>
                  ✅ Vérifiez que la photo ne contient aucun nom ni donnée identifiante avant d'analyser.
                </div>
              )}

              <button onClick={analyze} disabled={!fileList.length}
                style={{padding:"14px",borderRadius:14,fontWeight:700,fontSize:14,color:"white",border:"none",cursor:fileList.length?"pointer":"not-allowed",background:fileList.length?`linear-gradient(135deg, ${cfg.color}, ${cfg.color}cc)`:"#cbd5e1",transition:"all 0.2s",letterSpacing:"-0.01em"}}>
                {fileList.length > 1 ? `Analyser les ${fileList.length} pages →` : "Analyser → Calculer les scores"}
              </button>
            </div>
          )}

          {/* ══ STEP 3 — PROCESSING ══ */}
          {step === "processing" && (
            <div className="slide-up" style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"60px 20px",gap:16}}>
              <div className="spin" style={{width:44,height:44,borderRadius:"50%",border:"3px solid #e2e8f0",borderTopColor:"#4f46e5"}}/>
              <div style={{fontWeight:600,fontSize:15,color:"#1e293b"}}>Analyse en cours…</div>
              <div style={{fontSize:13,color:"#94a3b8",textAlign:"center"}}>Claude extrait et interprète les réponses</div>
            </div>
          )}

          {/* ══ STEP 3b — REVIEW ══ */}
          {step === "review" && extractedItems && cfg && (() => {
            const missing   = extractedItems.filter(i => i.v === null).length;
            const uncertain = extractedItems.filter(i => i.c === 0 && i.v !== null).length;
            const [items, setItems] = [extractedItems, setExtracted];
            const isBES = q === "BES";

            const updateItem = (idx, val) => {
              setExtracted(prev => prev.map((it, i) => i === idx ? { v: val, c: 1 } : it));
            };

            return (
              <div className="slide-up" style={{display:"flex",flexDirection:"column",gap:12}}>
                {/* Header */}
                <div style={{background:"white",borderRadius:16,padding:16,border:"1px solid #f1f5f9"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                    <span className="mono" style={{padding:"3px 10px",borderRadius:20,background:cfg.color,color:"white",fontSize:11,fontWeight:700}}>{cfg.name}</span>
                    <span style={{fontSize:13,color:"#475569",fontWeight:500}}>Vérification des réponses extraites</span>
                  </div>
                  {(missing > 0 || uncertain > 0) ? (
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {missing > 0 && (
                        <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"8px 12px",fontSize:12,color:"#991b1b"}}>
                          🔴 <strong>{missing} item(s)</strong> sans réponse détectée — à compléter obligatoirement.
                        </div>
                      )}
                      {uncertain > 0 && (
                        <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"8px 12px",fontSize:12,color:"#92400e"}}>
                          🟠 <strong>{uncertain} item(s)</strong> lus avec incertitude — vérifiez avant de calculer.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"8px 12px",fontSize:12,color:"#166534"}}>
                      ✅ Tous les items ont été lus avec confiance. Vérifiez si nécessaire.
                    </div>
                  )}
                  {/* Légende */}
                  <div style={{display:"flex",gap:12,marginTop:8,fontSize:11,color:"#64748b"}}>
                    <span>🔴 Réponse manquante</span>
                    <span>🟠 Lecture incertaine</span>
                  </div>
                </div>

                {/* Items grid */}
                <div style={{background:"white",borderRadius:16,padding:14,border:"1px solid #f1f5f9"}}>
                  {/* Texte explicatif */}
                  <div style={{background:"#f8fafc",borderRadius:10,padding:"8px 12px",marginBottom:12,fontSize:11,color:"#475569",lineHeight:1.5}}>
                    {q === "DEBQ" && <>Vérifiez chaque item : <strong>valeur</strong> + <strong>libellé</strong> affichés. 0=Je ne… · 1=Jamais · 2=Rarement · 3=Parfois · 4=Souvent · 5=Très sou. Corrigez si nécessaire.</>}
                    {q === "IES2" && <>Vérifiez chaque item : <strong>valeur</strong> + <strong>libellé</strong> affichés. 1=Pas du tout · 2=Plutôt pas · 3=Ni/ni · 4=Plutôt · 5=Tout à fait. Items <strong>↔</strong> inversés — score calculé (→) indiqué.</>}
                    {isBES && <>Vérifiez chaque paragraphe : P1=1ère option · P2=2ème · P3=3ème · P4=4ème. Corrigez si nécessaire.</>}
                    {q === "EQVOD" && <>Vérifiez chaque item : valeur entourée (1–5). 1=Énormément/tout le temps · 5=Jamais/pas du tout. Score élevé = bonne qualité de vie.</>}
                  </div>
                  <p style={{fontSize:11,fontWeight:600,color:"#94a3b8",letterSpacing:"0.08em",textTransform:"uppercase",margin:"0 0 12px"}}>
                    Réponses extraites — modifiez si nécessaire
                  </p>
                  <div style={{display:"grid", gridTemplateColumns:`repeat(auto-fill, minmax(${isBES?"72px":"100px"}, 1fr))`, gap:6}}>
                    {items.map((item, idx) => {
                      const isMissing   = item.v === null;
                      const isUncertain = item.c === 0 && item.v !== null;
                      const borderColor = isMissing ? "#ef4444" : isUncertain ? "#f97316" : "#e2e8f0";
                      const bgColor     = isMissing ? "#fef2f2" : isUncertain ? "#fff7ed" : "#fafafa";
                      const textColor   = isMissing ? "#dc2626" : isUncertain ? "#ea580c" : "#1e293b";
                      const icon        = isMissing ? "🔴" : isUncertain ? "🟠" : "";
                      const revItems    = (CONFIGS[q]?.reverseItems || []);
                      const isReversed  = revItems.includes(idx + 1);
                      const calcVal     = (isReversed && item.v !== null) ? 6 - item.v : null;
                      const DEBQ_LBL    = {0:"Je ne...",1:"Jamais",2:"Rarement",3:"Parfois",4:"Souvent",5:"Très sou."};
                      const IES_LBL     = {1:"Pas du tout",2:"Plutôt pas",3:"Ni/ni",4:"Plutôt",5:"Tout à fait"};
                      const EQVOD_LBL   = {1:"Énorm.",2:"Souvent",3:"Parfois",4:"Rarement",5:"Jamais"};
                      const labelMap    = q === "DEBQ" ? DEBQ_LBL : q === "IES2" ? IES_LBL : q === "EQVOD" ? EQVOD_LBL : null;
                      const label       = labelMap && item.v !== null ? labelMap[item.v] : null;
                      const options     = isBES
                        ? (CONFIGS.BES.weights[idx] || []).map((_, oi) => oi)
                        : q === "DEBQ" ? [0,1,2,3,4,5] : [1,2,3,4,5];
                      return (
                        <div key={idx} style={{
                          border: `2px solid ${borderColor}`,
                          borderRadius: 10,
                          padding: "6px 4px",
                          background: bgColor,
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 2
                        }}>
                          <span style={{fontSize:10,color:"#94a3b8",fontWeight:600}}>
                            {icon} Q{idx+1}{isReversed ? " ↔" : ""}
                          </span>
                          <select
                            value={item.v ?? ""}
                            onChange={e => updateItem(idx, e.target.value === "" ? null : +e.target.value)}
                            style={{
                              width:"100%", fontSize:13, fontWeight:700,
                              color: textColor,
                              border:"none", background:"transparent",
                              textAlign:"center", cursor:"pointer", outline:"none"
                            }}
                          >
                            <option value="">—</option>
                            {options.map(o => (
                              <option key={o} value={o}>{isBES ? `P${o+1}` : o}</option>
                            ))}
                          </select>
                          {label && <span style={{fontSize:9,color:"#64748b",textAlign:"center",lineHeight:1.2}}>{label}</span>}
                          {calcVal !== null && <span style={{fontSize:9,color:"#6366f1",fontWeight:600}}>→ {calcVal}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button
                  onClick={() => confirmItems(extractedItems)}
                  style={{padding:"14px",borderRadius:14,fontWeight:700,fontSize:14,color:"white",border:"none",cursor:"pointer",background:`linear-gradient(135deg, ${cfg.color}, ${cfg.color}cc)`}}>
                  ✅ J'ai vérifié et je confirme
                </button>
                <button onClick={() => { setStep("upload"); setExtracted(null); }}
                  style={{padding:"10px",borderRadius:12,background:"transparent",border:"none",color:"#94a3b8",fontSize:13,cursor:"pointer"}}>
                  ↺ Recommencer l'analyse
                </button>
              </div>
            );
          })()}

          {/* ══ STEP 4 — RESULTS ══ */}
          {step === "results" && scores && cfg && (
            <div className="slide-up" style={{display:"flex",flexDirection:"column",gap:12}}>

              {scores.nullCount > 0 && (
                <div className="no-print" style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:12,padding:10,fontSize:12,color:"#92400e"}}>
                  ⚠️ <strong>{scores.nullCount} item(s)</strong> illisible(s) — résultats partiels possibles
                </div>
              )}

              {/* Score card */}
              <div className="print-card" style={{background:"white",borderRadius:20,padding:20,border:"1px solid #f1f5f9",boxShadow:"0 2px 12px rgba(0,0,0,.06)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span className="mono" style={{padding:"3px 10px",borderRadius:20,background:cfg.color,color:"white",fontSize:11,fontWeight:700}}>{cfg.name}</span>
                    {patient.name && <span style={{fontSize:13,color:"#475569",fontWeight:500}}>{patient.name}</span>}
                  </div>
                  <span style={{fontSize:12,color:"#94a3b8"}}>{patient.date}</span>
                </div>

                {/* BES */}
                {q === "BES" && (
                  <div style={{display:"flex",flexDirection:"column",gap:16}}>
                    <div style={{textAlign:"center",padding:"8px 0"}}>
                      <div className="mono" style={{fontSize:64,fontWeight:700,lineHeight:1,color:scores.severity.color}}>{scores.total}</div>
                      <div style={{fontSize:12,color:"#94a3b8",marginTop:2}}>points / 46</div>
                      <div style={{marginTop:8,fontSize:16,fontWeight:700,color:scores.severity.color}}>{scores.severity.label}</div>
                    </div>
                    {/* Zone bar */}
                    <div>
                      <div style={{display:"flex",height:20,borderRadius:10,overflow:"hidden"}}>
                        <div style={{width:"36%",background:"#16a34a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"white",fontWeight:600}}>≤16</div>
                        <div style={{width:"21%",background:"#d97706",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"white",fontWeight:600}}>17-26</div>
                        <div style={{width:"43%",background:"#dc2626",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"white",fontWeight:600}}>≥27</div>
                      </div>
                      <div style={{position:"relative",height:14,marginTop:3}}>
                        <div style={{position:"absolute",width:14,height:14,borderRadius:"50%",border:"2.5px solid white",boxShadow:"0 0 0 1.5px "+scores.severity.color+", 0 2px 6px rgba(0,0,0,.2)",background:scores.severity.color,left:`calc(${Math.min((scores.total/46)*100,97)}% - 7px)`,top:0}}/>
                      </div>
                    </div>
                    <div style={{background:scores.severity.bg,borderRadius:12,padding:12,fontSize:13,color:"#334155",lineHeight:1.5}}>
                      {scores.total <= 16 && "Aucun comportement hyperphagique significatif identifié."}
                      {scores.total >= 17 && scores.total <= 26 && "Problèmes modérés de compulsion alimentaire. Stratégies comportementales recommandées."}
                      {scores.total >= 27 && "Compulsion alimentaire sévère. Prise en charge spécialisée recommandée (TCC, suivi pluridisciplinaire)."}
                    </div>
                  </div>
                )}

                {/* EQVOD */}
                {q==="EQVOD" && scores.subscales && (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    {cfg.subscales.map(s => {
                      const val = scores.subscales[s.key];
                      const pct = val != null ? val : 0;
                      const color = val == null ? "#cbd5e1" : val >= 66 ? "#0891b2" : val >= 33 ? "#0e7490" : "#164e63";
                      return (
                        <div key={s.key}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                            <span style={{fontSize:13,fontWeight:500,color:"#374151"}}>{s.label}</span>
                            <span className="mono" style={{fontWeight:700,fontSize:14,color:"#1e293b"}}>{val != null ? val.toFixed(1) : "—"} <span style={{fontSize:11,color:"#94a3b8",fontWeight:400}}>/ 100</span></span>
                          </div>
                          <div style={{height:8,background:"#f1f5f9",borderRadius:4,overflow:"hidden"}}>
                            <div className="bar-fill" style={{height:"100%",width:`${pct}%`,background:color,borderRadius:4}}/>
                          </div>
                        </div>
                      );
                    })}
                    {scores.total != null && (
                      <div style={{paddingTop:10,borderTop:"1px solid #f1f5f9",display:"flex",justifyContent:"space-between",fontSize:13}}>
                        <span style={{color:"#64748b"}}>Score moyen global</span>
                        <span className="mono" style={{fontWeight:700,color:"#1e293b"}}>{scores.total.toFixed(1)} <span style={{color:"#94a3b8",fontWeight:400}}>/ 100</span></span>
                      </div>
                    )}
                    <div style={{background:"#ecfeff",border:"1px solid #a5f3fc",borderRadius:10,padding:"8px 12px",fontSize:11,color:"#164e63"}}>
                      Score élevé (proche de 100) = bonne qualité de vie perçue en lien avec l'obésité.
                    </div>
                  </div>
                )}

                {/* DEBQ / IES-2 */}
                {(q==="DEBQ"||q==="IES2") && (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    {cfg.subscales.map(s => {
                      const val = scores.subscales[s.key];
                      const color = barColor(q, s.key, val);
                      const pct = val ? Math.max(0, Math.min(((val-1)/4)*100, 100)) : 0;
                      let interp = "";
                      if (q==="DEBQ") {
                        interp = val > 3 ? "Positif" : "Négatif";
                      } else {
                        interp = val >= 3.5 ? "Élevé" : val >= 2.5 ? "Modéré" : "Faible";
                      }
                      return (
                        <div key={s.key}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                            <span style={{fontSize:13,fontWeight:500,color:"#374151"}}>{s.label}</span>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              <span className="mono" style={{fontWeight:700,fontSize:14,color:"#1e293b"}}>{val?.toFixed(1)??"—"}</span>
                              <span style={{fontSize:11,padding:"2px 8px",borderRadius:20,background:color,color:"white",fontWeight:600}}>{interp}</span>
                            </div>
                          </div>
                          <div style={{height:6,background:"#f1f5f9",borderRadius:3,overflow:"hidden"}}>
                            <div className="bar-fill" style={{height:"100%",width:`${pct}%`,background:color,borderRadius:3}}/>
                          </div>
                        </div>
                      );
                    })}
                    {scores.total != null && (
                      <div style={{paddingTop:10,borderTop:"1px solid #f1f5f9",display:"flex",justifyContent:"space-between",fontSize:13}}>
                        <span style={{color:"#64748b"}}>Score global moyen</span>
                        <span className="mono" style={{fontWeight:700,color:"#1e293b"}}>{scores.total?.toFixed(1) ?? "—"} / 5</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Chart DEBQ / IES-2 */}
              {(q==="DEBQ"||q==="IES2") && (
                <div className="print-card" style={{background:"white",borderRadius:20,padding:20,border:"1px solid #f1f5f9",boxShadow:"0 2px 12px rgba(0,0,0,.06)"}}>
                  <p style={{fontSize:11,fontWeight:600,color:"#94a3b8",letterSpacing:"0.08em",textTransform:"uppercase",margin:"0 0 12px"}}>Profil graphique</p>
                  <ResponsiveContainer width="100%" height={q==="IES2"?200:160}>
                    <BarChart data={chartData()} layout="vertical" margin={{left:4,right:30,top:4,bottom:4}}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9"/>
                      <XAxis type="number" domain={[1,5]} ticks={[1,2,3,4,5]} tick={{fontSize:11,fill:"#94a3b8"}} axisLine={false} tickLine={false}/>
                      <YAxis type="category" dataKey="name" width={180} tick={{fontSize:11,fill:"#475569"}} axisLine={false} tickLine={false}/>
                      <Tooltip formatter={v=>[typeof v==="number"?v.toFixed(2):v,"Score"]} contentStyle={{borderRadius:10,border:"1px solid #e2e8f0",fontSize:12}}/>
                      <Bar dataKey="value" radius={[0,6,6,0]} maxBarSize={18}>
                        {chartData().map((d,i)=>(
                          <Cell key={i} fill={barColor(q,d.key,d.value)}/>
                        ))}
                      </Bar>
                      <ReferenceLine x={2.5} stroke="#e2e8f0" strokeDasharray="5 5"/>
                    </BarChart>
                  </ResponsiveContainer>
                  <div style={{display:"flex",gap:16,justifyContent:"center",marginTop:8,fontSize:11,color:"#94a3b8"}}>
                    {q==="IES2" ? (
                      <><span>🟢 Élevé ≥3.5</span><span>🟡 Modéré 2.5–3.5</span><span>🔴 Faible &lt;2.5</span></>
                    ) : (
                      <><span>🔴 Positif &gt;3</span><span>🔵 Négatif ≤3</span></>
                    )}
                  </div>
                </div>
              )}

              {/* Reference note */}
              <div className="print-card" style={{background:"#f8f7f4",borderRadius:14,padding:12,border:"1px solid #e2e8f0",fontSize:11,color:"#64748b",lineHeight:1.6}}>
                <strong>Note clinique :</strong> Scores calculés par extraction automatique — vérifiez en cas d'ambiguïté visuelle. Normes indicatives. Référence : {cfg.ref}.
              </div>

              {/* Copyright */}
              <div style={{textAlign:"center",fontSize:11,color:"#94a3b8",padding:"4px 0"}}>
                Scor'Alim · Créé par <strong style={{color:"#64748b"}}>Romain Lecomte</strong>, diététicien-nutritionniste · © {new Date().getFullYear()} Tous droits réservés
              </div>

              {/* Actions */}
              <div className="no-print" style={{display:"flex",gap:10}}>
                <button onClick={()=>{setStep("upload");setFileList([]);setScores(null);setExtracted(null);}}
                  style={{flex:1,padding:"13px",borderRadius:12,border:"1.5px solid #e2e8f0",background:"white",color:"#475569",fontSize:13,fontWeight:600,cursor:"pointer"}}>
                  ↺ Nouvel import
                </button>
                <button onClick={()=>{
                    const doc = new jsPDF({ unit:"pt", format:"a4" });
                    const ref  = buildRef() || "Sans référence";
                    const date = patient.date || "";
                    const qName = cfg.fullName;
                    let y = 50;
                    const W = 595;
                    const M = 50;
                    // En-tête
                    doc.setFontSize(18).setFont(undefined,"bold").setTextColor(30,41,59);
                    doc.text("Scor’Alim — " + qName, M, y); y += 22;
                    doc.setFontSize(11).setFont(undefined,"normal").setTextColor(100,116,139);
                    doc.text(date, M, y); y += 30;
                    doc.setDrawColor(226,232,240).setLineWidth(0.5).line(M, y, W-M, y); y += 20;
                    // Sous-scores DEBQ / IES2
                    if (q==="DEBQ"||q==="IES2") {
                      cfg.subscales.forEach(s => {
                        const val = scores.subscales[s.key];
                        const lbl = q==="DEBQ" ? (val>3?"Positif":"Négatif") : (val>=3.5?"Élevé":val>=2.5?"Modéré":"Faible");
                        const [r,g,b] = q==="DEBQ" ? (val>3?[220,38,38]:[37,99,235]) : (val>=3.5?[22,163,74]:val>=2.5?[217,119,6]:[220,38,38]);
                        doc.setFontSize(12).setFont(undefined,"normal").setTextColor(55,65,81);
                        doc.text(s.label, M, y);
                        doc.setFont(undefined,"bold").setTextColor(30,41,59);
                        doc.text((val?.toFixed(1)??"—"), W-M-120, y);
                        doc.setFillColor(r,g,b).setTextColor(255,255,255).setFontSize(10);
                        doc.roundedRect(W-M-80, y-12, 70, 16, 8, 8, "F");
                        doc.text(lbl, W-M-45, y, {align:"center"});
                        y += 24;
                      });
                      y += 6;
                      doc.setDrawColor(241,245,249).line(M, y, W-M, y); y += 16;
                      doc.setFontSize(12).setFont(undefined,"normal").setTextColor(100,116,139);
                      doc.text("Score global moyen", M, y);
                      doc.setFont(undefined,"bold").setTextColor(30,41,59);
                      doc.text((scores.total?.toFixed(1)??"—") + " / 5", W-M, y, {align:"right"});
                      y += 30;
                    }
                    // BES
                    if (q==="BES") {
                      doc.setFontSize(28).setFont(undefined,"bold").setTextColor(scores.severity.color.replace("#","") ? 30 : 30,41,59);
                      doc.text(String(scores.total), W/2, y+10, {align:"center"}); y += 40;
                      doc.setFontSize(14).setFont(undefined,"bold").setTextColor(100,116,139);
                      doc.text(scores.severity.label, W/2, y, {align:"center"}); y += 30;
                    }
                    // EQVOD
                    if (q==="EQVOD") {
                      cfg.subscales.forEach(s => {
                        const val = scores.subscales[s.key];
                        doc.setFontSize(12).setFont(undefined,"normal").setTextColor(55,65,81);
                        doc.text(s.label, M, y);
                        doc.setFont(undefined,"bold").setTextColor(30,41,59);
                        doc.text((val != null ? val.toFixed(1) : "—") + " / 100", W-M, y, {align:"right"});
                        y += 22;
                      });
                      y += 6;
                      doc.setDrawColor(241,245,249).line(M, y, W-M, y); y += 16;
                      doc.setFontSize(12).setFont(undefined,"normal").setTextColor(100,116,139);
                      doc.text("Score moyen global", M, y);
                      doc.setFont(undefined,"bold").setTextColor(30,41,59);
                      doc.text((scores.total?.toFixed(1)??"—") + " / 100", W-M, y, {align:"right"});
                      y += 30;
                    }
                    // Note clinique
                    doc.setFontSize(10).setFont(undefined,"normal").setTextColor(100,116,139);
                    const note = "Note clinique : Scores calculés par extraction automatique. Normes indicatives. Réf. : " + cfg.ref + ".";
                    doc.text(note, M, y, {maxWidth: W-2*M}); y += 30;
                    // Footer
                    doc.setFontSize(9).setTextColor(148,163,184);
                    doc.text("Scor’Alim · Romain Lecomte, diététicien-nutritionniste · scoralim.vercel.app", W/2, 820, {align:"center"});
                    doc.save("ScorAlim_" + q + "_" + (ref||"dossier") + ".pdf");
                  }}
                  style={{flex:1,padding:"13px",borderRadius:12,border:"none",background:cfg.color,color:"white",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  ⬇️ Exporter PDF
                </button>
              </div>
              <button onClick={reset} className="no-print"
                style={{width:"100%",padding:"10px",borderRadius:12,background:"transparent",border:"none",color:"#94a3b8",fontSize:13,cursor:"pointer"}}>
                + Nouveau questionnaire
              </button>
            </div>
          )}

        </div>

        {/* Footer permanent */}
        <div className="no-print" style={{textAlign:"center",fontSize:10,color:"#64748b",padding:"12px 16px 20px"}}>
          Scor'Alim · Créé par <strong>Romain Lecomte</strong>, diététicien-nutritionniste · © {new Date().getFullYear()} Tous droits réservés
        </div>

      </div>
    </>
  );
}
