#!/usr/bin/env python3
"""Render the business plan from one Markdown source and one JSON model."""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/business-plan.md"
MODEL = Path(__file__).with_name("business-plan-model.json")
TARGET = ROOT / "docs/business-plan.html"
STYLE_SOURCE = ROOT / "docs/business-plan.html"


def cad(value: float) -> str:
    return f"{value:,.0f} $".replace(",", " ")


def pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def table(headers, rows, cls="data"):
    out = [f'<div class="table-scroll"><table class="{cls}"><thead><tr>']
    out += [f"<th>{html.escape(str(h))}</th>" for h in headers]
    out.append("</tr></thead><tbody>")
    for row in rows:
        out.append("<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>")
    out.append("</tbody></table></div>")
    return "\n".join(out)


def model_blocks(model):
    catalogue = model["catalogue"]
    tiers = [
        ["Standard", "15+", "1.0×", cad(0)],
        ["Rapide / Fast", "8–14", "1.8–2.2×", cad(149)],
        ["Prioritaire / Priority", "2–7", "2.7–3.3×", cad(299)],
        ["Urgence / Urgent", "1", "3.3–3.7×", cad(449)],
        ["Extrême / Extreme", "0", "3.7–4.3×", cad(549)],
    ]
    catalogue_html = table(
        ["Service", "Starting professional fee", "Nota standard service fee"],
        [[html.escape(r["name"]), cad(r["base"]), cad(r["nota"])] for r in catalogue],
    )
    tier_html = table(["Tier", "Days to signing", "Suggested notary multiplier", "Nota date fee"], tiers)
    m = model["market"]
    market_html = table(
        ["Planning case", "Acts", "Value"],
        [
            ["Financing", f'{m["financingActs"]:,}', cad(m["financingActs"] * model["catalogue"][1]["nota"])],
            ["Refinancing", f'{m["refinancingActs"]:,}', cad(m["refinancingActs"] * model["catalogue"][0]["nota"])],
            ["Starting-fee professional volume", "110,000", cad(m["startingHonoraires"])],
            ["Nota fee ceiling at standard fees", "110,000", cad(m["baseFeeOpportunity"])],
            ["Nota fee ceiling with assumed date mix", "110,000", cad(m["withAssumedDateMix"])],
        ],
    )
    b = model["baseline"]
    unit_html = table(
        ["Blended completed act", "CAD"],
        [
            ["Notary professional fee passed through", cad(b["honoraires"])],
            ["Nota revenue", cad(b["nota"])],
            ["Card processing", f'−{cad(b["card"])}'],
            ["Connect payout/account allocation", f'−{cad(b["payout"] + 2)}'],
            ["Payment contribution before service/loss", cad(b["paymentBeforeAccount"] - 2)],
        ],
    )
    annual_rows = []
    for i, y in enumerate(model["years"], 1):
        annual_rows.append([
            f"Y{i}", f'{y["completed"]:,}', cad(y["revenue"]), f'−{cad(y["card"] + y["payout"] + y["account"])}',
            f'−{cad(y["service"] + y["losses"])}', cad(y["contribution"]), f'−{cad(y["operating"])}', cad(y["operatingResult"]),
        ])
    annual_html = table(
        ["Year", "Completed acts", "Nota revenue", "Payment costs", "Service + losses", "Contribution", "Operating budget", "Operating result"],
        annual_rows,
    )
    cash_rows = [[str(r["month"]), f'{r["completed"]:,}', cad(r["opening"]), cad(r["contribution"]), f'−{cad(r["operatingBudget"])}', cad(r["closing"])] for r in model["months"]]
    cash_html = table(["Month", "Completed acts", "Opening cash", "Contribution", "Operating budget", "Closing cash"], cash_rows)
    scenario_rows = [[s["name"], cad(s["capitalWithReserve"]), cad(s["extraBeyondRaise"])] for s in model["scenarios"]]
    scenarios_html = table(["Scenario", "Capital incl. reserve", "Beyond proposed raise"], scenario_rows)
    return {
        "catalogue": catalogue_html,
        "tiers": tier_html,
        "market": market_html,
        "unit": unit_html,
        "annual": annual_html,
        "cash": cash_html,
        "scenarios": scenarios_html,
    }


SECTION_MOTIONS = [
    "thesis", "market", "catalogue", "evidence", "competition", "growth",
    "economics", "operations", "roadmap", "governance", "milestones",
    "cash", "capital", "risk", "sources",
]

FOCUS_SUMMARIES = {
    1: ("Thesis", "Capacity infrastructure · not a replacement for notaries"),
    2: ("Problem", "Deadline demand · fragmented supply · clearer next step"),
    3: ("Product", "4 coded services · date signal · notary validation"),
    4: ("Proof", "Readiness evidence stays separate from commercial traction"),
    5: ("Market", "Québec first · 110 000 financing acts remains a planning hypothesis"),
    6: ("Liquidity", "Supply first · qualified demand · measured cohorts"),
    7: ("Launch gates", "Professional review · tax map · payment controls"),
    8: ("Model", "Agreed honoraires stay with the notary · Nota fee stays separate"),
    9: ("Operations", "Reliable fulfilment · recovery paths · service quality"),
    10: ("Roadmap", "Up to 80% repeatable preparation target · notary review · signing gate"),
    11: ("Milestones", "30 recruited · 25 verified · 244 Year 1 completions targeted"),
    12: ("Capital", "250 000 $ proposed envelope · modelled scenarios"),
    13: ("Team", "Notary advisor · Québec counsel · documented operating cover"),
    14: ("Risks", "Legal · cash · quality · owner decisions"),
    15: ("Sources", "Assumptions, evidence and document control"),
}


