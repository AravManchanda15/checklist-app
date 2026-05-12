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

async function importVapidPrivateKey(b64) {
  const raw = fromB64url(b64);
  // Wrap raw P-256 private key bytes in PKCS8 DER
  const prefix = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06,
    0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03,
    0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01,
    0x01, 0x04, 0x20,
  ]);
  const pkcs8 = new Uint8Array(prefix.length + raw.length);
  pkcs8.set(prefix);
  pkcs8.set(raw, prefix.length);
  return crypto.subtle.importKey(
    'pkcs8', pkcs8.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );
}

async function buildVapidAuth(endpoint, publicKey, privateKeyB64) {
  const origin = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 43200,
    sub: 'mailto:notifications@checklist-app.local',
  }));
  const unsigned = `${header}.${payload}`;
  const key = await importVapidPrivateKey(privateKeyB64);
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
      'Content-Length': '0',
    },
  });
  return res;
}

export default {
  // Cron trigger — fires every 4 hours
  async scheduled(event, env, ctx) {
    const res = await sendPush(env);
    console.log('Push sent:', res.status);
  },

  // HTTP handler — GET /send to trigger manually for testing
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/send') {
      const res = await sendPush(env);
      return new Response(`Push sent: ${res.status}`, { status: 200 });
    }
    return new Response('Checklist notification worker running.', { status: 200 });
  },
};
