import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";
import * as mammoth from "mammoth";
import JSZip from "jszip";

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
  }
};

/* Parse un DOCX DEBQ rempli numériquement — lit le XML brut word/document.xml */
function parseDebqDocx(xml) {
  // Extraire le texte des balises <w:t> en préservant les caractères spéciaux (☒ U+2612)
  const textBlocks = [];
  const tagRe = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let m;
  while ((m = tagRe.exec(xml)) !== null) {
    textBlocks.push(m[1]);
  }
  const text = textBlocks.join(" ");

  const items = [];
  const regex = /☒\s*([^☐☒]{1,120})/g;
  while ((m = regex.exec(text)) !== null) {
    const label = m[1].trim().toLowerCase();
    let v;
    if (label.startsWith("je ") || label.startsWith("j\u2019") || label.startsWith("j'")) v = 0;
    else if (label.startsWith("très souvent")) v = 5;
    else if (label.startsWith("souvent"))      v = 4;
    else if (label.startsWith("parfois"))      v = 3;
    else if (label.startsWith("rarement"))     v = 2;
    else if (label.startsWith("jamais"))       v = 1;
    else                                        v = null;
    items.push({ v, c: v !== null ? 1 : 0 });
  }
  return items;
}

const PROMPTS = {
  DEBQ: `Analyse ce questionnaire DEBQ (33 items).
Mise en page : chaque item présente ses options sur une ligne horizontale :
□ Jamais  □ Rarement  □ Parfois  □ Souvent  □ Très souvent  (□ Je ne...)
Le patient coche une seule case en traçant une croix à l'intérieur (☒).
Lis attentivement quelle case contient la croix — ne te fie pas à la proximité spatiale, inspecte l'intérieur de chaque case.
L'option "Je ne..." peut apparaître en fin de ligne ou déborder sur la ligne suivante : traite-la comme une option à part entière.
Règle de cotation : "Je ne..." = 0 ; Jamais = 1 ; Rarement = 2 ; Parfois = 3 ; Souvent = 4 ; Très souvent = 5.
Pour chaque item de 1 à 33, indique la valeur ET ta confiance.
Réponds UNIQUEMENT avec ce JSON, sans texte ni balises markdown :
{"items":[{"v":3,"c":1},{"v":0,"c":1},...]}
"v" = valeur lue (entier 0-5, ou null si illisible). "c" = confiance : 1=certain, 0=incertain ou illisible.`,

  IES2: `Analyse ce questionnaire IES-2 (18 items, échelle 1-5 : 1=pas du tout d'accord, 5=tout à fait d'accord).
Pour chaque item de 1 à 18, indique la valeur cochée/entourée ET ta confiance dans la lecture.
Réponds UNIQUEMENT avec ce JSON, sans texte ni balises markdown :
{"items":[{"v":3,"c":1},{"v":2,"c":0},...]}
"v" = valeur lue (entier 1-5, ou null si illisible). "c" = confiance : 1=certain, 0=incertain ou illisible.`,

  BES: `Analyse ce questionnaire BES - Binge Eating Scale (16 items).
Chaque item présente 3 ou 4 propositions. Le patient en coche/entoure une seule.
Pour chaque item de 1 à 16, indique l'index de la proposition choisie ET ta confiance.
Réponds UNIQUEMENT avec ce JSON, sans texte ni balises markdown :
{"items":[{"v":0,"c":1},{"v":2,"c":0},...]}
"v" = index choisi (0=1ère proposition, 1=2ème, etc.), ou null si illisible. "c" = confiance : 1=certain, 0=incertain.`
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
  const cfg = CONFIGS[q];
  const rev = cfg.reverseItems || [];
  // v=0 = réponse "Je ne..." → toujours 0, jamais inversé
  const proc = items.map((v,i) => v == null ? null : (v === 0 ? 0 : rev.includes(i+1) ? 6-v : v));
  const subs = {};
  cfg.subscales.forEach(s => {
    const vals = s.items.map(n => proc[n-1]).filter(v => v != null);
    subs[s.key] = vals.length ? +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2) : null;
  });
  const allVals = Object.values(subs).filter(v => v != null);
  const total = allVals.length ? +(allVals.reduce((a,b)=>a+b,0)/allVals.length).toFixed(2) : null;
  return { type:q, subscales:subs, total, nullCount: items.filter(v=>v==null).length };
}

