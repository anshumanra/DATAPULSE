const express = require('express');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

let groq;
if (process.env.GROQ_API_KEY) {
  groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
}

function extractSheetId(url) {
  const normalised = url.startsWith('http') ? url : 'https://' + url;
  let parsed;
  try { parsed = new URL(normalised); } catch { return null; }
  if (parsed.hostname !== 'docs.google.com') return null;
  const m = parsed.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? { sheetId: m[1], parsed } : null;
}

// List all sheets — returns [{ name, gid }]
app.get('/api/sheets/meta', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url' });

  const info = extractSheetId(url);
  if (!info) return res.status(400).json({ error: 'Invalid Google Sheets URL' });
  const { sheetId, parsed } = info;

  // Attempt 1: gviz JSON — fast and returns sheet metadata for shared sheets
  try {
    const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json`;
    const gvizRes = await fetch(gvizUrl);
    if (gvizRes.ok) {
      const raw = await gvizRes.text();
      // Strip JSONP wrapper: /*O_o*/\ngoogle.visualization.Query.setResponse({...});
      const jsonStr = raw.replace(/^[^(]+\(/, '').replace(/\);?\s*$/, '');
      const data = JSON.parse(jsonStr);
      if (data?.status === 'ok') {
        // gviz doesn't return all sheets list directly, but confirms sheet is accessible
        // Fall through to HTML parsing for the full sheet list
      }
    }
  } catch {}

  // Attempt 2: Google Sheets v3 Feeds — names + first-sheet gid
  try {
    const feedRes = await fetch(
      `https://spreadsheets.google.com/feeds/worksheets/${sheetId}/public/basic?alt=json`
    );
    if (feedRes.ok) {
      const data = await feedRes.json();
      const entries = data?.feed?.entry;
      if (Array.isArray(entries) && entries.length) {
        const sheets = entries
          .map((e, i) => ({ name: String(e.title?.['$t'] || '').trim(), gid: i === 0 ? '0' : null }))
          .filter(s => s.name);
        if (sheets.length === 1) return res.json({ sheets });
        // Multi-sheet: fall through to HTML parsing to get proper gids
        if (sheets.length > 1) {
          // Try HTML to add gids, merge results
          try {
            const html = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/edit`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
              redirect: 'follow',
            }).then(r => r.text());
            const gidMap = new Map();
            for (const [, gid, name] of html.matchAll(/href="[^"]*[#&?]gid=(\d+)[^"]*"[^>]*>\s*([^<]{1,60})\s*</g)) {
              gidMap.set(name.trim(), gid);
            }
            for (const [, name, gid] of html.matchAll(/"title":"([^"]{1,80})","sheetId":(\d+)/g)) {
              gidMap.set(name, gid);
            }
            const enriched = sheets.map(s => ({ ...s, gid: gidMap.get(s.name) || s.gid }));
            return res.json({ sheets: enriched });
          } catch {}
          return res.json({ sheets });
        }
      }
    }
  } catch {}

  // Attempt 2: HTML — extract both name AND gid from anchor links and embedded JSON
  try {
    const html = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/edit`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'follow',
    }).then(r => r.text());

    const seen = new Map(); // name → gid

    // Pattern A: JSON — "title":"Name","sheetId":N
    for (const [, name, gid] of html.matchAll(/"title":"([^"]{1,80})","sheetId":(\d+)/g)) {
      if (!seen.has(name)) seen.set(name, gid);
    }
    // Pattern B: JSON reversed — "sheetId":N ... "title":"Name"
    for (const [, gid, name] of html.matchAll(/"sheetId":(\d+)[^}]{0,120}"title":"([^"]{1,80})"/g)) {
      if (!seen.has(name)) seen.set(name, gid);
    }
    // Pattern C: anchor href with gid — most reliable for sheet tabs
    for (const [, gid, name] of html.matchAll(/href="[^"]*[#&?]gid=(\d+)[^"]*"[^>]*>\s*([^<]{1,60})\s*</g)) {
      const t = name.trim();
      if (t) seen.set(t, gid); // overwrite — anchor text is more reliable
    }

    if (seen.size) {
      return res.json({ sheets: [...seen.entries()].map(([name, gid]) => ({ name, gid })) });
    }
  } catch {}

  // Fallback: extract gid from the original URL
  const gidMatch = (parsed.hash + parsed.search).match(/gid=([0-9]+)/);
  res.json({ sheets: [{ name: 'Sheet1', gid: gidMatch ? gidMatch[1] : '0' }] });
});

