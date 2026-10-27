/* Galileu in the browser: forms on the left, results in the middle, Python in worker.js. */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : String(k));
  return n;
}
const fmt = (v, d = 7) => (v == null || !isFinite(v)) ? "—" : Number(v).toPrecision(d);
const sci = (v) => (v == null || !isFinite(v)) ? "—" : Number(v).toExponential(1);
function tex(latex, display = true) {
  const n = display ? el("div", { class: "latex" }) : el("span");
  try { katex.render(latex, n, { displayMode: display, throwOnError: false }); } catch (_) { n.textContent = latex; }
  return n;
}

const PLOT_LAYOUT = () => ({
  paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(11,19,34,.55)",
  font: { color: "#e6ecf7", family: "Segoe UI, system-ui, sans-serif", size: 12 },
  margin: { l: 58, r: 18, t: 36, b: 46 }, legend: { orientation: "h", y: -0.2 },
  xaxis: { gridcolor: "#22324f", zerolinecolor: "#3a4d72" },
  yaxis: { gridcolor: "#22324f", zerolinecolor: "#3a4d72" },
});
const PLOT_CONFIG = { displaylogo: false, responsive: true, toImageButtonOptions: { format: "svg" } };
const COLORS = ["#f2c14e", "#7aa7ff", "#3fbf86", "#ef6461", "#c792ea", "#5fd3e0", "#e0a84a", "#a3be8c"];
function plot(title, traces, extra = {}) {
  const div = el("div", { class: "plot" });
  const layout = Object.assign(PLOT_LAYOUT(), extra);
  layout.title = { text: title, font: { size: 13 } };
  setTimeout(() => Plotly.newPlot(div, traces, layout, PLOT_CONFIG));  // after the card is in the page
  return div;
}

/* ------------------------------------------------------------------ worker */
const worker = new Worker("worker.js");
const pending = new Map();
let CAT = null, nextId = 1;
worker.onmessage = (e) => {
  const m = e.data;
  if (m.status) { $("#boot").textContent = m.status + "…"; return; }
  if (m.fatal) {
    $("#py").className = "pill bad"; $("#py").textContent = "Python não carregou";
    $("#boot").innerHTML = "";
    $("#boot").append(el("span", { class: "error" }, "Não deu para carregar: " + m.fatal + ". Recarregue a página."));
    return;
  }
  if (m.ready) {
    CAT = m.catalogue;
    $("#py").className = "pill ok"; $("#py").textContent = "Python pronto";
    const c = $("#commit");
    c.hidden = false;
    c.textContent = "código " + (m.sha ? m.sha.slice(0, 7) : "main");
    c.title = "lab.py e schrodinger.py neste commit do Low-energy-scattering";
    c.href = "https://github.com/pemodest0/Low-energy-scattering/tree/" + (m.sha || "main");
    $("#boot").textContent = "Escolha um experimento à esquerda e clique em Rodar.";
    $$(".run").forEach((b) => (b.disabled = false));
    formOne(); formTwo();
    return;
  }
  const p = pending.get(m.id);
  pending.delete(m.id);
  m.ok ? p.resolve(m) : p.reject(new Error(m.error));
};
const call = (job) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  worker.postMessage({ id, job });
});

/* ------------------------------------------------------------------ forms */
function slider(name, [def, min, max], integer = false) {
  const step = integer ? 1 : (max - min) / 200;
  const range = el("input", { type: "range", min, max, step, value: def });
  const num = el("input", { type: "number", step: integer ? 1 : "any", value: def, "data-param": name });
  range.addEventListener("input", () => (num.value = range.value));
  num.addEventListener("input", () => (range.value = num.value));
  return el("div", { class: "param" }, el("span", { class: "name" }, name), range, num);
}
const field = (label, input) => el("label", {}, label, input);
const number = (id, value, step = "any") => el("input", { type: "number", id, value, step });
const values = (root) => Object.fromEntries([...root.querySelectorAll("[data-param]")].map((i) => [i.dataset.param, +i.value]));

const EVOLVE_OK = ["harmonic", "finite_well", "poschl_teller", "gaussian", "double_well", "barrier"];
const PACKET = { barrier: { x0: -10, k0: 3, sigma: 1.5, t: 8 }, harmonic: { x0: -3, k0: 0, sigma: 0.5, t: 12.566 } };

