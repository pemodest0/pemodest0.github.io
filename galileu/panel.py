"""Galileu lab in the browser: thin glue over the research repository.

lab.py and schrodinger.py are fetched from github.com/pemodest0/Low-energy-scattering
at page load and imported as they are; nothing here re-implements them. What this
file adds is the same as the local Galileu: a second, independent method beside
every number (finite differences beside Numerov, closed forms where they exist),
and plain lists so the page can draw them.

Units: hbar = m = 1 for one body; the two-body solver carries the length unit of
its parameters (fm for the model potentials, angstrom for helium).
"""
import json
import math

import numpy as np
from scipy.linalg import eigh_tridiagonal, solve_banded

import lab
import schrodinger


def _sq(x):
    return np.asarray(x, dtype=float)


def _thin(*arrays, n=700):
    """Every k-th point so a plot carries at most ~n points."""
    k = max(1, len(arrays[0]) // n)
    return [np.asarray(a)[..., ::k] for a in arrays]


def _num(v):
    v = float(v)
    return v if math.isfinite(v) else None


def _list(a):
    return [_num(v) for v in np.ravel(a)]


# ----------------------------------------------------------------- one body
ONE_BODY = {
    "harmonic": dict(name="Oscilador harmônico", latex=r"V(x) = \tfrac12\,\omega^2 x^2",
                     params={"omega": (1.0, 0.1, 5.0)}, domain=(-10.0, 10.0),
                     exact=lambda n, omega: omega * (n + 0.5),
                     exact_latex=r"E_n = \omega\,(n+\tfrac12)",
                     V=lambda omega: (lambda x: 0.5 * omega ** 2 * _sq(x) ** 2)),
    "box": dict(name="Poço infinito (caixa)", latex=r"V = 0\ \text{em}\ 0<x<L,\ \infty\ \text{fora}",
                params={"L": (1.0, 0.2, 10.0)}, domain=None,
                exact=lambda n, L: (n + 1) ** 2 * math.pi ** 2 / (2 * L ** 2),
                exact_latex=r"E_n = \dfrac{(n+1)^2\pi^2}{2L^2}",
                V=lambda L: (lambda x: 0.0 * _sq(x))),
    "finite_well": dict(name="Poço quadrado finito", latex=r"V = -V_0\ \text{para}\ |x|<a,\ 0\ \text{fora}",
                        params={"V0": (10.0, 0.5, 50.0), "a": (1.0, 0.2, 4.0)}, domain=(-8.0, 8.0),
                        V=lambda V0, a: (lambda x: np.where(np.abs(_sq(x)) < a, -V0, 0.0))),
    "morse": dict(name="Morse (radial)", latex=r"V(r) = D\,(1-e^{-\alpha (r-r_e)})^2 - D",
                  params={"D": (10.0, 1.0, 40.0), "alpha": (1.0, 0.3, 3.0), "re": (2.0, 1.0, 5.0)},
                  domain=(0.0, 14.0), radial=True,
                  exact=lambda n, D, alpha, re: schrodinger.E_morse(n, D, alpha),
                  exact_latex=r"E_n = -D + \omega(n+\tfrac12) - \dfrac{\omega^2 (n+\tfrac12)^2}{4D},\ \omega=\alpha\sqrt{2D}",
                  V=lambda D, alpha, re: schrodinger.V_morse(D, alpha, re)),
    "poschl_teller": dict(name="Pöschl-Teller",
                          latex=r"V(x) = -\dfrac{\alpha^2\lambda(\lambda+1)}{2}\,\mathrm{sech}^2(\alpha x)",
                          params={"lam": (4.0, 0.5, 10.0), "alpha": (1.0, 0.3, 3.0)}, domain=(-12.0, 12.0),
                          exact=lambda n, lam, alpha: -0.5 * alpha ** 2 * (lam - n) ** 2 if n < lam else float("nan"),
                          exact_latex=r"E_n = -\dfrac{\alpha^2(\lambda-n)^2}{2},\ n<\lambda",
                          V=lambda lam, alpha: (lambda x: -0.5 * alpha ** 2 * lam * (lam + 1)
                                                / np.cosh(alpha * _sq(x)) ** 2)),
    "gaussian": dict(name="Poço gaussiano", latex=r"V(x) = -V_0\, e^{-x^2/2\sigma^2}",
                     params={"V0": (8.0, 0.5, 40.0), "sigma": (1.0, 0.2, 4.0)}, domain=(-10.0, 10.0),
                     V=lambda V0, sigma: (lambda x: -V0 * np.exp(-_sq(x) ** 2 / (2 * sigma ** 2)))),
    "double_well": dict(name="Poço duplo", latex=r"V(x) = b\,(x^2 - c^2)^2",
                        params={"b": (1.0, 0.1, 5.0), "c": (1.5, 0.5, 3.0)}, domain=(-5.0, 5.0),
                        V=lambda b, c: (lambda x: b * (_sq(x) ** 2 - c ** 2) ** 2)),
    "hydrogen": dict(name="Hidrogênio (radial)", latex=r"V(r) = -\dfrac{1}{r} + \dfrac{\ell(\ell+1)}{2r^2}",
                     params={"l": (0.0, 0.0, 4.0)}, domain=(0.0, 80.0), radial=True,
                     exact=lambda n, l: schrodinger.E_hydrogen(n + 1 + int(round(l))),
                     exact_latex=r"E_n = -\dfrac{1}{2(n+\ell+1)^2}",
                     V=lambda l: schrodinger.V_hydrogen(int(round(l)))),
    "barrier": dict(name="Barreira quadrada", latex=r"V = V_0\ \text{para}\ 0<x<L",
                    params={"V0": (5.0, 0.5, 20.0), "L": (1.0, 0.2, 4.0)}, domain=(-30.0, 30.0),
                    V=lambda V0, L: schrodinger.V_barrier(V0, L)),
}


def _build(key, params):
    spec = ONE_BODY[key]
    full = {k: float(params.get(k, d[0])) for k, d in spec["params"].items()}
    domain = (0.0, full["L"]) if key == "box" else spec["domain"]
    return spec["V"](**full), spec, full, domain


def _fd(V, x0, x1, n_states, n_points):
    """Finite differences: the Hamiltonian on a grid, u = 0 at both ends. Error O(h^2)."""
    x = np.linspace(x0, x1, n_points + 2)[1:-1]
    h = x[1] - x[0]
    diag = 1.0 / h ** 2 + V(x)
    off = -0.5 / h ** 2 * np.ones(len(x) - 1)
    E, psi = eigh_tridiagonal(diag, off, select="i", select_range=(0, n_states - 1))
    psi = psi / math.sqrt(h)
    for j in range(psi.shape[1]):              # sign: first lobe positive
        i = np.argmax(np.abs(psi[:, j]) > 1e-3 * np.max(np.abs(psi[:, j])))
        if psi[i, j] < 0:
            psi[:, j] *= -1
    return x, h, E, psi


def spectrum(key, params, n_states=5, refine=True):
    """Eigenvalues by finite differences and by Numerov shooting (schrodinger.eigenvalue)."""
    V, spec, full, (x0, x1) = _build(key, params)
    n_states = int(n_states)
    x, h, E_fd, psi = _fd(V, x0, x1, n_states + 1, 4000)
    E_num = [None] * n_states
    if refine:
        Vmin = float(np.nanmin(V(x)))
        Emax = E_fd[-1] + 0.5 * (E_fd[-1] - E_fd[-2])
        dx = (x1 - x0) / 4000                  # browser budget; error is O(dx^4)
        for n in range(n_states):
            try:
                E_num[n] = schrodinger.eigenvalue(V, n, x0, x1, Vmin, Emax, dx=dx)
            except Exception:
                E_num[n] = None
    exact = [None] * n_states
    if spec.get("exact"):
        exact = [_num(spec["exact"](n, **full)) for n in range(n_states)]
    E_fd, psi = E_fd[:n_states], psi[:, :n_states]
    Vx = V(x)
    edge = Vx[-1] if spec.get("radial") else min(Vx[0], Vx[-1])
    bound = [bool(e < edge) or key == "box" for e in E_fd]
    xt, Vt, pt = _thin(x, Vx, psi.T)
    return {"kind": "spectrum", "name": spec["name"], "latex": spec["latex"],
            "exact_latex": spec.get("exact_latex", ""), "params": full, "domain": [x0, x1],
            "x": _list(xt), "V": _list(Vt), "psi": [_list(p) for p in pt],
            "E_fd": _list(E_fd), "E_numerov": [_num(e) if e is not None else None for e in E_num],
            "E_exact": exact, "bound": bound}


def evolve(key, params, x0_packet=-3.0, k0=2.0, sigma=0.5, t_max=10.0, n_frames=120):
    """Gaussian packet under Crank-Nicolson (unitary to round-off), populations on the eigenbasis."""
    V, spec, full, (a, b) = _build(key, params)
    n_points = 1200
    x = np.linspace(a, b, n_points + 2)[1:-1]
    h = x[1] - x[0]
    Vx = V(x)
    psi = (2 * math.pi * sigma ** 2) ** -0.25 * np.exp(-(x - x0_packet) ** 2 / (4 * sigma ** 2) + 1j * k0 * x)
    psi /= math.sqrt(np.sum(np.abs(psi) ** 2) * h)
    steps = max(1, int(math.ceil(t_max / n_frames / 0.005)))
    dt = t_max / (n_frames * steps)
    off = -0.5 / h ** 2
    dia = 1.0 / h ** 2 + Vx
    A = np.zeros((3, n_points), dtype=complex)
    A[0, 1:] = 0.5j * dt * off
    A[1, :] = 1 + 0.5j * dt * dia
    A[2, :-1] = 0.5j * dt * off

    def apply_B(p):
        q = (1 - 0.5j * dt * dia) * p
        q[1:] += -0.5j * dt * off * p[:-1]
        q[:-1] += -0.5j * dt * off * p[1:]
        return q

    def energy(p):
        Hp = dia * p
        Hp[1:] += off * p[:-1]
        Hp[:-1] += off * p[1:]
        return float(np.real(np.vdot(p, Hp)) * h)

    _, _, E_b, phi = _fd(V, a, b, 150, n_points)   # enough states to hold a moving packet
    rho, t, norms, energies, xmean, pops = [], [], [], [], [], []
    for f in range(n_frames + 1):
        r = np.abs(psi) ** 2
        rho.append(r)
        t.append(f * steps * dt)
        norms.append(float(np.sum(r) * h))
        energies.append(energy(psi))
        xmean.append(float(np.sum(x * r) * h))
        pops.append(np.abs(phi.T @ psi * h) ** 2)
        if f == n_frames:
            break
        for _ in range(steps):
            psi = solve_banded((1, 1), A, apply_B(psi))
    k = max(1, n_points // 500)
    return {"kind": "evolve", "name": spec["name"], "latex": spec["latex"], "params": full,
            "x": _list(x[::k]), "V": _list(Vx[::k]), "t": t,
            "rho": [_list(r[::k]) for r in rho], "norm": norms, "energy": energies,
            "x_mean": xmean, "populations": [_list(p) for p in pops], "E_basis": _list(E_b),
            "dt": dt}


def tunnelling(V0=5.0, L=1.0, n=150):
    """T(E) for the square barrier: repository transfer matrix against the closed form."""
    V0, L = float(V0), float(L)
    E = np.linspace(3 * V0 / n, 3 * V0, int(n))
    V = schrodinger.V_barrier(V0, L)
    T_num = [schrodinger.transmission(V, e, -0.5, L + 0.5, dx=1e-3) for e in E]
    T_exact = [schrodinger.T_barrier_exact(e, V0, L) for e in E]
    return {"kind": "tunnelling", "V0": V0, "L": L, "E": _list(E), "T": _list(T_num),
            "T_exact": _list(T_exact)}


# ----------------------------------------------------------------- two bodies
TWO_BODY = {
    "well": {"name": "Poço quadrado", "latex": r"V(r) = -v\mu^2\ \ (r<1/\mu)", "p": ["v", r"\mu"]},
    "mpt": {"name": "Pöschl-Teller", "latex": r"V(r) = -\dfrac{v\mu^2}{\cosh^2(\mu r)}", "p": ["v", r"\mu"]},
    "gauss": {"name": "Gaussiano", "latex": r"V(r) = -v\mu^2\, e^{-\mu^2 r^2}", "p": ["v", r"\mu"]},
    "lj": {"name": "Lennard-Jones",
           "latex": r"V(r) = \tfrac12\left(\dfrac{C_{12}}{r^{12}} - \dfrac{C_6}{r^6}\right)",
           "p": ["C_6", "C_{12}"]},
}
HELIUM = {"hfdhe2": ("HFD-HE2 (Aziz 1979)", lab.AzizHFDHE2), "hfdb": ("HFD-B (Aziz 1987)", lab.AzizHFDB),
          "lm2m2": ("LM2M2 (Aziz e Slaman 1991)", lab.AzizLM2M2),
          "tty": ("Tang-Toennies-Yiu (1995)", lab.TangToenniesYiu)}
# Motovilov et al., Eur. Phys. J. D 13, 33 (2001), Table I, as quoted in the repository README.
HELIUM_PUBLISHED = {"hfdhe2": {"a": 124.65, "E_mK": -0.83012}, "hfdb": {"a": 88.50, "E_mK": -1.68541},
                    "lm2m2": {"a": 100.23, "E_mK": -1.30348}, "tty": {"a": 100.01, "E_mK": -1.30962}}
# hbar^2/2m_r for He-4 + He-4. The table used 12.12 K.A^2; CODATA gives lab.H2_2MU_HE4.
H2_2MU = {"motovilov": 12.12, "codata": lab.H2_2MU_HE4}


def _scaled_guess(name, strength, scale, L):
    if name == "lj":
        return strength * L ** 4, scale * L ** 10
    return strength, scale / L


def _analyse(pot):
    a, r0, nodes = lab.scattering(pot)
    r, u, x, h, slope, r_start = lab.numerov(pot, 0.0)
    u = u * (1.0 - pot.R / a) / u[-1]
    out = {"a": _num(a), "r0": _num(r0), "nodes": int(nodes), "R": pot.R, "E_code": None}
    if a > 0 and nodes >= 1:
        disc = 1.0 - 2.0 * r0 / a
        kappa = (1.0 - math.sqrt(disc)) / r0 if disc > 0 and r0 > 0 else 1.0 / a
        try:
            out["E_code"] = lab.bound_energy(pot, -0.5 * kappa ** 2)
            out["E_zero_range_code"] = -0.5 / a ** 2
            out["E_finite_range_code"] = -0.5 * kappa ** 2
        except Exception:
            out["E_code"] = None
    rt, ut, Vt = _thin(r, u, pot.V(r))
    out.update({"r": _list(rt), "u": _list(ut), "V": _list(Vt), "line": _list(1.0 - rt / a)})
    return out


def calibrate(name, a, r0, nodes=None):
    """Parameters that reproduce (a, r0), starting from the published solutions rescaled to r0."""
    a = math.inf if a in (None, "inf") else float(a)
    r0 = float(r0)
    if nodes is None:
        nodes = 1 if (a > 0 and math.isfinite(a)) else 0
    ratio = r0 / a if math.isfinite(a) else 0.0
    starts = []
    for target_name, t in lab.TARGETS.items():
        pub = lab.PUBLISHED.get((target_name, name))
        if pub is None:
            continue
        t_ratio = t["r0"] / t["a"] if math.isfinite(t["a"]) else 0.0
        starts.append((abs(t_ratio - ratio), _scaled_guess(name, pub["p1"], pub["p2"], r0 / pub["r0_pub"])))
    starts.append((9.0, _scaled_guess(name, *lab.GUESS[name], r0 / 1.7)))
    starts.sort(key=lambda s: s[0])
    errors = []
    for _, (s0, c0) in starts:
        try:
            s, c, a_out, r0_out, n_out, ok = lab.tune(name, a, r0, s0, c0, nodes_target=nodes)
        except Exception as exc:
            errors.append(str(exc))
            continue
        if ok:
            res = _analyse(lab.POTENTIALS[name](s, c))
            res.update({"kind": "calibrate", "name": TWO_BODY[name]["name"], "latex": TWO_BODY[name]["latex"],
                        "pnames": TWO_BODY[name]["p"], "strength": s, "scale": c,
                        "target": {"a": _num(a), "r0": r0, "nodes": nodes}})
            return res
        errors.append(f"convergiu para nós={n_out}, r0={r0_out:.6g}")
    raise RuntimeError("A calibração não convergiu de nenhum ponto de partida: " + "; ".join(errors[-3:]))


def helium(name, constant="motovilov"):
    """A measured helium potential: no free parameter, so a and E are predictions."""
    label, cls = HELIUM[name]
    h2 = H2_2MU[constant]
    res = _analyse(cls(h2))
    res.update({"kind": "helium", "name": label, "constant": constant, "h2_2mu": h2,
                "E_mK": None if res["E_code"] is None else 2.0 * h2 * res["E_code"] * 1e3,
                "published": HELIUM_PUBLISHED[name]})
    return res


def catalogue():
    one = {k: {"name": s["name"], "latex": s["latex"], "params": s["params"],
               "exact": bool(s.get("exact"))} for k, s in ONE_BODY.items()}
    return {"one": one, "two": TWO_BODY, "helium": {k: v[0] for k, v in HELIUM.items()},
            "targets": {k: {"a": _num(t["a"]), "r0": t["r0"], "nodes": t["nodes"]} for k, t in lab.TARGETS.items()}}


def run(job_json):
    job = json.loads(job_json)
    fn = {"spectrum": spectrum, "evolve": evolve, "tunnelling": tunnelling,
          "calibrate": calibrate, "helium": helium, "catalogue": catalogue}[job.pop("fn")]
    return json.dumps(fn(**job), allow_nan=False)