// Proxy Google Sheets CSV
// Priority: ?gid=N → direct export (preserves merged cells)
//           ?sheet=Name → gviz fallback (may lose merged-cell group headers)
app.get('/api/sheets', async (req, res) => {
  const { url, sheet, gid: gidParam } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  const info = extractSheetId(url);
  if (!info) return res.status(400).json({ error: 'Only Google Sheets URLs are supported' });
  const { sheetId, parsed } = info;

  let csvUrl;
  if (gidParam && /^\d+$/.test(gidParam)) {
    // Best path: direct CSV export by numeric gid — preserves ALL row content including merged cells
    csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gidParam}`;
  } else if (sheet && typeof sheet === 'string' && sheet.trim()) {
    // Fallback: gviz by sheet name (merged-cell group header content may be stripped)
    csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet.trim())}&headers=0`;
  } else {
    // Legacy: gid from original URL
    const gidMatch = (parsed.hash + parsed.search).match(/gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : '0';
    csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  }

  try {
    const upstream = await fetch(csvUrl);
    if (!upstream.ok) {
      return res.status(400).json({ error: 'Failed to fetch sheet. Make sure it is shared as "Anyone with the link can view".' });
    }
    const text = await upstream.text();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(text);
  } catch {
    res.status(500).json({ error: 'Network error fetching sheet.' });
  }
});

// Proxy Metabase question data
app.post('/api/metabase', async (req, res) => {
  const { metabaseUrl, sessionToken, questionId } = req.body;

  if (!metabaseUrl || !sessionToken || !questionId) {
    return res.status(400).json({ error: 'Missing metabaseUrl, sessionToken, or questionId' });
  }

  let base;
  try {
    base = new URL(metabaseUrl);
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error();
  } catch {
    return res.status(400).json({ error: 'Invalid Metabase URL' });
  }

  const qid = parseInt(questionId, 10);
  if (!Number.isFinite(qid) || qid < 1) {
    return res.status(400).json({ error: 'Invalid question ID' });
  }

  const apiUrl = `${base.origin}/api/card/${qid}/query/json`;

  try {
    const upstream = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Metabase-Session': sessionToken,
      },
      body: JSON.stringify({}),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return res.status(upstream.status).json({ error: `Metabase error: ${upstream.status}`, detail: text.slice(0, 200) });
    }

    const json = await upstream.json();
    res.json(json);
  } catch (err) {
    res.status(500).json({ error: 'Network error contacting Metabase.' });
  }
});

// Groq AI Q&A
app.post('/api/ask', async (req, res) => {
  if (!groq) {
    return res.status(503).json({
      error: 'AI not configured. Add GROQ_API_KEY to your .env file and restart the server.',
    });
  }

  const { question, dataContext } = req.body;

  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return res.status(400).json({ error: 'Question is required' });
  }
  if (question.length > 1000) {
    return res.status(400).json({ error: 'Question too long (max 1000 chars)' });
  }
  if (dataContext && typeof dataContext !== 'string') {
    return res.status(400).json({ error: 'Invalid dataContext' });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1024,
      messages: [
        {
          role: 'system',
          content: `You are a concise performance-dashboard analyst. Answer only from the provided dataset/context. Do not invent values, leaders, exams, months, or formulas. If the requested number is not present in the context, say what is missing and use the closest available exact column only if you name it. Format Indian business units clearly: Cr for collection, L/K for orders where appropriate, and rupees for AOV. Keep answers brief and direct.

When your answer would be better understood visually, append a VIZ tag on the very last line:
[VIZ:{"leader":"ExactName","metric":"Achieved MTD","chart":"bar"}]
Fields (all optional, omit what you don't want to change):
- "leader": exact leader name to filter charts to, or null to show all leaders
- "metric": exact column name to visualise on the charts (e.g. "Achieved MTD", "Bizfin AOP - May")
- "chart": "bar" or "line"
Only add [VIZ:...] when it genuinely helps illustrate the answer.`,
        },
        {
          role: 'user',
          content: `Dataset:\n${(dataContext || '').slice(0, 8000)}\n\nQuestion: ${question}`,
        },
      ],
    });

    res.json({ answer: completion.choices[0].message.content });
  } catch (err) {
    console.error('Groq API error:', err.message);
    res.status(500).json({ error: 'AI request failed. Check your API key and try again.' });
  }
});

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
  console.log(`\n  DataPulse running → http://localhost:${PORT}\n`);
  if (!process.env.GROQ_API_KEY) {
    console.log('  Note: AI Q&A disabled — add GROQ_API_KEY to .env to enable it.\n');
  }
});
