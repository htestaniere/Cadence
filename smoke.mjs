// Tests de fumée de Cadence : node tests/smoke.mjs  (nécessite : npm i -D playwright && npx playwright install chromium)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const p = path.join(root, req.url.split("?")[0] === "/" ? "index.html" : req.url.split("?")[0]);
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/index.html`;

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok   " : "  FAIL ") + msg); if (!cond) fails++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
await page.route(/goatcounter|gc\.zgo\.at|fonts\.(googleapis|gstatic)/, r => r.abort());
await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem("gen-lang", "fr"); localStorage.setItem("gen-disc", "1"); localStorage.setItem("gen-tuto", "1"); });
await page.reload();
await page.waitForTimeout(400);

const pick = async sp => {
  await page.evaluate(() => wizShow(0));
  await page.evaluate(s => document.querySelector(`[data-sport="${s}"]`).click(), sp);
  await page.waitForTimeout(200);
};

console.log("Sports : génération d'une semaine");
for (const sp of ["run", "trail", "bike", "dua", "tri"]) {
  await pick(sp);
  const n = await page.evaluate(() => { render(); return SESS.length; });
  ok(n > 0, `${sp} : ${n} séances générées`);
}

console.log("Trail : séances spécifiques et D+");
await pick("trail");
const seen = new Set();
let dplus = 0;
for (let v = 0; v < 14; v++) {
  const r = await page.evaluate(v => { variant = v; render(); return { codes: SESS.map(s => s.code), d: (window.__all && window.__all[0] && window.__all[0].A) ? window.__all[0].A.dplus : 0 }; }, v);
  r.codes.forEach(c => c && seen.add(c));
  dplus = Math.max(dplus, r.d || 0);
}
ok([...seen].some(c => /^T[1-5]$/.test(c)), "au moins une séance trail (T1–T5) apparaît");
ok(seen.has("T4") || seen.has("T5"), "la sortie longue est une sortie avec D+");
ok(dplus > 0, `le D+ hebdomadaire est calculé (${dplus} m)`);

console.log("Séances : export intervals.icu");
const iv = await page.evaluate(() => ["T1", "T2", "T3", "T4", "T5", "C22", "V2"].every(k => typeof IV[k] === "function" && IV[k](ivCtx(ctx()), 60).length > 20));
ok(iv, "tous les gabarits intervals.icu produisent du texte");

console.log("Contact");
const mail = await page.evaluate(() => CONTACT_EMAIL);
ok(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(mail), "l'adresse de contact est valide");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
ok(!html.includes(mail), "l'adresse n'apparaît pas en clair dans le code");

console.log("Langue : anglais puis retour");
await pick("tri");
await page.evaluate(() => setLang("en"));
await page.waitForTimeout(300);
const leftovers = async () => page.evaluate(() => {
  const FR = /[àâçéèêëîïôûùü]|\b(ton|tes|séance|séances|semaine|pour|avec|sans|selon|cette|entre|puis)\b/i;
  const out = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const p = n.parentNode.nodeName;
    if (p === "SCRIPT" || p === "STYLE" || p === "TEXTAREA") continue;
    const t = n.nodeValue.replace(/\s+/g, " ").trim();
    if (t && FR.test(t)) out.add(t.slice(0, 80));
  }
  return [...out];
});
for (let st = 0; st < 6; st++) {
  await page.evaluate(s => wizShow(s), st);
  await page.waitForTimeout(100);
}
const left = await leftovers();
ok(left.length === 0, left.length ? `texte français restant : ${left.slice(0, 5).join(" | ")}` : "aucun texte français restant en anglais");
const tutoLeft = await page.evaluate(async () => {
  const FR = /[àâçéèêëîïôûùü]|\b(ton|tes|séance|séances|semaine|pour|avec|sans|selon|cette|entre|puis|une|des|les|est)\b/i;
  const bad = [];
  for (const st of TUTO) {
    const d = document.createElement("div");
    document.body.appendChild(d);
    d.innerHTML = "<h3>" + st.t + "</h3>" + st.b;
    await new Promise(r => setTimeout(r, 250));
    for (const line of d.innerText.split("\n")) if (line.trim() && FR.test(line)) bad.push(line.trim().slice(0, 60));
    d.remove();
  }
  return bad;
});
ok(tutoLeft.length === 0, tutoLeft.length ? "tutoriel : français restant : " + tutoLeft.slice(0, 3).join(" | ") : "le tutoriel est entièrement traduit en anglais");
await page.evaluate(() => setLang("fr"));
await page.waitForTimeout(200);
ok(await page.evaluate(() => document.documentElement.lang === "fr"), "retour en français");

console.log("Tutoriel : étapes à cliquer");
await page.evaluate(() => { localStorage.setItem("gen-tuto", "1"); });
await pick("tri");
await page.evaluate(() => { render(); openTuto(); });
for (let k = 0; k < 3; k++) { await page.evaluate(() => document.getElementById("tutoNext").click()); await page.waitForTimeout(200); }
const tState = () => page.evaluate(() => ({ coach: !document.getElementById("tcoach").hidden, t: document.getElementById("tcT").textContent }));
ok((await tState()).coach, "étape interactive : la fenêtre guide s'affiche");
await page.evaluate(() => document.querySelector("#ov .ovc").click());
await page.waitForTimeout(900);
ok((await tState()).t.length > 0 && (await tState()).coach, "après le clic sur la séance, l'étape suivante s'affiche");
await page.evaluate(() => { document.getElementById("tcSkip").click(); });
ok(await page.evaluate(() => document.getElementById("tcoach").hidden && document.getElementById("tspot").hidden), "Passer ferme la visite guidée");

ok(errors.length === 0, errors.length ? "erreurs JS : " + errors.join(" ; ") : "aucune erreur JavaScript");

await browser.close();
server.close();
console.log(fails ? `\n${fails} test(s) en échec` : "\nTous les tests passent");
process.exit(fails ? 1 : 0);