function formOne() {
  const exp = $("#exp-one").value;
  const box = $("#form-one");
  box.innerHTML = "";
  if (exp === "tunnelling") {
    box.append(tex("V = V_0\\ \\text{para}\\ 0<x<L"),
      el("div", { class: "stack", id: "params" }, slider("V0", [5, 0.5, 20]), slider("L", [1, 0.2, 4])),
      el("p", { class: "hint" }, "Transmissão T(E) de 0 a 3V₀ pela matriz de transferência do repositório, comparada com a forma fechada."));
    return;
  }
  const keys = Object.keys(CAT.one).filter((k) => exp === "spectrum" || EVOLVE_OK.includes(k));
  const sel = el("select", { id: "pot" }, keys.map((k) => el("option", { value: k }, CAT.one[k].name)));
  const latex = el("div");
  const params = el("div", { class: "stack", id: "params" });
  const extra = el("div", { class: "stack" });
  const redraw = () => {
    const p = CAT.one[sel.value];
    latex.replaceChildren(tex(p.latex));
    params.replaceChildren(...Object.entries(p.params).map(([n, d]) => slider(n, d, n === "l")));
    if (exp === "evolve") {
      const d = PACKET[sel.value] || { x0: -3, k0: 2, sigma: 0.5, t: 10 };
      extra.replaceChildren(
        el("div", { class: "row" }, field("centro x₀", number("x0", d.x0)), field("momento k₀", number("k0", d.k0))),
        el("div", { class: "row" }, field("largura σ", number("sigma", d.sigma)), field("tempo final", number("tmax", d.t))));
    }
  };
  sel.addEventListener("change", redraw);
  box.append(field("Potencial", sel), latex, params, extra);
  if (exp === "spectrum") {
    box.append(field("Quantos níveis", el("input", { type: "number", id: "nstates", value: 5, min: 1, max: 8, step: 1 })),
      el("label", { class: "check" }, el("input", { type: "checkbox", id: "refine", checked: true }), "Conferir cada nível com o Numerov do repositório"));
  }
  redraw();
}

function formTwo() {
  const exp = $("#exp-two").value;
  const box = $("#form-two");
  box.innerHTML = "";
  if (exp === "helium") {
    box.append(
      field("Potencial medido", el("select", { id: "hepot" }, Object.entries(CAT.helium).map(([k, n]) => el("option", { value: k, selected: k === "lm2m2" }, n)))),
      field("ħ²/2m_r", el("select", { id: "const" },
        el("option", { value: "motovilov" }, "12,12 K·Å² (a da tabela de Motovilov)"),
        el("option", { value: "codata" }, "12,11932 K·Å² (CODATA)"))),
      el("p", { class: "hint" }, "Sem parâmetro livre: o comprimento de espalhamento e a energia do dímero são previsões do potencial."));
    return;
  }
  const sel = el("select", { id: "tpot" }, Object.entries(CAT.two).map(([k, p]) => el("option", { value: k, selected: k === "gauss" }, p.name)));
  const latex = el("div");
  const showTex = () => latex.replaceChildren(tex(CAT.two[sel.value].latex));
  sel.addEventListener("change", showTex);
  const a = el("input", { type: "text", id: "a", value: "5.4" });
  const r0 = number("r0", 1.7);
  const names = { nn: "nêutron-nêutron", unitarity: "unitariedade", deuteron: "dêuteron" };
  const chips = el("div", { class: "chips" }, Object.entries(CAT.targets).map(([k, t]) =>
    el("button", { class: "ghost", type: "button", onclick: () => { a.value = t.a == null ? "inf" : t.a; r0.value = t.r0; } }, names[k] || k)));
  box.append(field("Potencial", sel), latex,
    el("div", { class: "stack" }, el("span", { class: "hint" }, "Alvos da Tabela 2 de Macêdo-Lima e Madeira (2023):"), chips),
    el("div", { class: "row" }, field("a (inf = unitariedade)", a), field("r₀", r0)),
    field("Estados ligados (nós)", el("select", { id: "nodes" },
      el("option", { value: "" }, "automático: 1 se a > 0, senão 0"), el("option", { value: "0" }, "0"), el("option", { value: "1" }, "1"))));
  showTex();
}
$("#exp-one").addEventListener("change", formOne);
$("#exp-two").addEventListener("change", formTwo);

