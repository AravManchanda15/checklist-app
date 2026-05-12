// Checklist App - Push Notification Worker
// Sends a reminder every 4 hours via Web Push.
//
// Required environment variables (set in Cloudflare dashboard):
//   VAPID_PUBLIC_KEY  — from setup
//   VAPID_PRIVATE_KEY — from setup
//   PUSH_SUBSCRIPTION — JSON string copied from the app after enabling notifications

function b64url(data) {
  let str = '';
  if (data instanceof Uint8Array) {
    for (const b of data) str += String.fromCharCode(b);
  } else {
    str = data;
  }
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromB64url(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function importVapidPrivateKey(privateKeyB64, publicKeyB64) {
  // Extract x and y from the uncompressed public key (04 || x || y)
  const pub = fromB64url(publicKeyB64);
  const x = b64url(pub.slice(1, 33));
  const y = b64url(pub.slice(33, 65));
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, d: privateKeyB64, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

async function buildVapidAuth(endpoint, publicKey, privateKeyB64) {
  const origin = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 43200,
    sub: 'mailto:arav@checklist-app.com',
  }));
  const unsigned = `${header}.${payload}`;
  const key = await importVapidPrivateKey(privateKeyB64, publicKey);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  );
  const token = `${unsigned}.${b64url(new Uint8Array(sig))}`;
  return `vapid t=${token},k=${publicKey}`;
}

async function sendPush(env) {
  const sub = JSON.parse(env.PUSH_SUBSCRIPTION);
  const auth = await buildVapidAuth(sub.endpoint, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'TTL': '86400',
    },
  });
  return res;
}

export default {
  async scheduled(event, env, ctx) {
    const res = await sendPush(env);
    console.log('Push sent:', res.status);
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/send') {
      try {
        const res = await sendPush(env);
        const body = await res.text();
        return new Response(`Status: ${res.status}\n${body}`, { status: 200 });
      } catch (e) {
        return new Response(`Error: ${e.message}`, { status: 500 });
      }
    }
    return new Response('Checklist notification worker running.', { status: 200 });
  },
};
