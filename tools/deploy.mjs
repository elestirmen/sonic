// sonik.perinet.org yayını: Cloudflare DNS kaydı → Let's Encrypt sertifikası →
// Nginx Proxy Manager proxy host → HTTPS doğrulaması. Tekrar çalıştırmak güvenlidir;
// var olan kayıt/sertifika/host yeniden kullanılır.
//
// Kimlik bilgileri ortam değişkenlerinden ya da --env ile verilen dosyadan okunur ve
// hiçbir zaman yazdırılmaz:
//   CF_API_TOKEN              (ya da CF_API_KEY + CF_API_EMAIL: global anahtar)
//   NPM_EMAIL, NPM_PASSWORD   Nginx Proxy Manager yönetici girişi
// certbot biçimi de kabul edilir: dns_cloudflare_api_token = …
// İsteğe bağlı: DOMAIN, REFERENCE (hedefi/ayarları örnek alınacak site), NPM_URL
//
//   node tools/deploy.mjs [--env /yol/gizli.env[,/yol/diger.env]] [--dry-run]

import { readFileSync } from 'node:fs';
import https from 'node:https';
import { parseArgs } from './args.js';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const { flags } = parseArgs(argv.filter((a) => a !== '--dry-run'));

function readEnvFile(path) {
  const out = {};
  const alias = {
    CLOUDFLARE_API_TOKEN: 'CF_API_TOKEN',
    dns_cloudflare_api_token: 'CF_API_TOKEN',
    dns_cloudflare_api_key: 'CF_API_KEY',
    dns_cloudflare_email: 'CF_API_EMAIL',
  };
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*[=:]\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    out[alias[m[1]] ?? m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const envFiles = [].concat(flags.env ?? []).flatMap((f) => f.split(','));
const cfg = { ...process.env, ...Object.assign({}, ...envFiles.map(readEnvFile)) };
cfg.CF_API_TOKEN ??= cfg.CLOUDFLARE_API_TOKEN;
const DOMAIN = cfg.DOMAIN ?? 'sonik.perinet.org';
const ZONE = DOMAIN.split('.').slice(-2).join('.');
const REFERENCE = cfg.REFERENCE ?? `flappy.${ZONE}`;
const NPM_URL = cfg.NPM_URL ?? 'http://127.0.0.1:81';
const UPSTREAM = { host: 'sonik-web', port: 80 };

const log = (s) => console.log(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Cloudflare

async function cf(path, init = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.CF_API_TOKEN) headers.Authorization = `Bearer ${cfg.CF_API_TOKEN}`;
  else if (cfg.CF_API_KEY && cfg.CF_API_EMAIL) {
    headers['X-Auth-Key'] = cfg.CF_API_KEY;
    headers['X-Auth-Email'] = cfg.CF_API_EMAIL;
  } else throw new Error('Cloudflare kimliği yok (CF_API_TOKEN ya da CF_API_KEY + CF_API_EMAIL)');
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!body.success) {
    throw new Error(`Cloudflare ${init.method ?? 'GET'} ${path.split('?')[0]}: ${body.errors?.map((e) => e.message).join('; ') || res.status}`);
  }
  return body.result;
}

async function ensureDns() {
  if (cfg.CF_API_TOKEN) {
    const v = await cf('/user/tokens/verify');
    if (v.status !== 'active') throw new Error(`Cloudflare anahtarı etkin değil (${v.status})`);
    log('✓ Cloudflare anahtarı doğrulandı');
  }
  const [zone] = await cf(`/zones?name=${ZONE}`);
  if (!zone) throw new Error(`${ZONE} bölgesi bu anahtarla görünmüyor`);
  const existing = await cf(`/zones/${zone.id}/dns_records?name=${DOMAIN}`);
  if (existing.length) {
    const r = existing[0];
    log(`✓ DNS: ${DOMAIN} zaten var (${r.type}, proxy ${r.proxied ? 'açık' : 'kapalı'})`);
    return;
  }
  const [ref] = await cf(`/zones/${zone.id}/dns_records?name=${REFERENCE}`);
  if (!ref) throw new Error(`örnek kayıt ${REFERENCE} bulunamadı; REFERENCE ile başka bir site ver`);
  const record = { type: ref.type, name: DOMAIN, content: ref.content, proxied: ref.proxied, ttl: 1, comment: 'Sonik: sesle veri aktarımı' };
  if (dryRun) return log(`• DNS: ${DOMAIN} oluşturulacak (${ref.type}, ${REFERENCE} ile aynı hedef, proxy ${ref.proxied ? 'açık' : 'kapalı'})`);
  await cf(`/zones/${zone.id}/dns_records`, { method: 'POST', body: JSON.stringify(record) });
  log(`✓ DNS: ${DOMAIN} oluşturuldu (${ref.type}, ${REFERENCE} ile aynı hedef, proxy ${ref.proxied ? 'açık' : 'kapalı'})`);
}

/**
 * Adı HTTPS üzerinden DNS (DoH) ile çözer. Bazı ağlarda modem 53. porttaki bütün
 * sorguları kendisi yanıtlar ve kayıt yokken sorulan "yok" yanıtını SOA süresince
 * (burada 30 dk) saklar; DoH bu ara önbelleğe takılmaz.
 */
async function resolve4(name) {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=A`, {
    headers: { accept: 'application/dns-json' },
  });
  const body = await res.json();
  return (body.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
}

async function waitDns() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await resolve4(DOMAIN)).length) return log('✓ DNS yayında (DoH ile doğrulandı)');
    } catch {
      // henüz yok ya da geçici ağ hatası
    }
    await sleep(5000);
  }
  throw new Error('DNS kaydı 5 dk içinde görünmedi');
}

// ---------------------------------------------------------------- Nginx Proxy Manager

async function npm(path, init = {}, token) {
  const res = await fetch(`${NPM_URL}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`NPM ${init.method ?? 'GET'} ${path}: ${body.error?.message ?? res.status}`);
  return body;
}