def sectionize(rendered):
    """Turn Markdown h2 chapters into independently animated, linkable panels."""
    chunks = re.split(r"(?=<h2>)", rendered)
    intro = chunks[0]
    sections = []
    for index, chunk in enumerate(chunks[1:], 1):
        heading = re.match(r"<h2>(.*?)</h2>", chunk, flags=re.S)
        if not heading:
            intro += chunk
            continue
        title = re.sub(r"<[^>]+>", "", heading.group(1))
        number = re.match(r"\s*(\d+)", html.unescape(title))
        number = int(number.group(1)) if number else index
        motion = SECTION_MOTIONS[(number - 1) % len(SECTION_MOTIONS)]
        section_id = f"section-{number:02d}"
        signal = (
            f'<div class="section-signal signal--{motion}" aria-hidden="true">'
            '<i></i><i></i><i></i></div>'
        )
        focus_label, focus_text = FOCUS_SUMMARIES.get(number, ("Essential", "Key decision points and evidence"))
        focus = (
            '<div class="focus-summary" role="note">'
            f'<span>{html.escape(focus_label)}</span><strong>{html.escape(focus_text)}</strong>'
            '</div>'
        )
        sections.append(
            f'<section id="{section_id}" class="plan-section motion-{motion}" '
            f'data-section="{number}" data-motion="{motion}">'
            f'<div class="section-rail"><span class="section-count">{number:02d}</span>{signal}</div>'
            f'<div class="section-content">{chunk.replace("</h2>", "</h2>" + focus, 1)}</div></section>'
        )
    return intro + "\n".join(sections)


def clean_public_copy(rendered):
    """Apply production typography to the shareable plan surface."""
    # Keep the Markdown source readable while avoiding editorial separators in
    # the customer-facing page. Ranges remain explicit in plain language.
    rendered = rendered.replace(" — ", " ").replace(" – ", " to ")
    rendered = rendered.replace(";", ",")
    return rendered


def experience_console():
    """Compact decision console that gives each audience a clear outcome lens."""
    return """
<div class="experience-console" id="decision-console">
  <div class="console-intro">
    <span class="eyebrow">The decision surface</span>
    <h2>One market. Three durable wins.</h2>
    <p class="lede">Nota turns a deadline into a coordinated outcome: a client gets clarity, a notary gets qualified capacity, and the company earns a transparent fee for making the match work.</p>
  </div>
  <div class="lens-switch" role="tablist" aria-label="View the plan through each stakeholder's outcome">
    <button type="button" role="tab" aria-selected="true" data-lens="investor">Investor</button>
    <button type="button" role="tab" aria-selected="false" data-lens="notary">Notary</button>
    <button type="button" role="tab" aria-selected="false" data-lens="client">Customer</button>
  </div>
  <button type="button" class="focus-toggle" data-plan-focus aria-pressed="true">Show full detail</button>
  <div class="lens-panel" data-lens-panel="investor" role="tabpanel">
    <strong>Investor lens</strong><span>Evidence-led liquidity, contribution after costs, and disciplined gates before expansion.</span>
  </div>
  <div class="lens-panel" data-lens-panel="notary" role="tabpanel" hidden>
    <strong>Notary lens</strong><span>Capacity infrastructure that keeps the notary's judgment and agreed fee in full, turns open time into qualified acts and removes repetitive preparation loops.</span>
  </div>
  <div class="lens-panel" data-lens-panel="client" role="tabpanel" hidden>
    <strong>Customer lens</strong><span>A clear total, a suitable professional, and a visible next step before a deadline becomes a crisis.</span>
  </div>
  <div class="console-metrics" aria-label="Plan signals">
    <div><b>244</b><span>targeted Year 1 completions</span></div>
    <div><b>80 813 $</b><span>modeled Nota revenue</span></div>
    <div><b>30</b><span>recruited notaries in the first cohort</span></div>
    <div><b>3×</b><span>value created by one reliable match</span></div>
  </div>
  <div class="learning-loop" aria-label="Learning loop for simple notarial acts">
    <div class="learning-loop-heading"><span class="eyebrow">Trust loop</span><strong>Simple acts get clearer with every reviewed cycle.</strong></div>
    <div class="learning-loop-track">
      <div class="learning-node user"><b>User</b><span>questions and flow</span></div>
      <i aria-hidden="true">→</i>
      <div class="learning-node model"><b>Model</b><span>guided preparation</span></div>
      <i aria-hidden="true">→</i>
      <div class="learning-node notary"><b>Notary</b><span>accept · correct · reject</span></div>
      <i aria-hidden="true">→</i>
      <div class="learning-node version"><b>Next version</b><span>held-out and reversible</span></div>
    </div>
    <p class="learning-loop-note">Usage signals tune guidance only. Notary review qualifies model changes. A notary may collaborate under a separate potential-equity agreement or choose a monthly subscription without direct feedback.</p>
  </div>
  <nav class="chapter-nav" aria-label="Plan chapters">
    <a href="#section-01" data-nav-section="1">Thesis</a>
    <a href="#section-02" data-nav-section="2">Market</a>
    <a href="#section-03" data-nav-section="3">Product</a>
    <a href="#section-04" data-nav-section="4">Proof</a>
    <a href="#section-06" data-nav-section="6">Growth</a>
    <a href="#section-12" data-nav-section="12">Capital</a>
    <a href="#section-14" data-nav-section="14">Risks</a>
  </nav>
  <div class="chapter-controls" role="group" aria-label="Chapter navigation">
    <button type="button" data-plan-prev disabled>Previous</button>
    <span data-plan-progress aria-live="polite">Chapter 1 of 15</span>
    <button type="button" data-plan-next>Next</button>
  </div>
</div>
"""