$$("#tabs button").forEach((b) => b.addEventListener("click", () => {
  $$("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
  $$(".pane").forEach((p) => p.classList.toggle("on", p.dataset.pane === b.dataset.tab));
}));

function jobOne() {
  const exp = $("#exp-one").value;
  const params = values($("#form-one"));
  if (exp === "tunnelling") return { fn: "tunnelling", V0: params.V0, L: params.L };
  const key = $("#pot").value;
  if (exp === "spectrum") return { fn: "spectrum", key, params, n_states: Math.min(8, Math.max(1, +$("#nstates").value | 0)), refine: $("#refine").checked };
  return { fn: "evolve", key, params, x0_packet: +$("#x0").value, k0: +$("#k0").value, sigma: +$("#sigma").value, t_max: +$("#tmax").value };
}
function jobTwo() {
  if ($("#exp-two").value === "helium") return { fn: "helium", name: $("#hepot").value, constant: $("#const").value };
  const a = $("#a").value.trim().toLowerCase();
  const job = { fn: "calibrate", name: $("#tpot").value, a: ["inf", "∞", "infinito"].includes(a) ? "inf" : +a, r0: +$("#r0").value };
  if ($("#nodes").value !== "") job.nodes = +$("#nodes").value;
  return job;
}

$$(".run").forEach((b) => b.addEventListener("click", async () => {
  const job = b.dataset.system === "one" ? jobOne() : jobTwo();
  $("#welcome").style.display = "none";
  const out = $("#result");
  out.replaceChildren(el("div", { class: "card progress" }, el("div", { class: "spinner" }), "Rodando no navegador… alguns segundos, mais na calibração."));
  $$(".run").forEach((x) => (x.disabled = true));
  try {
    const m = await call(job);
    out.replaceChildren(RENDER[m.data.kind](m.data, m.seconds));
  } catch (err) {
    out.replaceChildren(el("div", { class: "card" }, el("h2", {}, "Não rodou"), el("p", { class: "error" }, err.message)));
  } finally {
    $$(".run").forEach((x) => (x.disabled = false));
  }
}));

/* ------------------------------------------------------------------ results */
const head = (title, seconds) => el("div", { class: "result-head" }, el("h2", {}, title), el("span", { class: "meta" }, seconds.toFixed(1) + " s no navegador"));
const table = (cols, rows) => el("div", { class: "table-wrap" }, el("table", {},
  el("thead", {}, el("tr", {}, cols.map((c) => el("th", {}, c)))),
  el("tbody", {}, rows.map((r) => el("tr", {}, r.map((c) => (c && c.nodeType) ? el("td", {}, c) : el("td", {}, c)))))));
const falsify = (text) => el("div", { class: "card" }, el("h3", {}, "O que derrubaria este resultado"), el("p", { class: "falsify" }, text));
const paramText = (p) => Object.entries(p).map(([k, v]) => `${k} = ${fmt(v, 4)}`).join(", ");

const RENDER = {
  spectrum(d, s) {
    const n = d.E_fd.length;
    const rows = d.E_fd.map((e, i) => {
      const ex = d.E_exact[i], nu = d.E_numerov[i];
      const diff = (ex != null && nu != null) ? Math.abs(nu - ex) : (nu != null ? Math.abs(nu - e) : null);
      return [i, fmt(e, 10), fmt(nu, 12), fmt(ex, 12), sci(diff),
        el("span", { class: d.bound[i] ? "ok" : "muted" }, d.bound[i] ? "ligado" : "contínuo (caixa)")];
    });
    const hasExact = d.E_exact.some((v) => v != null);
    const dx = (d.domain[1] - d.domain[0]) / 4000;
    const notes = [];
    d.E_fd.forEach((e, i) => {
      const ex = d.E_exact[i], nu = d.E_numerov[i];
      if (ex != null && nu != null && Math.abs(nu - ex) > Math.abs(e - ex)) notes.push(i);
    });
    const E = d.E_fd;
    const gap = n > 1 ? (E[n - 1] - E[0]) / (n - 1) : 1;
    const amp = 0.4 * gap / Math.max(...d.psi.flat().map(Math.abs));
    const traces = [{ x: d.x, y: d.V, name: "V(x)", line: { color: "#93a3c0", width: 1.5 } }];
    d.psi.forEach((p, i) => {
      traces.push({ x: d.x, y: d.x.map(() => E[i]), showlegend: false, hoverinfo: "skip", line: { color: COLORS[i % 8], width: 0.8, dash: "dot" } });
      traces.push({ x: d.x, y: p.map((v) => E[i] + amp * v), name: `ψ${i}`, line: { color: COLORS[i % 8], width: 1.8 } });
    });
    // bottom of the well, unless it is a singularity (hydrogen): then stop below the ground state
    const lo = Math.max(Math.min(...d.V.filter(isFinite), E[0]) - 0.15 * gap, E[0] - 1.5 * gap);
    return el("div", {},
      el("div", { class: "card" }, head(`${d.name}: ${n} níveis`, s), tex(d.latex), d.exact_latex ? tex(d.exact_latex) : null,
        el("p", { class: "hint" }, paramText(d.params)),
        table(["n", "diferenças finitas", "Numerov (repositório)", hasExact ? "forma fechada" : "sem forma fechada",
          hasExact ? "|Numerov − fechada|" : "|Numerov − dif. finitas|", "estado"], rows),
        notes.length ? el("p", { class: "hint" }, `Nos níveis ${notes.join(", ")} o Numerov ficou atrás das diferenças finitas: a grade do navegador (dx = ${fmt(dx, 2)}) é grossa para este potencial. No Galileu local o passo é 0,002.`) : null),
      el("div", { class: "card" }, plot("Níveis e funções de onda (cada ψ desenhada na altura do seu nível)", traces,
        { yaxis: Object.assign(PLOT_LAYOUT().yaxis, { range: [lo, E[n - 1] + 0.9 * gap], title: "energia" }), xaxis: Object.assign(PLOT_LAYOUT().xaxis, { title: "x" }) })),
      falsify("Dois métodos independentes: diferenças finitas (erro proporcional a h²) e o Numerov do repositório (erro proporcional a h⁴). Se os dois discordarem mais do que o erro da grade, ou se o Numerov se afastar da forma fechada quando ela existe, há erro no código ou na grade. Um nível marcado “contínuo” está acima da borda do potencial: é estado da caixa de cálculo e muda se o domínio mudar."));
  },

  evolve(d, s) {
    const peak = Math.max(...d.rho.flat());
    const Vf = d.V.filter(isFinite);
    const vmax = Math.max(...Vf.map(Math.abs)) || 1;
    const Vs = d.V.map((v) => 0.8 * peak * v / vmax);
    const frames = d.rho.map((r, i) => ({ name: String(i), data: [{ y: r }] }));
    const steps = d.t.map((t, i) => ({ label: t.toFixed(2), method: "animate", args: [[String(i)], { mode: "immediate", frame: { duration: 0, redraw: false }, transition: { duration: 0 } }] }));
    const div = el("div", { class: "plot", style: "height:420px" });
    const layout = Object.assign(PLOT_LAYOUT(), {
      title: { text: "|ψ(x, t)|² e o potencial (em escala)", font: { size: 13 } },
      yaxis: Object.assign(PLOT_LAYOUT().yaxis, { range: [Math.min(0, ...Vs) - 0.05 * peak, 1.1 * peak] }),
      margin: { l: 58, r: 18, t: 36, b: 90 }, legend: { x: 1, xanchor: "right", y: 1, bgcolor: "rgba(0,0,0,0)" },
      updatemenus: [{ type: "buttons", showactive: false, x: 0, y: -0.28, xanchor: "left", buttons: [
        { label: "▶", method: "animate", args: [null, { frame: { duration: 40, redraw: false }, transition: { duration: 0 }, fromcurrent: true }] },
        { label: "❚❚", method: "animate", args: [[null], { mode: "immediate", frame: { duration: 0 } }] }] }],
      sliders: [{ steps, x: 0.1, len: 0.9, y: -0.2, currentvalue: { prefix: "t = ", font: { size: 12 } }, font: { size: 9 } }],
    });
    setTimeout(() => Plotly.newPlot(div, [
      { x: d.x, y: d.rho[0], name: "|ψ|²", fill: "tozeroy", line: { color: "#f2c14e", width: 1.6 } },
      { x: d.x, y: Vs, name: "V (escala)", line: { color: "#93a3c0", width: 1, dash: "dot" } }], layout, PLOT_CONFIG)
      .then(() => Plotly.addFrames(div, frames)));
    const drift = (a) => Math.max(...a) - Math.min(...a);
    const p0 = d.populations[0];
    let popDrift = 0;
    d.populations.forEach((p) => p.forEach((v, j) => (popDrift = Math.max(popDrift, Math.abs(v - p0[j])))));
    const captured = p0.reduce((a, b) => a + b, 0);
    return el("div", {},
      el("div", { class: "card" }, head(`Pacote de onda: ${d.name}`, s), tex(d.latex), el("p", { class: "hint" }, paramText(d.params)), div),
      el("div", { class: "card" }, el("h3", {}, "Conservação"), table(["grandeza", "variação máxima no tempo"], [
        ["norma ∫|ψ|² dx", sci(drift(d.norm))], ["energia ⟨H⟩", sci(drift(d.energy))],
        [`populações |cₙ|² nos ${p0.length} primeiros autoestados`, sci(popDrift)]]),
        el("p", { class: "hint" }, `Os ${p0.length} primeiros autoestados guardam ${(100 * captured).toFixed(1)}% do pacote${captured < 0.999 ? "; o resto está em estados mais altos" : ""}.`)),
      el("div", { class: "plots" },
        el("div", { class: "card" }, plot("Posição média ⟨x⟩(t)", [{ x: d.t, y: d.x_mean, line: { color: "#7aa7ff" }, name: "⟨x⟩" }])),
        el("div", { class: "card" }, plot("Espaço de Hilbert: |cₙ|² em t = 0", [{ x: d.E_basis, y: p0, type: "bar", marker: { color: "#f2c14e" }, name: "|cₙ|²", width: 0.6 * (d.E_basis[1] - d.E_basis[0]) }],
          { xaxis: Object.assign(PLOT_LAYOUT().xaxis, { title: "Eₙ" }) }))),
      falsify("Crank-Nicolson é unitário: a norma só pode mudar por arredondamento. Com hamiltoniano que não depende do tempo, a energia e cada população |cₙ|² também ficam constantes. Variação acima de uns 1e-10 em qualquer uma das três linhas da tabela indicaria erro na evolução."));
  },

  tunnelling(d, s) {
    const diff = d.T.map((t, i) => Math.abs(t - d.T_exact[i]));
    const maxDiff = Math.max(...diff);
    return el("div", {},
      el("div", { class: "card" }, head(`Tunelamento: V₀ = ${fmt(d.V0, 4)}, L = ${fmt(d.L, 4)}`, s),
        plot("Transmissão T(E)", [
          { x: d.E, y: d.T_exact, name: "forma fechada", line: { color: "#7aa7ff", width: 2 } },
          { x: d.E, y: d.T, name: "matriz de transferência (repositório)", mode: "markers", marker: { color: "#f2c14e", size: 4 } }],
          { xaxis: Object.assign(PLOT_LAYOUT().xaxis, { title: "E" }), yaxis: Object.assign(PLOT_LAYOUT().yaxis, { title: "T", range: [0, 1.05] }),
            shapes: [{ type: "line", x0: d.V0, x1: d.V0, y0: 0, y1: 1.05, line: { color: "#93a3c0", dash: "dot", width: 1 } }] }),
        el("p", { class: "hint" }, `Maior diferença entre os dois: ${sci(maxDiff)}. A linha pontilhada marca E = V₀.`)),
      falsify("A forma fechada da barreira quadrada é exata. A diferença que sobra vem da grade, que aqui tem passo 0,001 (no Galileu local, 0,0001). Se ela não caísse ao refinar a grade, ou se T passasse de 1, o método estaria errado."));
  },

  calibrate(d, s) {
    const t = d.target;
    const r0ok = Math.abs(d.r0 - t.r0) < 1e-6, nodesOk = d.nodes === t.nodes;
    const invA = d.a ? 1 / d.a : 0;
    const rows = [
      ["a", t.a == null ? "∞" : fmt(t.a), fmt(d.a, 10)],
      ["1/a", t.a == null ? "0" : fmt(1 / t.a), Math.abs(invA) < 1e-6 ? sci(invA) : fmt(invA)],
      ["r₀", fmt(t.r0), el("span", { class: r0ok ? "ok" : "bad" }, fmt(d.r0, 10))],
      ["estados ligados", t.nodes, el("span", { class: nodesOk ? "ok" : "bad" }, d.nodes)],
      [d.pnames[0], "", fmt(d.strength, 10)], [d.pnames[1], "", fmt(d.scale, 10)]];
    const bound = d.E_code != null ? el("div", { class: "card" }, el("h3", {}, "Estado ligado"), el("p", { class: "hint" }, "Energia em unidades de ħ²/m_r dividido pelo comprimento ao quadrado."),
      table(["cálculo", "energia"], [["Numerov (repositório)", fmt(d.E_code, 10)],
        ["alcance zero, −1/(2a²)", fmt(d.E_zero_range_code, 10)], ["alcance efetivo, −κ²/2 com κ = 1/a + r₀κ²/2", fmt(d.E_finite_range_code, 10)]])) : null;
    return el("div", {},
      el("div", { class: "card" }, head(`${d.name} calibrado`, s), tex(d.latex),
        table(["", "alvo", "obtido"], rows.map(([k, a, b]) => [k.includes("_") || k.includes("\\") ? tex(k, false) : k, a, b]))),
      bound,
      el("div", { class: "card" }, plot("u(r) a energia zero e a reta 1 − r/a", [
        { x: d.r, y: d.u, name: "u(r)", line: { color: "#f2c14e", width: 2 } },
        { x: d.r, y: d.line, name: "1 − r/a", line: { color: "#7aa7ff", dash: "dash" } },
        { x: d.r, y: d.V, name: "V(r)", yaxis: "y2", line: { color: "#93a3c0", width: 1 } }],
        { xaxis: Object.assign(PLOT_LAYOUT().xaxis, { title: "r" }), yaxis2: { overlaying: "y", side: "right", showgrid: false, title: "V", zerolinecolor: "#3a4d72" }, margin: { l: 58, r: 52, t: 36, b: 46 } })),
      falsify("O resultado só é aceito se r₀ bate com o alvo em 1e-6 e o número de estados ligados é o pedido: duas soluções podem ter o mesmo (a, r₀) com números de nós diferentes, e não são o mesmo estado físico. Conferência independente: nos três alvos da Tabela 2, os parâmetros têm de voltar aos publicados nas Tabelas 3 e 4 de Macêdo-Lima e Madeira, Revista Brasileira de Ensino de Física 45, e20230079 (2023)."));
  },

  helium(d, s) {
    const p = d.published;
    const rel = (x, y) => (x == null ? "—" : sci(Math.abs(x - y) / Math.abs(y)));
    return el("div", {},
      el("div", { class: "card" }, head(`Dímero de hélio-4: ${d.name}`, s),
        table(["", "calculado aqui", "Motovilov et al. (2001), Tabela I", "diferença relativa"], [
          ["a (Å)", fmt(d.a, 8), p.a, rel(d.a, p.a)],
          ["E (mK)", fmt(d.E_mK, 8), p.E_mK, rel(d.E_mK, p.E_mK)],
          ["r₀ (Å)", fmt(d.r0, 8), "—", ""],
          ["estados ligados", d.nodes, "1", ""]]),
        el("p", { class: "hint" }, `ħ²/2m_r = ${d.h2_2mu} K·Å². Referência: Motovilov et al., European Physical Journal D 13, 33 (2001), como citada no README do repositório.`)),
      el("div", { class: "card" }, plot("u(r) a energia zero e a reta 1 − r/a", [
        { x: d.r, y: d.u, name: "u(r)", line: { color: "#f2c14e", width: 2 } },
        { x: d.r, y: d.line, name: "1 − r/a", line: { color: "#7aa7ff", dash: "dash" } }],
        { xaxis: Object.assign(PLOT_LAYOUT().xaxis, { title: "r (Å)", type: "log" }) })),
      falsify("O potencial é medido e não tem parâmetro livre, então a e E são previsões. A comparação só vale com a mesma constante da tabela (12,12 K·Å²); perto da unitariedade a é muito sensível a ela, e com o valor CODATA o a muda na terceira casa. Uma diferença relativa acima de uns 1e-4 com a constante da tabela indicaria erro no potencial ou no solver."));
  },
};