async function ensureProxyHost() {
  if (!cfg.NPM_EMAIL || !cfg.NPM_PASSWORD) throw new Error('NPM girişi yok (NPM_EMAIL, NPM_PASSWORD)');
  const { token } = await npm('/tokens', { method: 'POST', body: JSON.stringify({ identity: cfg.NPM_EMAIL, secret: cfg.NPM_PASSWORD }) });
  const hosts = await npm('/nginx/proxy-hosts', {}, token);
  const existing = hosts.find((h) => h.domain_names.includes(DOMAIN));
  if (existing) return log(`✓ NPM: ${DOMAIN} proxy host zaten var (#${existing.id})`);
  const ref = hosts.find((h) => h.domain_names.includes(REFERENCE));

  const certs = await npm('/nginx/certificates', {}, token);
  let cert = certs.find((c) => c.domain_names.includes(DOMAIN));
  if (!cert) {
    // NPM 2.15: Let's Encrypt e-postası hesaptan gelir; meta yalnız sınama türünü taşır.
    const refCert = certs.find((c) => c.id === ref?.certificate_id);
    const meta = { dns_challenge: false, ...(refCert?.meta?.key_type ? { key_type: refCert.meta.key_type } : {}) };
    if (dryRun) {
      log(`• NPM: ${DOMAIN} için Let's Encrypt sertifikası istenecek`);
    } else {
      log(`… Let's Encrypt sertifikası isteniyor (bir dakika sürebilir)`);
      cert = await npm(
        '/nginx/certificates',
        { method: 'POST', body: JSON.stringify({ provider: 'letsencrypt', nice_name: DOMAIN, domain_names: [DOMAIN], meta }) },
        token,
      );
      log(`✓ Sertifika alındı (#${cert.id})`);
    }
  }

  // Güvenlik/SSL ayarları Cloudflare arkasında çalıştığı bilinen örnek siteden; hedef bizim konteyner.
  const pick = (key, fallback) => (ref && key in ref ? ref[key] : fallback);
  const host = {
    domain_names: [DOMAIN],
    forward_scheme: 'http',
    forward_host: UPSTREAM.host,
    forward_port: UPSTREAM.port,
    access_list_id: 0,
    certificate_id: cert?.id ?? 0,
    ssl_forced: pick('ssl_forced', true),
    http2_support: pick('http2_support', true),
    hsts_enabled: pick('hsts_enabled', false),
    hsts_subdomains: pick('hsts_subdomains', false),
    block_exploits: pick('block_exploits', true),
    ...(ref && 'trust_forwarded_proto' in ref ? { trust_forwarded_proto: ref.trust_forwarded_proto } : {}),
    caching_enabled: false,
    allow_websocket_upgrade: false,
    advanced_config: '',
    locations: [],
    meta: {},
  };
  if (dryRun) return log(`• NPM: proxy host ${DOMAIN} → http://${UPSTREAM.host}:${UPSTREAM.port} oluşturulacak`);
  const created = await npm('/nginx/proxy-hosts', { method: 'POST', body: JSON.stringify(host) }, token);
  log(`✓ NPM: proxy host #${created.id} ${DOMAIN} → http://${UPSTREAM.host}:${UPSTREAM.port} (Force SSL, HTTP/2)`);
}

/** Yerel çözücünün önbelleğindeki eski "yok" yanıtına takılmamak için adı DoH ile çözer. */
async function httpsGet(url) {
  const lookup = (host, opts, cb) =>
    resolve4(host).then(
      (addrs) => (opts.all ? cb(null, addrs.map((address) => ({ address, family: 4 }))) : cb(null, addrs[0], 4)),
      (err) => cb(err),
    );
  return new Promise((resolve, reject) => {
    const req = https.get(url, { lookup, headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('zaman aşımı')));
  });
}

async function verify() {
  let last = '';
  for (let i = 0; i < 20; i++) {
    try {
      const res = await httpsGet(`https://${DOMAIN}/`);
      if (res.status === 200 && res.body.includes('<title>Sonik')) return log(`✓ https://${DOMAIN}/ yayında (HTTP ${res.status})`);
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err.message; // sertifika/önbellek oturana kadar bekle
    }
    await sleep(3000);
  }
  throw new Error(`https://${DOMAIN}/ 60 sn içinde doğru yanıt vermedi (${last})`);
}

try {
  await ensureDns();
  if (!dryRun) await waitDns();
  await ensureProxyHost();
  if (!dryRun) await verify();
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