def language_switch():
    """Persistent language control for the English plan and French summary."""
    return """
<div class="language-bar" role="group" aria-label="Language / Langue">
  <a class="deck-link" href="/pitch-deck.html">Pitch deck</a>
  <span>Language / Langue</span>
  <button type="button" data-plan-focus aria-pressed="true">Show full detail</button>
  <button type="button" data-plan-motion aria-pressed="false">Pause animation</button>
  <button type="button" data-plan-lang="en" aria-pressed="true">English</button>
  <button type="button" data-plan-lang="fr" aria-pressed="false">Français</button>
</div>
"""


def brand_lockup():
    """Render the production Nota Québec mark inline so the plan is self-contained."""
    return """
<div class="plan-brand" aria-label="Nota Québec">
  <svg class="plan-brand-mark" viewBox="0 0 64 64" role="img" aria-label="Nota mark">
    <rect width="64" height="64" rx="6" fill="#264961" />
    <g fill="#ffffff">
      <rect x="16" y="15" width="7.5" height="34" rx="2.5" />
      <rect x="40.5" y="15" width="7.5" height="34" rx="2.5" />
      <polygon points="16,15 24,15 48,49 40,49" />
    </g>
    <circle cx="48" cy="16" r="8" fill="#407598" stroke="#264961" stroke-width="3" />
  </svg>
  <span class="plan-brand-word">OTA</span>
  <span class="plan-brand-region">QUÉBEC</span>
</div>
"""


def experience_script():
    return """
<script>
(() => {
  document.documentElement.classList.add('js-motion');
  const languageButtons = [...document.querySelectorAll('[data-plan-lang]')];
  const focusButtons = [...document.querySelectorAll('[data-plan-focus]')];
  const motionButtons = [...document.querySelectorAll('[data-plan-motion]')];
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const englishPlan = document.querySelector('#plan-en');
  const frenchPlan = document.querySelector('#plan-fr');
  const updateMotionButtons = () => {
    const forced = motionQuery.matches;
    const paused = document.body.classList.contains('motion-paused') || forced;
    const french = document.documentElement.lang === 'fr-CA';
    motionButtons.forEach((button) => {
      button.setAttribute('aria-pressed', paused ? 'true' : 'false');
      button.textContent = forced
        ? (french ? 'Animation désactivée' : 'Animation disabled')
        : (paused ? (french ? 'Reprendre l’animation' : 'Resume animation') : (french ? 'Mettre l’animation en pause' : 'Pause animation'));
      button.disabled = forced;
    });
  };
  const setLanguage = (language) => {
    const lang = language === 'fr' ? 'fr' : 'en';
    document.documentElement.lang = lang === 'fr' ? 'fr-CA' : 'en-CA';
    if (englishPlan) englishPlan.hidden = lang !== 'en';
    if (frenchPlan) frenchPlan.hidden = lang !== 'fr';
    languageButtons.forEach((button) => button.setAttribute('aria-pressed', button.dataset.planLang === lang ? 'true' : 'false'));
    focusButtons.forEach((button) => { button.textContent = lang === 'fr' ? 'Voir le détail complet' : 'Show full detail'; });
    updateMotionButtons();
    try { localStorage.setItem('nota.plan.lang', lang); } catch (error) { /* storage can be unavailable in privacy mode */ }
  };
  languageButtons.forEach((button) => button.addEventListener('click', () => setLanguage(button.dataset.planLang)));
  let savedLanguage = 'en';
  try { savedLanguage = localStorage.getItem('nota.plan.lang') || 'en'; } catch (error) { /* use English when storage is unavailable */ }
  const queryLanguage = new URLSearchParams(window.location.search).get('lang');
  setLanguage(queryLanguage || savedLanguage);

  const setFocus = (enabled, persist = true) => {
    document.body.classList.toggle('focus-view', enabled);
    focusButtons.forEach((button) => {
      button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      button.textContent = enabled
        ? (document.documentElement.lang === 'fr-CA' ? 'Voir le détail complet' : 'Show full detail')
        : (document.documentElement.lang === 'fr-CA' ? 'Vue essentielle' : 'Essential view');
    });
    if (persist) { try { localStorage.setItem('nota.plan.focus', enabled ? '1' : '0'); } catch (error) { /* storage can be unavailable */ } }
  };
  focusButtons.forEach((button) => button.addEventListener('click', () => setFocus(document.body.classList.contains('focus-view') === false)));
  let savedFocus = '1';
  try { savedFocus = localStorage.getItem('nota.plan.focus') || '1'; } catch (error) { /* keep the essential view */ }
  setFocus(savedFocus !== '0', false);

  const setMotion = (paused, persist = true) => {
    const effective = paused || motionQuery.matches;
    document.body.classList.toggle('motion-paused', effective);
    updateMotionButtons();
    if (persist && !motionQuery.matches) {
      try { localStorage.setItem('nota.plan.motion', paused ? '1' : '0'); } catch (error) { /* storage can be unavailable */ }
    }
  };
  motionButtons.forEach((button) => button.addEventListener('click', () => setMotion(!document.body.classList.contains('motion-paused'))));
  let savedMotion = '0';
  try { savedMotion = localStorage.getItem('nota.plan.motion') || '0'; } catch (error) { /* keep motion on when storage is unavailable */ }
  setMotion(savedMotion === '1', false);
  const syncMotionPreference = () => setMotion(savedMotion === '1', false);
  if (motionQuery.addEventListener) motionQuery.addEventListener('change', syncMotionPreference);
  else if (motionQuery.addListener) motionQuery.addListener(syncMotionPreference);

  const buttons = [...document.querySelectorAll('[data-lens]')];
  const panels = [...document.querySelectorAll('[data-lens-panel]')];
  const setLens = (lens) => {
    buttons.forEach((button) => {
      const selected = button.dataset.lens === lens;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.lensPanel !== lens; });
  };
  buttons.forEach((button) => button.addEventListener('click', () => setLens(button.dataset.lens)));

  const chapters = [...document.querySelectorAll('.plan-section')];
  const navLinks = [...document.querySelectorAll('[data-nav-section]')];
  const previousButton = document.querySelector('[data-plan-prev]');
  const nextButton = document.querySelector('[data-plan-next]');
  const progress = document.querySelector('[data-plan-progress]');
  const reducedMotion = motionQuery.matches;
  let currentChapter = 1;
  const updateChapterControls = (number) => {
    currentChapter = Math.max(1, Math.min(chapters.length || 1, number));
    if (progress) progress.textContent = `Chapter ${currentChapter} of ${chapters.length}`;
    if (previousButton) previousButton.disabled = currentChapter <= 1;
    if (nextButton) nextButton.disabled = currentChapter >= chapters.length;
  };
  const goToChapter = (number, push = true) => {
    const chapter = chapters[number - 1];
    if (!chapter) return;
    updateChapterControls(number);
    if (push) history.pushState(null, '', `#${chapter.id}`);
    chapter.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  };
  if (previousButton) previousButton.addEventListener('click', () => goToChapter(currentChapter - 1));
  if (nextButton) nextButton.addEventListener('click', () => goToChapter(currentChapter + 1));
  const chapterFromHash = () => {
    const match = window.location.hash.match(/^#section-([0-9]{2})$/);
    return match ? Number(match[1]) : null;
  };
  const syncChapterFromHash = () => {
    const number = chapterFromHash();
    updateChapterControls(number || 1);
  };
  window.addEventListener('hashchange', syncChapterFromHash);
  window.addEventListener('popstate', syncChapterFromHash);
  syncChapterFromHash();
  const reveal = (entry) => { if (entry.isIntersecting) entry.target.classList.add('is-visible'); };
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => entries.forEach(reveal), { threshold: .12, rootMargin: '0px 0px -8% 0px' });
    chapters.forEach((chapter) => observer.observe(chapter));
    const spy = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      updateChapterControls(Number(entry.target.dataset.section));
      navLinks.forEach((link) => link.toggleAttribute('aria-current', link.dataset.navSection === entry.target.dataset.section));
    }), { rootMargin: '-18% 0px -70% 0px', threshold: 0 });
    chapters.forEach((chapter) => spy.observe(chapter));
  } else chapters.forEach((chapter) => chapter.classList.add('is-visible'));
})();
</script>
"""


