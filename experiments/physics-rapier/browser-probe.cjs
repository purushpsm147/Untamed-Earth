// Rapier start-up and kinematic-controller cost in headless Chromium (CPU work only; no rendering involved).
// Usage (repo root): node experiments/physics-rapier/browser-probe.cjs [out.json]
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');
const root = path.join(__dirname, 'node_modules/@dimforge/rapier3d-deterministic-compat/dist');
const srv = http.createServer((q, r) => {
  const f = q.url === '/' ? null : path.join(root, q.url.replace(/^\/+/, ''));
  if (!f) { r.setHeader('content-type', 'text/html'); return r.end('<!doctype html><title>probe</title>'); }
  try { const b = fs.readFileSync(f); r.setHeader('content-type', f.endsWith('.mjs') || f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); r.end(b); } catch { r.statusCode = 404; r.end(); }
}).listen(0, async () => {
  const port = srv.address().port;
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto(`http://localhost:${port}/`);
  const res = await p.evaluate(async (port) => {
    const t0 = performance.now();
    const R = (await import(`http://localhost:${port}/rapier.mjs`)).default;
    const t1 = performance.now();
    await R.init();
    const t2 = performance.now();
    const w = new R.World({ x: 0, y: -9.81, z: 0 });
    w.createCollider(R.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
    let s = 1;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 400; i++) w.createCollider(R.ColliderDesc.cylinder(3, 0.3 + rnd() * 0.5).setTranslation(rnd() * 200 - 100, 3, rnd() * 200 - 100));
    const kcc = w.createCharacterController(0.02); kcc.setSlideEnabled(true); kcc.enableSnapToGround(0.6);
    const deer = []; for (let i = 0; i < 50; i++) deer.push(w.createCollider(R.ColliderDesc.capsule(0.3, 0.35).setTranslation(rnd() * 160 - 80, 0.7, rnd() * 160 - 80)));
    w.step();
    const ts = [];
    for (let k = 0; k < 400; k++) {
      const a = performance.now();
      for (const c of deer) { kcc.computeColliderMovement(c, { x: 0.13, y: -0.02, z: 0.05 }); const m = kcc.computedMovement(); const t = c.translation(); c.setTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z }); }
      w.step();
      ts.push((performance.now() - a) / deer.length);
    }
    ts.sort((x, y) => x - y);
    return { importMs: t1 - t0, initMs: t2 - t1, kccMsPerDeerTick: { median: ts[200], p95: ts[380], p99: ts[396] }, ua: navigator.userAgent };
  }, port);
  const out = { env: { browser: b.version(), note: 'headless Chromium, CPU only; same container as the Node runs' }, ...res };
  fs.writeFileSync(process.argv[2] || 'docs/evidence/tech-experiments/physics-browser-probe.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
  await b.close(); srv.close();
});
