// Kelo-Finans — Gemini Edition
// Yerel-Öncelikli (Local-First) + Atomik GitHub Senkronizasyon Katmanı, Yedekleme ve CSV Ekstre Mutabakatı.

import { parseMoneyInput, round2 } from './finance.js';

export const LOCAL_PREFIX = 'kft_v1_';
export const GH_CFG_KEY = 'kft_github_cfg_v1';
export const GEMINI_CACHE_KEY = 'kft_gemini_cache_v1';
export const GEMINI_META_KEY = 'kft_gemini_sync_meta_v1';

// Orijinal KFT koleksiyonları + Gemini ek (geriye dönük uyumlu) koleksiyonları
export const COLLECTIONS = [
  'people',
  'income_types',
  'expense_categories',
  'income_entries',
  'expense_entries',
  'savings_holdings',
  'material_prices',
  'fund_lots',
  'fund_sales',
  'fund_prices',
  // Gemini ek koleksiyonları (eski sürümler bu alanları görmezden gelir, veri kaybolmaz)
  'transfers',
  'metal_sales',
  'debts',
  'snapshots',
  'fund_configs'
];

export const COLLECTION_TO_STATE = {
  people: 'people',
  income_types: 'incomeTypes',
  expense_categories: 'expenseCategories',
  income_entries: 'incomeEntries',
  expense_entries: 'expenseEntries',
  savings_holdings: 'savingsHoldings',
  material_prices: 'materialPrices',
  fund_lots: 'fundLots',
  fund_sales: 'fundSales',
  fund_prices: 'fundPrices',
  transfers: 'transfers',
  metal_sales: 'metalSales',
  debts: 'debts',
  snapshots: 'snapshots',
  fund_configs: 'fundConfigs'
};

