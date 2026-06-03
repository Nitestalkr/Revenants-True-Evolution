'use strict';

/**
 * ArXiv Monitor — real-time paper detection and auto-download
 * Replaces: ArXiv Research Monitor cron (periodic fetch)
 *
 * Polls arXiv RSS/API continuously for new papers matching keywords.
 * Stores matches locally. No model dependency.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { resolveDefaultDataDir } = require('./runtime-paths');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5min continuous polling

const DEFAULT_KEYWORDS = [
  'global workspace theory',
  'global neuronal workspace',
  'cognitive architecture',
  'attention schema',
  'consciousness artificial intelligence',
  'working memory neural',
  'free energy principle',
  'predictive coding',
];

const DEFAULT_CATEGORIES = ['cs.AI', 'cs.NE', 'q-bio.NC', 'cond-mat.dis-nn'];

class ArXivMonitor extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.keywords = opts.keywords ?? DEFAULT_KEYWORDS;
    this.categories = opts.categories ?? DEFAULT_CATEGORIES;
    this.dataDir = opts.dataDir ?? resolveDefaultDataDir();
    this.dataFile = path.join(this.dataDir, 'arxiv-state.json');
    this.papersDir = path.join(this.dataDir, 'arxiv-papers');
    this._timer = null;
    this._seen = new Set();
    this._matches = [];
    this._lastPoll = null;
  }

  start() {
    this._ensureDataDir();
    this._loadState();
    this._poll(); // immediate first poll
    this._timer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
    this.emit('started', { keywords: this.keywords });
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._saveState();
    this.emit('stopped');
  }

  getState() {
    return {
      lastPoll: this._lastPoll,
      matchCount: this._matches.length,
      seenCount: this._seen.size,
      recentMatches: this._matches.slice(-5),
      ts: new Date().toISOString(),
    };
  }

  _poll() {
    this._lastPoll = new Date().toISOString();
    const query = this._buildQuery();
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&sortBy=submittedDate&sortOrder=descending&max_results=20`;

    this._fetchUrl(url)
      .then(xml => this._parseAtom(xml))
      .then(papers => {
        const newPapers = papers.filter(p => !this._seen.has(p.id));
        for (const p of newPapers) {
          this._seen.add(p.id);
          this._matches.push(p);
          this._saveAbstract(p);
          this.emit('paper_detected', p);
          this.emit('alert', { type: 'arxiv_paper', paper: p, ts: new Date().toISOString() });
        }
        if (this._matches.length > 500) this._matches = this._matches.slice(-500);
        this._saveState();
        this.emit('poll_complete', { newCount: newPapers.length, total: this._seen.size });
      })
      .catch(err => {
        this.emit('poll_error', { error: err.message, ts: new Date().toISOString() });
      });
  }

  _buildQuery() {
    const catQuery = this.categories.map(c => `cat:${c}`).join(' OR ');
    const kwQuery = this.keywords.map(k => `"${k}"`).join(' OR ');
    return `(${catQuery}) AND (${kwQuery})`;
  }

  _fetchUrl(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 30000 }, res => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.on('error', reject);
    });
  }

  _parseAtom(xml) {
    const papers = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;
    while ((match = entryRegex.exec(xml)) !== null) {
      const entry = match[1];
      const id = this._extract(entry, 'id');
      const title = this._extract(entry, 'title');
      const summary = this._extract(entry, 'summary');
      const published = this._extract(entry, 'published');
      const authors = [...entry.matchAll(/<name>(.*?)<\/name>/g)].map(m => m[1]).slice(0, 5);
      if (id && title) {
        papers.push({ id, title: title.trim(), summary: summary?.trim() ?? '', published, authors });
      }
    }
    return papers;
  }

  _extract(xml, tag) {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1].trim() : null;
  }

  _saveAbstract(paper) {
    try {
      const safe = paper.id.replace(/[^a-zA-Z0-9._-]/g, '_');
      const file = path.join(this.papersDir, `${safe}.json`);
      fs.writeFileSync(file, JSON.stringify(paper, null, 2));
    } catch (_) { /* non-fatal */ }
  }

  _ensureDataDir() {
    for (const dir of [path.dirname(this.dataFile), this.papersDir]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
  }

  _loadState() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const saved = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
        this._seen = new Set(saved.seen ?? []);
        this._matches = saved.matches ?? [];
      }
    } catch (_) { /* start fresh */ }
  }

  _saveState() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify({
        seen: [...this._seen].slice(-1000),
        matches: this._matches.slice(-100),
        lastPoll: this._lastPoll,
        ts: new Date().toISOString(),
      }, null, 2));
    } catch (_) { /* non-fatal */ }
  }
}

module.exports = ArXivMonitor;
