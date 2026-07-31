import dns from 'node:dns/promises';
import net from 'node:net';

const TIMEOUT_MS = 8000;
const MAX_BYTES = 512 * 1024; // 512 KB de HTML já cobre qualquer <head>
const MAX_REDIRECTS = 3;

/**
 * Este endpoint faz o servidor buscar uma URL que o usuário digitou, então
 * precisa de proteção contra SSRF: sem isso dava pra usar o site como proxy
 * para varrer a rede interna de onde ele estiver hospedado.
 */
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) || // link-local / metadata da cloud
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      a >= 224 // multicast + reservado
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    // IPv4 mapeado em IPv6 (::ffff:10.0.0.1)
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true; // formato desconhecido: bloqueia
}

async function assertPublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('URL inválida');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Só aceito links http ou https');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');

  // Se já for um IP literal, valida direto (não passa por DNS).
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Endereço não permitido');
    return url;
  }

  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length) throw new Error('Não consegui resolver esse domínio');
  if (records.some((r) => isPrivateAddress(r.address))) {
    throw new Error('Endereço não permitido');
  }

  return url;
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function metaContent(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1]).trim();
  }
  return null;
}

/** Lê o <head> da página e extrai título, imagem e preço das meta tags. */
export async function fetchLinkPreview(rawUrl) {
  let current = await assertPublicUrl(rawUrl);
  let response;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          // Sem um UA de browser muitas lojas devolvem 403.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      // Cada salto é revalidado — senão um redirect para 127.0.0.1 furaria o guard.
      current = await assertPublicUrl(new URL(location, current).href);
      continue;
    }
    break;
  }

  if (!response.ok) {
    throw new Error(`O site respondeu ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('html')) {
    throw new Error('Esse link não é uma página HTML');
  }

  // Lê só o começo do corpo — o que interessa está no <head>.
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const html = Buffer.concat(chunks).toString('utf8');

  const title =
    metaContent(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
      /<title[^>]*>([^<]+)<\/title>/i,
    ]) || null;

  let image = metaContent(html, [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ]);
  if (image) {
    try {
      image = new URL(image, current).href; // resolve caminho relativo
    } catch {
      image = null;
    }
  }

  const rawPrice = metaContent(html, [
    /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:price:amount["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["']/i,
  ]);
  const price = rawPrice ? Number.parseFloat(rawPrice.replace(',', '.')) : null;

  const description = metaContent(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  ]);

  return {
    title,
    image,
    description: description?.slice(0, 300) || null,
    price: Number.isFinite(price) && price > 0 ? price : null,
    siteName: current.hostname.replace(/^www\./, ''),
  };
}