function barColor(q, key, val) {
  if (val == null) return "#cbd5e1";
  if (q === "DEBQ") {
    const n = CONFIGS.DEBQ.norms[key];
    if (!n) return "#6366f1";
    return val >= n.high ? "#dc2626" : val < n.low ? "#2563eb" : "#d97706";
  }
  return val >= 3.5 ? "#16a34a" : val >= 2.5 ? "#d97706" : "#dc2626";
}

/* ─── MAIN APP ───────────────────────────────────────────────── */
export default function ScorAlim() {
  const [step, setStep]               = useState("select"); // select | upload | processing | review | results
  const [q, setQ]                     = useState(null);
  const [fileList, setFileList]       = useState([]);
  const [extractedItems, setExtracted]= useState(null); // [{v, c}]
  const [scores, setScores]           = useState(null);
  const [error, setError]             = useState(null);
  const [patient, setPatient]         = useState({ name:"", date: new Date().toLocaleDateString("fr-FR") });

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
        const b64 = await toB64(file);
        // PDF replaces everything (auto-paginated)
        setFileList([{ type:"pdf", data:b64.split(",")[1], name:file.name }]);
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
        content = [
          { type:"document", source:{ type:"base64", media_type:"application/pdf", data:first.data } },
          { type:"text", text:prompt }
        ];
      } else if (first.type === "docx") {
        // DOCX numérique DEBQ : lecture XML directe via JSZip
        if (q === "DEBQ") {
          const zip = await JSZip.loadAsync(first.arrayBuffer);
          const xmlRaw = await zip.file("word/document.xml").async("string");
          const items = parseDebqDocx(xmlRaw);
          // Compléter jusqu'à 33 items si des réponses manquent — la review step gérera les null (orange)
          while (items.length < 33) items.push({ v: null, c: 0 });
          const normalized = items.slice(0, 33).map(item => ({ v: item.v ?? null, c: item.c ?? 1 }));
          setExtracted(normalized);
          setStep("review");
          return;
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
        body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, messages:[{role:"user",content}] })
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
    setScores(calcScores(q, items.map(i => i.v)));
    setStep("results");
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
              <div style={{fontSize:11,color:"#64748b",letterSpacing:"0.05em", marginTop:2}}>DEBQ · IES-2 · BES · ANALYSE AUTOMATIQUE</div>
            </div>

            {step !== "select" && (
              <button onClick={reset} style={{fontSize:12,color:"#94a3b8",border:"1px solid #334155",borderRadius:8,padding:"5px 12px",background:"transparent",cursor:"pointer"}}>← Menu</button>
            )}
          </div>
        </div>

        {/* Print header */}
        <div className="print-header" style={{maxWidth:560,margin:"0 auto",padding:"20px 20px 0",display:"none"}}>
          <h1 style={{fontSize:20,fontWeight:700,margin:0}}>Scor'Alim — {cfg?.fullName}</h1>
          {patient.name && <p style={{margin:"4px 0 0",color:"#475569"}}>{patient.name}</p>}
          <p style={{margin:"2px 0 12px",color:"#94a3b8",fontSize:13}}>{patient.date}</p>
          <hr style={{borderColor:"#e2e8f0"}}/>
        </div>

        <div style={{maxWidth:560, margin:"0 auto", padding:"20px 16px", display:"flex", flexDirection:"column", gap:14}}>

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
                  <span style={{fontSize:10,color:"#94a3b8"}}>⚠️ N'utilisez pas le nom du patient</span>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <input type="text" placeholder="Code / initiales / numéro dossier" value={patient.name}
                    onChange={e=>setPatient(p=>({...p,name:e.target.value}))}
                    style={{flex:1,border:"1.5px solid #e2e8f0",borderRadius:10,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"'DM Sans',sans-serif"}}
                    onFocus={e=>e.target.style.borderColor="#6366f1"} onBlur={e=>e.target.style.borderColor="#e2e8f0"}/>
                  <input type="text" placeholder="Date" value={patient.date}
                    onChange={e=>setPatient(p=>({...p,date:e.target.value}))}
                    style={{width:110,border:"1.5px solid #e2e8f0",borderRadius:10,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"'DM Sans',sans-serif"}}
                    onFocus={e=>e.target.style.borderColor="#6366f1"} onBlur={e=>e.target.style.borderColor="#e2e8f0"}/>
                </div>
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
            const uncertain = extractedItems.filter(i => i.c === 0 || i.v === null).length;
            const [items, setItems] = [extractedItems, setExtracted];
            const maxVal = q === "BES" ? null : 5;
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
                  {uncertain > 0 ? (
                    <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"8px 12px",fontSize:12,color:"#92400e"}}>
                      ⚠️ <strong>{uncertain} item(s)</strong> incertain(s) ou illisible(s) — surlignés en orange. Corrigez-les avant de calculer.
                    </div>
                  ) : (
                    <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"8px 12px",fontSize:12,color:"#166534"}}>
                      ✅ Tous les items ont été lus avec confiance. Vérifiez si nécessaire.
                    </div>
                  )}
                </div>

                {/* Items grid */}
                <div style={{background:"white",borderRadius:16,padding:14,border:"1px solid #f1f5f9"}}>
                  <p style={{fontSize:11,fontWeight:600,color:"#94a3b8",letterSpacing:"0.08em",textTransform:"uppercase",margin:"0 0 12px"}}>
                    Réponses extraites — tapez pour modifier
                  </p>
                  <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(72px, 1fr))", gap:6}}>
                    {items.map((item, idx) => {
                      const isUncertain = item.c === 0 || item.v === null;
                      const options = isBES
                        ? (CONFIGS.BES.weights[idx] || []).map((_, oi) => oi)
                        : q === "DEBQ" ? [0,1,2,3,4,5] : [1,2,3,4,5];
                      return (
                        <div key={idx} style={{
                          border: `2px solid ${isUncertain ? "#f97316" : "#e2e8f0"}`,
                          borderRadius: 10,
                          padding: "6px 4px",
                          background: isUncertain ? "#fff7ed" : "#fafafa",
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 3
                        }}>
                          <span style={{fontSize:10,color:"#94a3b8",fontWeight:600}}>
                            {isUncertain ? "⚠️" : ""} Q{idx+1}
                          </span>
                          <select
                            value={item.v ?? ""}
                            onChange={e => updateItem(idx, e.target.value === "" ? null : +e.target.value)}
                            style={{
                              width:"100%", fontSize:13, fontWeight:700,
                              color: isUncertain ? "#ea580c" : "#1e293b",
                              border:"none", background:"transparent",
                              textAlign:"center", cursor:"pointer", outline:"none"
                            }}
                          >
                            <option value="">—</option>
                            {options.map(o => (
                              <option key={o} value={o}>{isBES ? `P${o+1}` : o}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button
                  onClick={() => confirmItems(extractedItems)}
                  style={{padding:"14px",borderRadius:14,fontWeight:700,fontSize:14,color:"white",border:"none",cursor:"pointer",background:`linear-gradient(135deg, ${cfg.color}, ${cfg.color}cc)`}}>
                  Calculer les scores →
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

                {/* DEBQ / IES-2 */}
                {(q==="DEBQ"||q==="IES2") && (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    {cfg.subscales.map(s => {
                      const val = scores.subscales[s.key];
                      const color = barColor(q, s.key, val);
                      const pct = val ? Math.max(0, Math.min(((val-1)/4)*100, 100)) : 0;
                      let interp = "";
                      if (q==="DEBQ") {
                        const n = CONFIGS.DEBQ.norms[s.key];
                        interp = val >= n.high ? "Positif" : val < n.low ? "Faible" : "Modéré";
                      } else {
                        interp = val >= 3.5 ? "Élevé" : val >= 2.5 ? "Modéré" : "Faible";
                      }
                      return (
                        <div key={s.key}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                            <span style={{fontSize:13,fontWeight:500,color:"#374151"}}>{s.label}</span>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              <span className="mono" style={{fontWeight:700,fontSize:14,color:"#1e293b"}}>{val?.toFixed(2)??"—"}</span>
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
                        <span className="mono" style={{fontWeight:700,color:"#1e293b"}}>{scores.total} / 5</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Chart */}
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
                      <><span>🔴 Élevé</span><span>🟡 Modéré</span><span>🔵 Faible</span></>
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
                <button onClick={()=>window.print()}
                  style={{flex:1,padding:"13px",borderRadius:12,border:"none",background:cfg.color,color:"white",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  🖨️ Exporter PDF
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
