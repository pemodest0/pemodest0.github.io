// Runs Python off the page thread: Pyodide, numpy, scipy, and the research code
// fetched from the public repository at the commit that is on main right now.
importScripts("https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.js");

const REPO = "pemodest0/Low-energy-scattering";
const FILES = { "lab.py": "notebooks/2_two_body/lab.py", "schrodinger.py": "notebooks/1_one_body/schrodinger.py" };

async function text(url) {
  for (let i = 0; i < 3; i++) {                    // downloads can drop: try again
    try { const r = await fetch(url); if (r.ok) return await r.text(); } catch (_) {}
    await new Promise(res => setTimeout(res, 1500));
  }
  throw new Error("não consegui baixar " + url);
}

async function boot() {
  postMessage({ status: "Baixando o Python do navegador" });
  const py = await loadPyodide();
  postMessage({ status: "Baixando numpy e scipy" });
  await py.loadPackage(["numpy", "scipy"]);

  let ref = "main", sha = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits/main`);
    if (r.ok) { sha = (await r.json()).sha; ref = sha; }
  } catch (_) {}
  postMessage({ status: "Baixando lab.py e schrodinger.py do repositório" });
  for (const [name, path] of Object.entries(FILES)) {
    py.FS.writeFile(name, await text(`https://raw.githubusercontent.com/${REPO}/${ref}/${path}`));
  }
  py.FS.writeFile("panel.py", await text(new URL("panel.py", self.location).href));
  py.runPython("import sys; sys.path.insert(0, '.')");
  const panel = py.pyimport("panel");
  const catalogue = JSON.parse(panel.run(JSON.stringify({ fn: "catalogue" })));
  postMessage({ ready: true, sha, catalogue });
  return panel;
}

const ready = boot().catch(err => { postMessage({ fatal: String(err && err.message || err) }); throw err; });

onmessage = async (e) => {
  const { id, job } = e.data;
  let panel;
  try { panel = await ready; } catch (_) { return; }
  try {
    const t0 = performance.now();
    const out = JSON.parse(panel.run(JSON.stringify(job)));
    postMessage({ id, ok: true, data: out, seconds: (performance.now() - t0) / 1000 });
  } catch (err) {
    // a Python traceback: the last line says what went wrong
    const lines = String(err && err.message || err).trim().split("\n");
    postMessage({ id, ok: false, error: lines[lines.length - 1] });
  }
};
