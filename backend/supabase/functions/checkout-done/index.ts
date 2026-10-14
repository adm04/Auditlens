// GET /functions/v1/checkout-done   — where Dodo sends the customer after paying.
// Deploy with --no-verify-jwt. Replace with a page on your own website (SITE_URL) when you have one.

Deno.serve((req) => {
  const status = new URL(req.url).searchParams.get('status') || '';
  const failed = /fail|cancel/i.test(status);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${failed ? 'Payment not completed' : 'Welcome to AuditLens Pro'}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F7F6F2;color:#14213D;font:16px/1.6 system-ui,sans-serif}
.card{max-width:460px;background:#fff;border:1px solid #E3E1DA;border-radius:18px;padding:36px;text-align:center}
h1{font-size:26px;margin:10px 0}.mark{font-size:40px}</style></head>
<body><div class="card"><div class="mark">${failed ? '⚠️' : '✅'}</div>
<h1>${failed ? 'Payment not completed' : 'You’re on Pro'}</h1>
<p>${failed ? 'No charge was made. You can close this tab and try again from AuditLens.' : 'Thanks! Your account is being upgraded. Close this tab and go back to AuditLens — Pro unlocks within a few seconds.'}</p>
</div></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
});