def main():
    source = SOURCE.read_text()
    # Keep document versioning in the Markdown/model for internal control, but
    # omit release stamps from the public production surface.
    source = re.sub(r"^Version \*\*1\.6\*\* · Reviewed \*\*[^\n]+\*\* · CAD throughout\n*", "", source, flags=re.M)
    model = json.loads(MODEL.read_text())
    blocks = model_blocks(model)
    for name, value in blocks.items():
        source = source.replace(f"<!-- MODEL:{name} -->\n<!-- /MODEL:{name} -->", value)
    if "<!-- MODEL:" in source:
        raise SystemExit("unrendered model placeholder")
    rendered = markdown.markdown(source, extensions=["tables", "fenced_code"])
    # The shareable hostname contains only the plan and its generated planning
    # artifacts. Keep external sources and those artifacts linked, but do not
    # ship dead repository-relative links to private working documents.
    rendered = re.sub(
        r'<a href="(?!https?://|#|plan-affaires-sommaire\.md|planning/)[^"]+">(.*?)</a>',
        r'\1', rendered, flags=re.S,
    )
    rendered = clean_public_copy(rendered)
    rendered = sectionize(rendered)
    console = experience_console()
    first_chapter = rendered.find('<section id="section-01"')
    if first_chapter >= 0:
        rendered = rendered[:first_chapter] + console + rendered[first_chapter:]
    rendered = f'<div id="plan-en">{rendered}</div>'

    french_source = (ROOT / "docs/plan-affaires-sommaire.md").read_text()
    french_source = re.sub(r"^Version \*\*1\.6\*\* · revue du \*\*[^\n]+\*\* · CAD\n*", "", french_source, flags=re.M)
    french_rendered = markdown.markdown(french_source, extensions=["tables", "fenced_code"])
    french_rendered = clean_public_copy(french_rendered)
    french_rendered = re.sub(
        r'<a href="(?!https?://|#|plan-affaires-sommaire\.md|planning/)[^"]+">(.*?)</a>',
        r'\1', french_rendered, flags=re.S,
    )
    french_rendered = '<div class="french-summary">' + french_rendered + '</div>'
    rendered = language_switch() + brand_lockup() + rendered + f'<div id="plan-fr" hidden>{french_rendered}</div>' + experience_script()

    old = STYLE_SOURCE.read_text() if STYLE_SOURCE.exists() else ""
    style_match = re.search(r"<style>.*?</style>", old, flags=re.S)
    base_style = style_match.group(0) if style_match else "<style>body{font-family:system-ui}</style>"
    extra = """<style>
:root{
  color-scheme:dark;
  --paper:#101820;--surface:#0f2030;--surface-2:#132b3f;
  --ink:#f4f8fa;--ink-2:#e5eef3;--muted:#afc2cf;--faint:#78a9bf;
  --rule:#294353;--rule-strong:#3f5f70;
  --brass:#386888;--brass-bright:#78a9bf;--brass-wash:#132b3f;
  --verdigris:#78a9bf;--verdigris-wash:#132b3f;
  --danger:#f97066;--oxide:var(--danger);--oxide-wash:#3b2329;
  --shadow:0 1px 2px rgba(0,0,0,.28),0 18px 48px -24px rgba(0,0,0,.62);
  --nota-orange-600:#b45309;--nota-orange-400:#f79009;--accent-warm:var(--nota-orange-400)
}
main{max-width:1140px;margin:0 auto;padding:3rem 28px 6rem;background:var(--surface)}
main>h1{margin:0 0 1.2rem}
main>h2{border-top:1px solid var(--rule);padding-top:2.6rem;margin-top:3.6rem}
main>h3{margin-top:2.2rem}
main p,main ul,main ol,main pre,main blockquote{max-width:76ch}
main a{overflow-wrap:anywhere}
.table-scroll{overflow-x:auto;margin:1.25rem 0 1.8rem}
table{border-collapse:collapse;width:100%;font-size:.9rem;line-height:1.35;background:var(--surface)}
th,td{border-bottom:1px solid var(--rule);padding:.7rem .65rem;text-align:left;vertical-align:top}
th{font-weight:650;color:var(--ink-2);background:var(--surface-2)}
tr:last-child td{border-bottom:0}
pre{overflow:auto;background:var(--surface-2);padding:1rem;border-radius:5px}
blockquote{border-left:3px solid var(--brass);margin:1.5rem 0;padding:.25rem 1rem;color:var(--ink-2)}
code{overflow-wrap:anywhere}
@media(max-width:700px){main{padding:2rem 16px 4rem}table{font-size:.82rem}}

/* ── Interactive decision surface ───────────────────────── */
html{scroll-behavior:smooth}
body{background:linear-gradient(135deg,var(--paper),var(--surface-2) 42%,var(--paper));}
main{position:relative;overflow:hidden}
main::before{content:"";position:absolute;inset:0 0 auto;height:22rem;pointer-events:none;background:radial-gradient(circle at 8% 12%,color-mix(in srgb,var(--brass) 15%,transparent),transparent 42%),radial-gradient(circle at 92% 4%,color-mix(in srgb,var(--accent-warm) 10%,transparent),transparent 38%)}
main>h1,main>p{position:relative}
.experience-console{position:relative;margin:3rem 0 4.5rem;padding:1.5rem;border:1px solid color-mix(in srgb,var(--brass) 28%,var(--rule));border-radius:14px;background:color-mix(in srgb,var(--surface) 92%,transparent);box-shadow:0 24px 60px -36px color-mix(in srgb,var(--brass) 45%,transparent);overflow:hidden}
.language-bar{position:sticky;top:12px;z-index:10;display:flex;justify-content:flex-end;align-items:center;gap:.35rem;margin:0 0 1rem;padding:.4rem .55rem;border:1px solid var(--rule);border-radius:999px;background:color-mix(in srgb,var(--surface) 94%,transparent);box-shadow:0 8px 24px -18px color-mix(in srgb,var(--ink) 40%,transparent);font:600 .68rem var(--mono);letter-spacing:.04em;color:var(--muted)}
.language-bar .deck-link{margin-right:auto;color:var(--brass);text-decoration:none;padding:.35rem .6rem;border-radius:999px}.language-bar .deck-link:hover{background:var(--brass-wash)}
.language-bar button{appearance:none;border:1px solid transparent;background:transparent;color:var(--muted);padding:.35rem .6rem;border-radius:999px;font:600 .68rem var(--mono);cursor:pointer;transition:all .2s ease}
.language-bar [data-plan-focus]{margin-left:auto;border-color:var(--rule);color:var(--ink-2)}
.language-bar button:hover,.language-bar button[aria-pressed=true]{border-color:var(--brass);background:var(--brass);color:var(--surface)}
.plan-brand{display:flex;align-items:center;gap:.78rem;margin:0 0 1.4rem;color:var(--ink)}
.plan-brand-mark{width:clamp(3rem,7vw,4.6rem);height:clamp(3rem,7vw,4.6rem);display:block;flex:none}
.plan-brand-word{font:var(--weight-display) clamp(3rem,7vw,4.6rem)/.9 var(--display);letter-spacing:-.08em}
.plan-brand-region{align-self:center;margin-left:.12rem;padding:.42em .7em .36em;border-radius:999px;background:var(--brass-wash);color:var(--brass);font:750 clamp(.65rem,1.2vw,.85rem)/1 var(--body);letter-spacing:.12em}
.french-summary{max-width:76ch}.french-summary h1{margin:0 0 1rem}.french-summary h2{border-top:1px solid var(--rule);padding-top:2rem;margin-top:2.8rem}.french-summary li{margin:.4rem 0}
.experience-console::after{content:"";position:absolute;width:18rem;height:18rem;right:-7rem;top:-8rem;border:1px solid color-mix(in srgb,var(--brass) 30%,transparent);border-radius:50%;box-shadow:0 0 0 1.2rem color-mix(in srgb,var(--brass) 7%,transparent),0 0 0 2.4rem color-mix(in srgb,var(--brass) 4%,transparent);animation:signalOrbit 18s linear infinite;pointer-events:none}
.console-intro{max-width:62ch}.console-intro h2{margin:.2rem 0 .7rem}
.lens-switch{display:flex;gap:.45rem;flex-wrap:wrap;margin:1.4rem 0 .9rem;position:relative;z-index:1}
.lens-switch button{appearance:none;border:1px solid var(--rule);background:var(--surface);color:var(--muted);padding:.5rem .8rem;border-radius:999px;font:600 .78rem var(--body);cursor:pointer;transition:all .2s ease}
.lens-switch button:hover,.lens-switch button[aria-selected=true]{border-color:var(--brass);color:var(--surface);background:var(--brass);transform:translateY(-1px)}
.lens-panel{display:flex;gap:.8rem;align-items:baseline;max-width:72ch;padding:.8rem 1rem;border-left:3px solid var(--brass);background:var(--brass-wash);animation:lensIn .35s ease both}.lens-panel[hidden]{display:none}.lens-panel strong{font-family:var(--mono);font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--brass);white-space:nowrap}.lens-panel span{color:var(--ink-2)}
.console-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin:1.5rem 0 1.2rem;background:var(--rule);border:1px solid var(--rule);border-radius:9px;overflow:hidden;position:relative;z-index:1}.console-metrics div{display:grid;gap:.25rem;padding:1rem;background:var(--surface)}.console-metrics b{font:var(--weight-display) clamp(1.35rem,3vw,2rem) var(--display);color:var(--brass);letter-spacing:-.02em}.console-metrics span{font-size:.76rem;line-height:1.35;color:var(--muted)}
.learning-loop{position:relative;z-index:1;margin:1.35rem 0 1.2rem;padding:1.15rem 1.2rem 1rem;border:1px solid color-mix(in srgb,var(--blue,var(--brass)) 32%,var(--rule));border-radius:10px;background:linear-gradient(120deg,color-mix(in srgb,var(--surface-2) 88%,transparent),color-mix(in srgb,var(--surface) 92%,transparent));overflow:hidden}.learning-loop::before{content:"";position:absolute;inset:auto 4% 1.05rem;height:1px;background:repeating-linear-gradient(90deg,var(--brass) 0 10px,transparent 10px 18px);opacity:.6;animation:loopTravel 5s linear infinite}.learning-loop-heading{display:flex;align-items:baseline;gap:.7rem;margin-bottom:1rem}.learning-loop-heading strong{font-size:1rem;color:var(--ink-2)}.learning-loop-track{display:grid;grid-template-columns:1fr auto 1fr auto 1fr auto 1fr;align-items:center;gap:.6rem;position:relative;z-index:1}.learning-node{display:grid;gap:.25rem;min-height:4.1rem;padding:.75rem .8rem;border:1px solid var(--rule);border-radius:9px;background:var(--surface);box-shadow:0 8px 20px -18px var(--ink)}.learning-node b{font:700 .82rem var(--mono);letter-spacing:.07em;text-transform:uppercase}.learning-node span{font-size:.75rem;color:var(--muted);line-height:1.3}.learning-node.user b,.learning-node.version b{color:var(--brass-bright)}.learning-node.model b{color:var(--accent-warm)}.learning-node.notary b{color:var(--verdigris)}.learning-loop-track>i{font-style:normal;font-size:1.35rem;color:var(--brass);animation:arrowPulse 1.8s ease-in-out infinite}.learning-loop-track>i:nth-of-type(2){animation-delay:.25s}.learning-loop-track>i:nth-of-type(3){animation-delay:.5s}.learning-loop-note{margin:.85rem 0 0;max-width:none;font-size:.78rem;line-height:1.45;color:var(--ink-2)}
.chapter-nav{display:flex;gap:.25rem;flex-wrap:wrap;position:relative;z-index:1}.chapter-nav a{padding:.35rem .55rem;border-radius:4px;text-decoration:none;color:var(--muted);font:600 .7rem var(--mono);letter-spacing:.04em;transition:color .2s,background .2s}.chapter-nav a:hover,.chapter-nav a[aria-current]{color:var(--brass);background:var(--brass-wash)}
.chapter-controls{display:flex;align-items:center;gap:.7rem;margin-top:1.15rem;position:relative;z-index:1}.chapter-controls button{appearance:none;border:1px solid var(--rule);background:var(--surface);color:var(--ink-2);padding:.45rem .7rem;border-radius:6px;font:600 .72rem var(--body);cursor:pointer;transition:all .2s ease}.chapter-controls button:hover:not(:disabled){border-color:var(--brass);color:var(--brass);transform:translateY(-1px)}.chapter-controls button:disabled{opacity:.42;cursor:not-allowed}.chapter-controls span{font:600 .68rem var(--mono);letter-spacing:.05em;color:var(--muted)}
.focus-toggle{appearance:none;border:1px solid var(--brass);background:var(--brass-wash);color:var(--brass);padding:.55rem .75rem;border-radius:7px;font:650 .75rem var(--body);cursor:pointer;transition:all .2s ease;position:relative;z-index:1}.focus-toggle:hover{background:var(--brass);color:var(--surface);transform:translateY(-1px)}
/* ── Chapter motion system: every chapter gets its own visual metaphor ── */
.plan-section{display:grid;grid-template-columns:3.2rem minmax(0,1fr);gap:1.2rem;margin:0 0 4.6rem;scroll-margin-top:1.2rem;opacity:1;transform:none}.js-motion .plan-section{opacity:0;transform:translateY(18px);transition:opacity .65s ease,transform .65s cubic-bezier(.2,.8,.2,1)}.js-motion .plan-section.is-visible{opacity:1;transform:none}.section-rail{padding-top:2.65rem;display:flex;flex-direction:column;align-items:center;gap:1rem}.section-count{font:600 .72rem var(--mono);color:var(--faint);letter-spacing:.06em}.section-content>h2{border-top:0;padding-top:0;margin-top:0}.section-signal{width:2.25rem;height:2.25rem;position:relative;color:var(--accent-warm)}.section-signal i{position:absolute;display:block;border:1px solid currentColor}.signal--thesis i:nth-child(1){inset:2px;border-radius:50%;animation:pulse 2.8s ease-in-out infinite}.signal--thesis i:nth-child(2){inset:8px;transform:rotate(45deg);animation:pulse 2.8s .35s ease-in-out infinite}.signal--thesis i:nth-child(3){inset:14px;background:currentColor;border:0;border-radius:50%}.signal--market i:nth-child(1){inset:2px;border-radius:50%;border-style:dashed;animation:spin 8s linear infinite}.signal--market i:nth-child(2){inset:8px;border-radius:50%}.signal--market i:nth-child(3){width:5px;height:5px;left:16px;top:16px;background:currentColor;border:0;border-radius:50%}.signal--catalogue i{height:4px;left:3px;right:3px;background:currentColor;border:0;animation:barRise 1.8s ease-in-out infinite}.signal--catalogue i:nth-child(1){top:5px;width:55%}.signal--catalogue i:nth-child(2){top:12px;width:78%;animation-delay:.2s}.signal--catalogue i:nth-child(3){top:19px;width:38%;animation-delay:.4s}.signal--evidence i:nth-child(1){inset:2px;border-radius:4px}.signal--evidence i:nth-child(2){left:5px;right:5px;top:11px;height:1px;background:currentColor;border:0;animation:scan 2.2s ease-in-out infinite}.signal--evidence i:nth-child(3){left:8px;right:8px;bottom:6px;height:1px;background:currentColor;border:0}.signal--competition i:nth-child(1){left:2px;top:4px;width:12px;height:18px;transform:skewY(-22deg)}.signal--competition i:nth-child(2){right:2px;top:4px;width:12px;height:18px;transform:skewY(22deg)}.signal--competition i:nth-child(3){left:10px;right:10px;bottom:3px;height:1px;background:currentColor;border:0}.signal--growth i:nth-child(1){left:3px;bottom:4px;width:17px;height:12px;border-width:0 0 1px 1px}.signal--growth i:nth-child(2){left:8px;top:8px;width:13px;height:13px;border-width:1px 1px 0 0;transform:rotate(-45deg);animation:arrow 1.8s ease-in-out infinite}.signal--growth i:nth-child(3){left:5px;right:5px;top:17px;border-width:0 0 1px 0}.signal--economics i:nth-child(1),.signal--economics i:nth-child(2),.signal--economics i:nth-child(3){bottom:3px;width:5px;background:currentColor;border:0;transform-origin:bottom;animation:barGrow 2s ease-in-out infinite}.signal--economics i:nth-child(1){left:3px;height:10px}.signal--economics i:nth-child(2){left:10px;height:18px;animation-delay:.2s}.signal--economics i:nth-child(3){left:17px;height:14px;animation-delay:.4s}.signal--operations i:nth-child(1){inset:3px;border-radius:50%;border-style:dashed;animation:spin 12s linear infinite}.signal--operations i:nth-child(2){inset:9px;border-radius:50%}.signal--operations i:nth-child(3){inset:14px;border-radius:50%;background:currentColor;border:0}.signal--roadmap i:nth-child(1){left:2px;right:2px;top:15px;border-width:1px 0 0;border-style:dashed;transform:rotate(-22deg)}.signal--roadmap i:nth-child(2){left:4px;top:8px;width:5px;height:5px;border-radius:50%;background:currentColor;border:0}.signal--roadmap i:nth-child(3){right:4px;bottom:6px;width:5px;height:5px;border-radius:50%;background:currentColor;border:0}.signal--governance i:nth-child(1){inset:3px;border-radius:50%;animation:pulse 3s ease-in-out infinite}.signal--governance i:nth-child(2){left:4px;top:4px;width:5px;height:5px;border-radius:50%;background:currentColor;border:0;box-shadow:14px 0 0 currentColor,7px 14px 0 currentColor}.signal--governance i:nth-child(3){left:7px;right:7px;top:10px;height:1px;background:currentColor;border:0;transform:rotate(30deg)}.signal--milestones i:nth-child(1){left:2px;right:2px;top:15px;height:1px;background:currentColor;border:0}.signal--milestones i:nth-child(2),.signal--milestones i:nth-child(3){width:6px;height:6px;border-radius:50%;background:var(--surface);border:2px solid currentColor;top:12px}.signal--milestones i:nth-child(2){left:3px}.signal--milestones i:nth-child(3){right:3px}.signal--cash i:nth-child(1){inset:3px;border-radius:4px}.signal--cash i:nth-child(2){left:7px;right:7px;top:12px;height:1px;background:currentColor;border:0}.signal--cash i:nth-child(3){left:11px;top:8px;width:5px;height:5px;border-radius:50%;background:currentColor;border:0;animation:pulse 2s ease-in-out infinite}.signal--capital i:nth-child(1){inset:3px;border-radius:50%;border-style:dashed;animation:spin 10s linear infinite}.signal--capital i:nth-child(2){left:7px;right:7px;top:11px;height:1px;background:currentColor;border:0;transform:rotate(45deg)}.signal--capital i:nth-child(3){left:7px;right:7px;top:11px;height:1px;background:currentColor;border:0;transform:rotate(-45deg)}.signal--risk i:nth-child(1){left:5px;top:3px;width:14px;height:18px;border-radius:9px 9px 4px 4px;transform:rotate(45deg)}.signal--risk i:nth-child(2){left:11px;top:9px;width:2px;height:8px;background:currentColor;border:0}.signal--risk i:nth-child(3){left:11px;top:19px;width:2px;height:2px;background:currentColor;border:0;border-radius:50%}.signal--sources i:nth-child(1){inset:3px;border-radius:3px}.signal--sources i:nth-child(2){left:7px;right:7px;top:10px;height:1px;background:currentColor;border:0;box-shadow:0 5px 0 currentColor}.signal--sources i:nth-child(3){left:7px;top:8px;width:4px;height:4px;border-radius:50%;background:currentColor;border:0}
.focus-summary{display:flex;align-items:baseline;gap:.8rem;margin:0 0 1.2rem;padding:.78rem 1rem;border-left:3px solid var(--brass);border-radius:0 7px 7px 0;background:var(--brass-wash);color:var(--ink-2)}.focus-summary span{font:650 .67rem var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--brass);white-space:nowrap}.focus-summary strong{font-size:.97rem;font-weight:650;color:var(--ink)}
.plan-brand-mark{width:clamp(2.7rem,6vw,3.8rem);height:clamp(2.7rem,6vw,3.8rem)}.plan-brand-word{font-size:clamp(2.5rem,6vw,3.8rem);line-height:.95;letter-spacing:-.06em}.plan-brand-region{font-size:clamp(.58rem,1vw,.75rem)}
.mast .name{font-size:clamp(2.5rem,6vw,4.5rem);line-height:.98}
.js-motion .plan-section:not(.is-visible){transform:translateY(12px)!important;filter:none!important}
.motion-paused .experience-console::after,.motion-paused .section-signal *,.motion-paused .learning-loop-track>i,.motion-paused .learning-loop::before,.motion-paused .lens-panel{animation-play-state:paused!important}
.language-bar button:disabled{cursor:not-allowed;opacity:.62}
.js-motion .plan-section{transition:opacity .65s ease,transform .65s cubic-bezier(.2,.8,.2,1),filter .65s ease}.js-motion .plan-section:not(.is-visible).motion-thesis{transform:scale(.94);filter:saturate(.6)}.js-motion .plan-section:not(.is-visible).motion-market{transform:translateX(-24px)}.js-motion .plan-section:not(.is-visible).motion-catalogue{transform:translateY(20px) scale(.96)}.js-motion .plan-section:not(.is-visible).motion-evidence{transform:rotate(-.8deg) scale(.98);filter:blur(2px)}.js-motion .plan-section:not(.is-visible).motion-competition{transform:translateX(24px)}.js-motion .plan-section:not(.is-visible).motion-growth{transform:translateY(26px) rotate(.6deg)}.js-motion .plan-section:not(.is-visible).motion-economics{transform:scaleY(.9);transform-origin:50% 100%}.js-motion .plan-section:not(.is-visible).motion-operations{transform:scale(.95) rotate(1.2deg)}.js-motion .plan-section:not(.is-visible).motion-roadmap{transform:translate(-16px,14px)}.js-motion .plan-section:not(.is-visible).motion-governance{transform:scale(.97);filter:blur(3px)}.js-motion .plan-section:not(.is-visible).motion-milestones{transform:translateY(18px) scale(.97)}.js-motion .plan-section:not(.is-visible).motion-cash{transform:translate(18px,10px)}.js-motion .plan-section:not(.is-visible).motion-capital{transform:scale(.92) rotate(-1deg)}.js-motion .plan-section:not(.is-visible).motion-risk{transform:translateY(-18px)}.js-motion .plan-section:not(.is-visible).motion-sources{transform:scale(.98);filter:saturate(.65)}.js-motion .plan-section.is-visible{filter:none}
.focus-view #plan-en .plan-section .section-content> :not(h2):not(.focus-summary){display:none}.focus-view #plan-en .plan-section{margin-bottom:2.2rem}.focus-view #plan-en .section-content>h2{margin-bottom:.65rem}
@keyframes signalOrbit{to{transform:rotate(360deg)}}@keyframes lensIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}@keyframes pulse{0%,100%{transform:scale(.85);opacity:.55}50%{transform:scale(1.05);opacity:1}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes scan{0%,100%{transform:translateY(-6px);opacity:.35}50%{transform:translateY(7px);opacity:1}}@keyframes barRise{0%,100%{transform:scaleX(.55);transform-origin:left;opacity:.5}50%{transform:scaleX(1);opacity:1}}@keyframes barGrow{0%,100%{transform:scaleY(.55);opacity:.55}50%{transform:scaleY(1);opacity:1}}@keyframes arrow{0%,100%{transform:translate(0,4px) rotate(-45deg);opacity:.5}50%{transform:translate(4px,0) rotate(-45deg);opacity:1}}@keyframes arrowPulse{0%,100%{opacity:.4;transform:translateX(-2px)}50%{opacity:1;transform:translateX(2px)}}@keyframes loopTravel{to{background-position:36px 0}}
@media(max-width:700px){.language-bar{justify-content:center;position:sticky;top:8px}.console-metrics{grid-template-columns:repeat(2,1fr)}.learning-loop-track{grid-template-columns:1fr;gap:.35rem}.learning-loop-track>i{justify-self:center;transform:rotate(90deg)}.learning-loop-track>i:nth-of-type(2){animation-delay:0}.learning-loop-track>i:nth-of-type(3){animation-delay:0}.lens-panel{display:block}.lens-panel strong{display:block;margin-bottom:.25rem}.plan-section{grid-template-columns:1fr;gap:.35rem;margin-bottom:3.4rem}.section-rail{padding-top:0;flex-direction:row;justify-content:flex-start;gap:.65rem}.section-signal{width:1.8rem;height:1.8rem;transform:scale(.82);transform-origin:left center}.chapter-controls{justify-content:space-between}.focus-summary{display:block}.focus-summary span{display:block;margin-bottom:.25rem}.language-bar [data-plan-focus]{margin-left:0}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.experience-console::after,.section-signal *, .learning-loop-track>i, .learning-loop::before{animation:none!important}.plan-section,.js-motion .plan-section{opacity:1;transform:none;transition:none}.lens-panel{animation:none}}
</style>"""
    TARGET.write_text("<!doctype html>\n<html lang=\"en-CA\"><head><meta charset=\"utf-8\" /><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" /><title>Nota Business Plan</title>\n"
        "<!-- Nota Business plan · Version: rendered by docs/planning/render-business-plan.py from docs/business-plan.md and docs/planning/business-plan-model.json -->\n"
        "<meta name=\"theme-color\" content=\"#101820\" />\n"
        "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\" />\n"
        "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin />\n"
        "<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sora:wght@700;800&display=swap\" />\n"
        + base_style + extra + "</head><body><main>\n" + rendered + "\n</main></body></html>\n")
    print(f"wrote {TARGET}")


if __name__ == "__main__":
    main()