export function newId(prefix = 'g') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function getGithubConfig() {
  try {
    const raw = window.localStorage.getItem(GH_CFG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setGithubConfig(cfg) {
  try {
    window.localStorage.setItem(GH_CFG_KEY, JSON.stringify(cfg));
  } catch {}
}

export function clearGithubConfig() {
  try {
    window.localStorage.removeItem(GH_CFG_KEY);
  } catch {}
}

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class GithubApi {
  constructor(cfg) {
    this.cfg = cfg; // { owner, repo, token, path }
    this.sha = null;
  }

  _url() {
    return `https://api.github.com/repos/${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}/contents/${encodeURIComponent(this.cfg.path || 'data.json')}`;
  }

  _headers() {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  async testConnection() {
    let res;
    try {
      res = await fetch(`https://api.github.com/repos/${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}`, {
        headers: this._headers()
      });
    } catch {
      return { ok: false, error: 'Bağlantı kurulamadı (internet?)' };
    }
    if (res.status === 404) return { ok: false, error: 'Repo bulunamadı — kullanıcı adı/repo adını kontrol et' };
    if (res.status === 401) return { ok: false, error: 'Token geçersiz' };
    if (!res.ok) return { ok: false, error: `Hata: ${res.status}` };
    const json = await res.json();
    const perms = json.permissions || {};
    if (perms.push === false) return { ok: false, error: 'Token bu repoya yazma izni vermiyor' };
    return { ok: true };
  }

  async fetchData() {
    const res = await fetch(`${this._url()}?t=${Date.now()}`, {
      headers: this._headers(),
      cache: 'no-store'
    });
    if (res.status === 404) {
      this.sha = null;
      return null;
    }
    if (!res.ok) throw new Error(`GitHub okuma hatası: ${res.status}`);
    const json = await res.json();
    this.sha = json.sha;
    if (!json.content) return null;
    const text = b64ToUtf8(json.content);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('data.json bozuk görünüyor');
    }
  }

  async saveData(dataObj, message) {
    const body = {
      message: message || `KFT Gemini güncelleme ${new Date().toISOString()}`,
      content: utf8ToB64(JSON.stringify(dataObj, null, 2))
    };
    if (this.sha) body.sha = this.sha;
    const res = await fetch(this._url(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...this._headers() },
      body: JSON.stringify(body)
    });
    if (res.status === 409) {
      const err = new Error('conflict');
      err.conflict = true;
      throw err;
    }
    if (!res.ok) {
      let msg = `GitHub yazma hatası: ${res.status}`;
      try {
        const j = await res.json();
        if (j && j.message) msg += ` — ${j.message}`;
      } catch {}
      throw new Error(msg);
    }
    const json = await res.json();
    this.sha = json.content.sha;
    return json.content.sha;
  }
}

export function emptyData() {
  const m = {};
  for (const c of COLLECTIONS) m[c] = [];
  return m;
}

function cloneData(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function mergeById(remoteArr, beforeArr, afterArr) {
  const remoteMap = new Map((remoteArr || []).map(x => [x.id, x]));
  const beforeMap = new Map((beforeArr || []).map(x => [x.id, x]));
  const afterMap = new Map((afterArr || []).map(x => [x.id, x]));

  // Silinenler
  for (const id of beforeMap.keys()) {
    if (!afterMap.has(id)) {
      remoteMap.delete(id);
    }
  }
  // Eklenen veya güncellenenler
  for (const [id, item] of afterMap.entries()) {
    const prev = beforeMap.get(id);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(item)) {
      remoteMap.set(id, item);
    }
  }
  return Array.from(remoteMap.values());
}

export class StoreLayer {
  constructor(gh) {
    this.gh = gh || null;
    this.mem = emptyData();
    this.syncStatus = gh ? 'connecting' : 'local'; // 'synced' | 'pending' | 'local' | 'error'
    this.lastSyncedAt = null;
    this.pendingCount = 0;
    this._onStatusChange = null;
    this._loadLocalFallback();
  }

  onStatusChange(fn) {
    this._onStatusChange = fn;
  }

  _notifyStatus() {
    if (this._onStatusChange) {
      this._onStatusChange({
        status: this.syncStatus,
        lastSyncedAt: this.lastSyncedAt,
        pendingCount: this.pendingCount
      });
    }
  }

  _loadMeta() {
    try {
      const raw = window.localStorage.getItem(GEMINI_META_KEY);
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch {
      return {};
    }
  }

  _saveMeta(meta) {
    try {
      window.localStorage.setItem(GEMINI_META_KEY, JSON.stringify(meta));
    } catch {}
  }

  _loadLocalFallback() {
    try {
      const cacheRaw = window.localStorage.getItem(GEMINI_CACHE_KEY);
      if (cacheRaw) {
        const parsed = JSON.parse(cacheRaw);
        for (const col of COLLECTIONS) {
          this.mem[col] = Array.isArray(parsed[col]) ? parsed[col] : [];
        }
        const meta = this._loadMeta();
        this.lastSyncedAt = meta.lastSyncedAt || null;
        this.pendingCount = Number(meta.pendingCount || 0);
        return;
      }
    } catch {}

    // KFT v1 yerel anahtarlarından oku
    for (const col of COLLECTIONS) {
      try {
        const raw = window.localStorage.getItem(LOCAL_PREFIX + col);
        this.mem[col] = raw ? JSON.parse(raw) : [];
      } catch {
        this.mem[col] = [];
      }
    }
  }

  _writeLocalCache() {
    try {
      window.localStorage.setItem(GEMINI_CACHE_KEY, JSON.stringify(this.mem));
      if (!this.gh) {
        for (const col of COLLECTIONS) {
          window.localStorage.setItem(LOCAL_PREFIX + col, JSON.stringify(this.mem[col]));
        }
      }
    } catch (e) {
      console.error('Yerel önbellek yazılamadı', e);
    }
  }

  async initFromGithub() {
    if (!this.gh) {
      this.syncStatus = 'local';
      this._notifyStatus();
      return;
    }

    const meta = this._loadMeta();
    const hasPending = Number(meta.pendingCount || 0) > 0;
    const remote = await this.gh.fetchData();

    if (hasPending && remote) {
      // Çevrimdışı girilmiş bekleyen değişiklikleri uzak verinin üzerine güvenle birleştir
      const base = meta.baseSnapshot || emptyData();
      const merged = emptyData();
      for (const col of COLLECTIONS) {
        merged[col] = mergeById(remote[col], base[col], this.mem[col]);
      }
      this.mem = merged;
      await this.gh.saveData(this.mem, 'KFT Gemini çevrimdışı senkronizasyon');
      this.pendingCount = 0;
      this.lastSyncedAt = new Date().toISOString();
      this.syncStatus = 'synced';
      this._saveMeta({ lastSyncedAt: this.lastSyncedAt, pendingCount: 0, baseSnapshot: cloneData(this.mem) });
      this._writeLocalCache();
      this._notifyStatus();
      return;
    }

    if (remote) {
      for (const col of COLLECTIONS) {
        this.mem[col] = Array.isArray(remote[col]) ? remote[col] : [];
      }
    }
    this.pendingCount = 0;
    this.lastSyncedAt = new Date().toISOString();
    this.syncStatus = 'synced';
    this._saveMeta({ lastSyncedAt: this.lastSyncedAt, pendingCount: 0, baseSnapshot: cloneData(this.mem) });
    this._writeLocalCache();
    this._notifyStatus();
  }

  /**
   * Tek atomik işlem (Transaction): Çoklu koleksiyon değişikliğini tek bellekte uygular,
   * yerel önbelleğe yazar ve GitHub'a TEK bir commit atar.
   * Çakışma (409) durumunda kullanıcı verisini silmek yerine 3-yönlü birleştirme yapar.
   */
  async transaction(mutatorFn, commitMessage = 'KFT Gemini güncelleme') {
    const before = cloneData(this.mem);
    const draft = cloneData(this.mem);
    const result = await mutatorFn(draft);

    // Tüm koleksiyonları doğrula
    for (const col of COLLECTIONS) {
      if (!Array.isArray(draft[col])) draft[col] = [];
    }

    this.mem = draft;
    this._writeLocalCache();

    if (!this.gh) {
      this.syncStatus = 'local';
      this._notifyStatus();
      return result;
    }

    try {
      await this.gh.saveData(this.mem, commitMessage);
      this.pendingCount = 0;
      this.lastSyncedAt = new Date().toISOString();
      this.syncStatus = 'synced';
      this._saveMeta({ lastSyncedAt: this.lastSyncedAt, pendingCount: 0, baseSnapshot: cloneData(this.mem) });
      this._notifyStatus();
      return result;
    } catch (err) {
      if (err && err.conflict) {
        // 409 Conflict: Uzak veriyi çek ve 3-yönlü birleştir (kullanıcı kaydını kaybetme!)
        try {
          const remote = (await this.gh.fetchData()) || emptyData();
          const merged = emptyData();
          for (const col of COLLECTIONS) {
            merged[col] = mergeById(remote[col], before[col], draft[col]);
          }
          this.mem = merged;
          this._writeLocalCache();
          await this.gh.saveData(this.mem, `${commitMessage} (birleştirildi)`);
          this.pendingCount = 0;
          this.lastSyncedAt = new Date().toISOString();
          this.syncStatus = 'synced';
          this._saveMeta({ lastSyncedAt: this.lastSyncedAt, pendingCount: 0, baseSnapshot: cloneData(this.mem) });
          this._notifyStatus();
          return result;
        } catch (mergeErr) {
          this._markPending(before);
          throw mergeErr;
        }
      }
      this._markPending(before);
      throw err;
    }
  }

  _markPending(baseBefore) {
    const meta = this._loadMeta();
    this.pendingCount = Number(meta.pendingCount || 0) + 1;
    this.syncStatus = 'pending';
    this._saveMeta({
      lastSyncedAt: this.lastSyncedAt,
      pendingCount: this.pendingCount,
      baseSnapshot: meta.baseSnapshot || baseBefore
    });
    this._notifyStatus();
  }

  async syncNow() {
    if (!this.gh) return { ok: false, reason: 'no_github' };
    try {
      await this.initFromGithub();
      return { ok: true };
    } catch (e) {
      this.syncStatus = 'error';
      this._notifyStatus();
      return { ok: false, error: e?.message || 'Eşitleme başarısız' };
    }
  }

  list(col) {
    return (this.mem[col] || []).slice();
  }

  exportSnapshot() {
    return cloneData(this.mem);
  }

  async replaceAll(newData) {
    return this.transaction(draft => {
      for (const col of COLLECTIONS) {
        draft[col] = Array.isArray(newData[col]) ? newData[col] : [];
      }
    }, 'KFT Gemini yedekten geri yükleme');
  }
}

/**
 * Türkçe Excel uyumlu UTF-8 BOM CSV oluşturucu
 */
export function buildTransactionsCsv(entries) {
  const header = ['Tarih', 'Tür', 'Kişi', 'Başlık/Kategori', 'Detay/Kaynak', 'Tutar (TL)', 'Not'];
  const escCsv = val => {
    const s = String(val == null ? '' : val).replace(/"/g, '""');
    return `"${s}"`;
  };
  const rows = [header.map(escCsv).join(';')];
  for (const e of entries) {
    const signAmt = e.kind === 'gider' ? -Math.abs(e.amount) : e.amount;
    rows.push(
      [
        e.date,
        e.kind === 'gelir' ? 'Gelir' : e.kind === 'gider' ? 'Gider' : 'Transfer',
        e.personName || '',
        e.label || '',
        e.sub || '',
        round2(signAmt).toFixed(2).replace('.', ','),
        e.note || ''
      ]
        .map(escCsv)
        .join(';')
    );
  }
  return '\uFEFF' + rows.join('\r\n');
}

/**
 * Banka CSV ekstresini ayrıştırır (noktalı virgül veya virgül ayraçlı, TR tarih/tutar destekli)
 * ve mevcut kayıtlarla ±2 gün & tutar üzerinden eşleştirir.
 */
export function parseBankCsvAndMatch(csvText, existingEntries) {
  const lines = String(csvText || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const splitLine = line => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQ = !inQ;
      } else if (ch === sep && !inQ) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const headers = splitLine(lines[0]).map(h => h.toLocaleLowerCase('tr-TR'));
  let dateIdx = headers.findIndex(h => /tarih|date|işlem tarihi/.test(h));
  let descIdx = headers.findIndex(h => /açıklama|aciklama|detay|desc|işlem/.test(h));
  let amtIdx = headers.findIndex(h => /tutar|miktar|amount/.test(h));
  if (dateIdx < 0) dateIdx = 0;
  if (descIdx < 0) descIdx = 1;
  if (amtIdx < 0) amtIdx = headers.length - 1;

  const normDate = raw => {
    const s = String(raw || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  };

  const dayDiff = (d1, d2) => {
    const t1 = Date.parse(d1);
    const t2 = Date.parse(d2);
    if (!Number.isFinite(t1) || !Number.isFinite(t2)) return 999;
    return Math.abs(t1 - t2) / 86400000;
  };

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    const date = normDate(cols[dateIdx]);
    const amountRaw = parseMoneyInput(cols[amtIdx]);
    if (!date || !Number.isFinite(amountRaw) || amountRaw === 0) continue;

    const kind = amountRaw < 0 ? 'gider' : 'gelir';
    const amount = round2(Math.abs(amountRaw));
    const description = cols[descIdx] || 'Banka hareketi';

    const matched = (existingEntries || []).find(
      e => e.kind === kind && Math.abs(Number(e.amount) - amount) < 0.02 && dayDiff(e.date, date) <= 2
    );

    results.push({
      rowIndex: i,
      date,
      kind,
      amount,
      description,
      matchedEntry: matched || null
    });
  }

  return results;
}
