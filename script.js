/**
 * script.js - O Pálido Ponto Azul v4.0
 */

const LIGHT_SPEED_KM_S = 299792;
const UA_KM = 149597871;
const AL_KM = 9460730472580;

// Distância de início: 15M km no desktop, 4M km no smartphone
function startDistKm() {
    return window.innerWidth > 600 ? -15_000_000 : -4_000_000;
}

// Escala máxima do minimapa: inclui Éris com folga
const MINIMAP_MAX_KM = 11_000_000_000;

// ─── Dados carregados de data/ ────────────────────────────────────────────────
let celestialBodies  = [];
let solarZones       = [];
let planetData       = {};
let facts            = [];
let tourStops        = [];
let tourDesc         = {};
let journeyWaypoints = [];
let journeyEndData   = null;

async function loadData() {
    const [planetsJson, waypointsJson] = await Promise.all([
        fetch('data/planets.json').then(r => r.json()),
        fetch('data/waypoints.json').then(r => r.json()),
    ]);
    celestialBodies  = planetsJson.bodies;
    solarZones       = planetsJson.zones;
    planetData       = planetsJson.info;
    journeyWaypoints = waypointsJson.waypoints;
    journeyEndData   = waypointsJson.journey_end || null;
    preloadPhotos();
}

function preloadPhotos() {
    const toLoad = new Set();
    celestialBodies.forEach(body => {
        if (body.photo) toLoad.add(body.photo);
        body.moons.forEach(m => { if (m.photo) toLoad.add(m.photo); });
    });
    toLoad.forEach(filename => {
        const img = new Image();
        img.onload  = () => { loadedPhotos.add(filename); updateUniversePositions(); };
        img.onerror = () => {};
        img.src = `photos/${filename}`;
    });
}

// ─── Estado ──────────────────────────────────────────────────────────────────

let currentScale = 3000; // 1px = 3000 km inicial
let scrollPos    = 0;
let sensitivity  = 1;
let isLightSpeed = false;
let isLightspeedManual = false; // Scroll sem warp via botão manual

let measureActive = false;
let measureKmA    = null;
let measureKmB    = null;

// Tour guiado
let tourActive       = false;
let tourStepIdx      = -1;
let tourPauseTimeout = null;
let holdTimeout      = null;

// Tour transit (lightspeed phase before warp)
let tourTransitSpeedKmS = null;
let warpThresholdKm     = null;
let tourTransitNextIdx  = -1;
let tourTransitNextBody = null;
let tourTransitNextStop = null;

// Warp visual state
let isWarpVisual         = false;
let tourWaypointTimeouts = [];
let warpOffTimeout       = null;

// Lightspeed deceleration
let lightspeedDecelerating = false;
let lightspeedDecelStart   = null;
let lightspeedDecelSpeed   = 0;

// Overlay de mensagem central
let maneuverMsgTimeout   = null;
let lastShownWaypointIdx = -1;

// Callback ao término da animação programada
let animCallback = null;
let animEasing   = null; // null = usa easeInOutCubic padrão

// Estado da animação programada
let targetScale      = 3000;
let scaleStart       = 3000;
let scrollStart      = 0;
let focalDist        = 0;
let animStartTime    = null;
let isAnimating      = false;
let animDuration     = 2500;

// Cached star layer references (set in createStars)
let starLayers = [];

// Inércia e Gestos para toque
let touchVelocity    = 0;
let lastTouchX       = 0;
let lastTouchTime    = 0;
let inertiaFrame     = null;
let initialPinchDist = null;
let initialPinchScale = 1;

// Star layer scroll offsets for speed-based movement (px, accumulates)
let starScrollOffsets = [0, 0, 0];
let prevAnyLight  = false;
let prevStreaking  = false;

// Delta-time tracking for frame-rate-independent lightspeed
let prevFrameTime = null;

// ─── Cache e throttle de performance ─────────────────────────────────────────
let _prevTourActive     = false;          // guard classList.toggle no body
let _lastRulerScrollPos = null;           // throttle: só reconstrói régua quando ticks se movem
let _lastRulerScale     = null;
let _lastMinimapMs      = 0;             // throttle: minimap a ~15fps
let _lastNavMs          = 0;             // throttle: navArrows a ~5fps
let _lastInfoKm         = null;          // throttle: info display — só atualiza quando muda
let _lastInfoScale      = null;
let _lastSaturnSizePx   = 0;             // guard: anéis de Saturno só recalculam em zoom
let _infoDistEl = null, _infoUaEl = null, _infoAlEl = null, _infoLightEl = null;

// Successfully preloaded photo filenames
const loadedPhotos = new Set();

// Estado de arrasto
let isDragging       = false;
let dragStartX       = 0;
let dragStartScrollPos = 0;

// ─── Referências DOM ─────────────────────────────────────────────────────────

const universe    = document.getElementById('universe');
const rulerTicks  = document.getElementById('ruler-ticks');
const infoDisplay = document.getElementById('info-display');
const photon      = document.getElementById('photon');
const zoomOutBtn  = document.getElementById('zoom-out-btn');
const starFieldEl = document.getElementById('star-field');

// ─── Utilitários ─────────────────────────────────────────────────────────────

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function formatTime(sec) {
    if (sec < 60) return `${sec.toFixed(1)}s`;
    if (sec < 3600) {
        const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
        return `${m}m ${s}s`;
    }
    if (sec < 86400) {
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
        return `${h}h ${m}m`;
    }
    const YEAR = 365.25 * 86400;
    if (sec < YEAR) {
        const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
        return `${d}d ${h}h`;
    }
    return `${(sec / YEAR).toFixed(2)} anos`;
}

function formatMeasureDistance(km) {
    const au   = km / UA_KM;
    const ls   = km / LIGHT_SPEED_KM_S;

    const kmStr = km >= 1e9
        ? `${(km / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} bi km`
        : km >= 1e6
            ? `${(km / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} M km`
            : `${Math.round(km).toLocaleString('pt-BR')} km`;

    const auStr = au >= 0.001 ? `${au.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} UA` : null;

    let timeStr;
    if      (ls < 60)        timeStr = `${ls.toFixed(1)} s de luz`;
    else if (ls < 3600)      timeStr = `${(ls / 60).toFixed(1)} min de luz`;
    else if (ls < 86400)     timeStr = `${(ls / 3600).toFixed(1)} h de luz`;
    else if (ls < 31536000)  timeStr = `${(ls / 86400).toFixed(1)} dias de luz`;
    else                     timeStr = `${(ls / 31536000).toFixed(2)} anos-luz`;

    return { main: auStr || kmStr, sub1: auStr ? kmStr : '', sub2: timeStr };
}

function handleMeasurePoint(clientX) {
    const km = (clientX - window.innerWidth / 2) * currentScale + scrollPos * currentScale;
    if (measureKmA === null) {
        measureKmA = km;
    } else if (measureKmB === null) {
        measureKmB = km;
    } else {
        // Terceiro clique: reinicia com novo ponto A
        measureKmA = km;
        measureKmB = null;
    }
    updateMeasureOverlay();
}

function toggleMeasure() {
    measureActive = !measureActive;
    if (!measureActive) {
        measureKmA = null;
        measureKmB = null;
    }
    document.body.classList.toggle('measure-active', measureActive);
    const btn = document.getElementById('measure-btn');
    if (btn) btn.classList.toggle('active', measureActive);
    updateMeasureOverlay();
}

function updateMeasureOverlay() {
    const tickA  = document.getElementById('measure-tick-a');
    const dotA   = document.getElementById('measure-dot-a');
    const badgeA = document.getElementById('measure-badge-a');
    const tickB  = document.getElementById('measure-tick-b');
    const dotB   = document.getElementById('measure-dot-b');
    const badgeB = document.getElementById('measure-badge-b');
    const span   = document.getElementById('measure-span');
    const dist   = document.getElementById('measure-distance');
    const hint   = document.getElementById('measure-hint');
    if (!tickA) return;

    const visible = measureActive || measureKmA !== null;

    // Hint text
    if (hint) {
        if (!measureActive) {
            hint.style.display = 'none';
        } else if (measureKmA === null) {
            hint.textContent = 'Clique para marcar o ponto A';
            hint.style.display = 'block';
        } else if (measureKmB === null) {
            hint.textContent = 'Clique para marcar o ponto B';
            hint.style.display = 'block';
        } else {
            hint.textContent = 'Clique para nova medição';
            hint.style.display = 'block';
        }
    }

    // Posição vertical da régua: 42% do viewport
    const barY  = Math.round(window.innerHeight * 0.42);
    const dotY  = barY;
    const badgeOffset = 14;

    const showPoint = (tick, dot, badge, km) => {
        if (km === null) {
            tick.style.display = dot.style.display = badge.style.display = 'none';
            return;
        }
        const x = Math.round(screenX(km));
        tick.style.display  = 'block';
        tick.style.left     = x + 'px';
        dot.style.display   = 'block';
        dot.style.left      = x + 'px';
        dot.style.top       = (dotY - 4) + 'px';
        badge.style.display = 'block';
        badge.style.left    = x + 'px';
        badge.style.top     = (dotY + badgeOffset) + 'px';
    };

    showPoint(tickA, dotA, badgeA, measureKmA);
    showPoint(tickB, dotB, badgeB, measureKmB);

    if (measureKmA !== null && measureKmB !== null) {
        const xA   = screenX(measureKmA);
        const xB   = screenX(measureKmB);
        const left  = Math.min(xA, xB);
        const width = Math.abs(xB - xA);
        const midX  = left + width / 2;

        span.style.display = 'block';
        span.style.left    = left + 'px';
        span.style.width   = width + 'px';
        span.style.top     = barY + 'px';

        const fmt = formatMeasureDistance(Math.abs(measureKmB - measureKmA));
        document.getElementById('measure-dist-main').textContent = fmt.main;
        document.getElementById('measure-dist-km').textContent   = fmt.sub1;
        document.getElementById('measure-dist-time').textContent = fmt.sub2;
        dist.style.display = 'block';
        dist.style.left    = midX + 'px';
        dist.style.top     = (barY - 16) + 'px';
        dist.style.transform = 'translateX(-50%) translateY(-100%)';
    } else {
        span.style.display = dist.style.display = 'none';
    }

    if (!visible) {
        [tickA, dotA, badgeA, tickB, dotB, badgeB, span, dist].forEach(el => el.style.display = 'none');
    }
}

function formatKm(km) {
    if (km <= 0) return '0 km';
    if (km >= UA_KM * 10) return (km / AL_KM).toFixed(8) + ' AL';
    if (km >= UA_KM)      return (km / UA_KM).toFixed(2) + ' UA';
    if (km >= 1e6)        return (km / 1e6).toFixed(0) + 'M km';
    if (km >= 1e3)        return (km / 1e3).toFixed(0) + 'k km';
    return km.toFixed(0) + ' km';
}

// Escala sqrt para o minimapa: comprime o enorme intervalo de distâncias
function minimapScale(km, width) {
    if (km <= 0) return 0;
    const ratio = Math.sqrt(Math.min(km, MINIMAP_MAX_KM)) / Math.sqrt(MINIMAP_MAX_KM);
    return Math.min(ratio * width, width);
}

// Índice do corpo celeste mais próximo da posição atual
function getNearestBodyIndex() {
    const distKm = scrollPos * currentScale;
    let nearestIdx = 0;
    let nearestDelta = Infinity;
    celestialBodies.forEach((body, i) => {
        const delta = Math.abs(body.dist - distKm);
        if (delta < nearestDelta) { nearestDelta = delta; nearestIdx = i; }
    });
    return nearestIdx;
}

// Deslocamento vertical das luas a partir da eclíptica
// Pares acima/abaixo, com afastamento crescente a cada par
function moonVerticalOffset(idx) {
    const tier = Math.floor(idx / 2);
    const sign = (idx % 2 === 0) ? -1 : 1;
    return sign * (32 + tier * 24);
}

// ─── Inicialização ───────────────────────────────────────────────────────────

function init() {
    createStars();
    createUniverse();
    createMinimap();
    buildInfoDisplay();
    setupEvents();
    currentScale = 3000;
    scrollPos    = startDistKm() / currentScale; // start at welcome overlay position
    // Collapse minimap by default on small screens
    if (window.innerWidth <= 600 || (window.innerHeight <= 440 && window.innerWidth > window.innerHeight)) {
        const mc = document.getElementById('minimap-container');
        if (mc) mc.classList.add('collapsed');
    }
    updateUniversePositions();
    updateScroll();
    requestAnimationFrame(animate);
}

// ─── Campo de Estrelas ───────────────────────────────────────────────────────

function createStars() {
    const field = document.getElementById('star-field');
    if (!field) return;
    field.innerHTML = '';

    // 3 parallax layers: 0=near (big/fast), 1=mid, 2=far (small/slow)
    const layerConfig = [
        { minSize: 1.5, maxSize: 3.0, minTrail: 40, maxTrail: 90 },
        { minSize: 1.0, maxSize: 2.0, minTrail: 20, maxTrail: 55 },
        { minSize: 0.5, maxSize: 1.0, minTrail: 10, maxTrail: 28 },
    ];
    // Reduz estrelas em mobile ou CPUs de baixo desempenho
    const STAR_COUNT = (window.innerWidth <= 600 || (navigator.hardwareConcurrency || 4) <= 2) ? 70 : 130;
    layerConfig.forEach((cfg, l) => {
        const layer = document.createElement('div');
        layer.className = `star-layer-${l}`;
        layer.style.cssText = 'position:absolute;width:200%;height:100%;top:0;left:0;';
        for (let i = 0; i < STAR_COUNT; i++) {
            const star = document.createElement('div');
            star.className = 'star';
            const size = cfg.minSize + Math.random() * (cfg.maxSize - cfg.minSize);
            star.style.width  = size + 'px';
            star.style.height = size + 'px';
            star.style.top    = Math.random() * 100 + '%';
            star.style.left   = Math.random() * 200 + '%';
            star.style.setProperty('--pulse-duration', (Math.random() * 3 + 2) + 's');
            star.style.setProperty('--trail-len', (cfg.minTrail + Math.random() * (cfg.maxTrail - cfg.minTrail)).toFixed(1));
            layer.appendChild(star);
        }
        field.appendChild(layer);
    });
    // Cache for JS-driven parallax
    starLayers = [0, 1, 2].map(l => field.querySelector(`.star-layer-${l}`));
}

// ─── Criação do Universo ─────────────────────────────────────────────────────

function createUniverse() {
    universe.innerHTML = '';

    // 1. Cinturões — ficam atrás de tudo
    solarZones.forEach(zone => {
        const el = document.createElement('div');
        el.className = 'solar-zone';
        el.id = `zone-${zone.id}`;
        el.style.backgroundColor = zone.color;
        el.style.borderLeft  = `1px solid ${zone.border}`;
        el.style.borderRight = `1px solid ${zone.border}`;

        universe.appendChild(el);
    });

    // 2. Corpos celestes
    celestialBodies.forEach(body => {
        const container = document.createElement('div');
        container.className = 'celestial-container';
        container.id = `container-${body.id}`;

        const planet = document.createElement('div');
        planet.className = 'celestial-body';
        planet.id = `body-${body.id}`;
        planet.style.backgroundColor = body.color;
        planet.dataset.photo = body.photo || '';
        const handleBodyClick = (e) => {
            e.stopPropagation();
            const tgtScale = Math.max(5, body.size * 1000 / 300);
            if (window.innerWidth <= 600) {
                // Mobile: abre painel só após o zoom terminar para não sobrecarregar o frame
                startProgrammedAnim(body.dist, tgtScale, () => openPlanetDetail(body));
            } else {
                startProgrammedAnim(body.dist, tgtScale);
                openPlanetDetail(body);
            }
        };

        planet.onclick = handleBodyClick;

        if (body.id === 'saturn') {
            // Three-ring system with top-cover for realistic "behind planet" effect
            ['c', 'b', 'a'].forEach(type => {
                const ring = document.createElement('div');
                ring.className = 'planet-ring s-ring-' + type;
                ring.id = 'saturn-ring-' + type;
                planet.appendChild(ring);
            });
            const topCover = document.createElement('div');
            topCover.className = 'saturn-top-cover';
            topCover.id = 'saturn-top-cover';
            topCover.style.backgroundColor = body.color;
            planet.appendChild(topCover);
        } else if (body.rings) {
            const rings = document.createElement('div');
            rings.className = 'planet-rings';
            rings.style.borderColor = body.rings.color;
            planet.appendChild(rings);
        }

        const label = document.createElement('div');
        label.className = 'label';
        label.innerText = body.name;
        label.onclick = handleBodyClick;

        container.appendChild(planet);
        container.appendChild(label);

        // Mensagem especial para Plutão
        if (body.id === 'pluto') {
            const love = document.createElement('div');
            love.className = 'pluto-love';
            love.innerText = 'ainda te amamos ♥';
            container.appendChild(love);
        }

        universe.appendChild(container);
    });

    // Elemento "fim da jornada" — posicionado 1 M km após o último corpo
    const lastBody       = celestialBodies[celestialBodies.length - 1];
    const JOURNEY_END_KM = lastBody.dist + 1_000_000;
    const jed = journeyEndData || {
        title: 'Você pode parar por aqui',
        next_label: 'A próxima coisa visível é',
        next_name: 'Proxima Centauri',
        next_dist_label: '4,22 anos-luz · 39,9 trilhões de km'
    };
    const endEl = document.createElement('div');
    endEl.className = 'journey-end';
    endEl.id = 'journey-end';
    endEl.innerHTML = `
        <div class="journey-end-line"></div>
        <div class="journey-end-content">
            <div class="journey-end-title">${jed.title}</div>
            <div class="journey-end-next">${jed.next_label}</div>
            <div class="journey-end-star">${jed.next_name}</div>
            <div class="journey-end-dist">${jed.next_dist_label}</div>
        </div>
    `;
    endEl.dataset.distKm = JOURNEY_END_KM;
    universe.appendChild(endEl);

    // 3. Marcos de viagem — texto inline no espaço vazio
    const hintsHidden = localStorage.getItem('hideHints') === '1';
    journeyWaypoints.forEach((wp, i) => {
        const el = document.createElement('div');
        const isHelp = wp.type === 'help';
        el.className = 'journey-waypoint' + (isHelp ? ' help-waypoint' : '');
        el.id = `waypoint-${i}`;
        el.innerHTML = wp.title
            ? `<div class="wp-label">${wp.title}</div>` +
              (wp.dist   ? `<div class="wp-dist">${wp.dist}</div>` : '') +
              (wp.detail ? `<div class="wp-detail">${wp.detail}</div>` : '')
            : (wp.text || '');
        if (isHelp) {
            const btn = document.createElement('button');
            btn.className = 'wp-dismiss-btn';
            btn.textContent = 'Não mostrar dicas';
            btn.onclick = () => {
                localStorage.setItem('hideHints', '1');
                document.querySelectorAll('.help-waypoint').forEach(e => {
                    e.dataset.dismissed = '1';
                    e.style.display = 'none';
                });
            };
            el.appendChild(btn);
            if (hintsHidden) el.style.display = 'none';
        }
        el.dataset.distKm = wp.km;
        universe.appendChild(el);
    });

    // 4. Luas — adicionadas depois para ficarem acima dos planetas
    celestialBodies.forEach(body => {
        body.moons.forEach((moon, idx) => {
            const mc = document.createElement('div');
            mc.className = 'moon-container';
            mc.id = `container-${moon.id}`;

            // Zoom ao clicar na lua: centraliza no planeta pai em escala que
            // enquadra a órbita lunar em ~50% da meia-largura da tela.
            // Isso garante que a lua fique visível horizontalmente E que o
            // offset vertical (fixo em pixels) não a expulse do enquadramento.
            mc.onclick = () => {
                const halfW = window.innerWidth / 2;
                const targetS = Math.max(3, moon.dist / (halfW * 0.5));
                startProgrammedAnim(body.dist, targetS);
            };

            const dot = document.createElement('div');
            dot.className = 'moon-body';
            dot.id = `moon-${moon.id}`;
            dot.style.backgroundColor = moon.color;

            const lbl = document.createElement('div');
            lbl.className = 'moon-label';
            lbl.innerText = moon.name;

            mc.appendChild(dot);
            mc.appendChild(lbl);
            universe.appendChild(mc);

            mc.dataset.parentId = body.id;
            mc.dataset.moonIdx  = idx;
        });
    });

    // Reseta guard de tamanho de Saturno ao recriar o universo
    _lastSaturnSizePx = 0;
}

// ─── Atualização de Posições ─────────────────────────────────────────────────
//
// FIX: Os navegadores limitam valores CSS a ~33 milhões de px (2^25). Ao dar
// zoom profundo em Plutão (dist=5,9B km, scale=8), o valor bruto
// halfWidth + dist/scale chegaria a ~740M px — ultrapassando o limite e
// causando o "agrupamento" visual.
//
// Solução: posicionamento viewport-relativo. Em vez de mover o universo com
// translateX, cada elemento recebe um `left` calculado diretamente em pixels
// de tela. Elementos fora de tela recebem display:none para evitar valores
// CSS inválidos.

function screenX(distKm) {
    // Posição em pixels de tela dado uma distância em km do Sol
    return window.innerWidth / 2 + (distKm - scrollPos * currentScale) / currentScale;
}

function updateUniversePositions() {
    const hw      = window.innerWidth  / 2;
    const hh      = window.innerHeight / 2;
    const vw      = window.innerWidth;
    const vh      = window.innerHeight;
    const MARGIN  = 1500; // px de margem fora da tela antes de ocultar

    // Zonas (cinturões) — clampadas para nunca exceder limites CSS
    solarZones.forEach(zone => {
        const el = document.getElementById(`zone-${zone.id}`);
        if (!el) return;
        const sx1 = screenX(zone.innerKm);
        const sx2 = screenX(zone.outerKm);
        const cl  = Math.max(-2, sx1);
        const cr  = Math.min(vw + 2, sx2);
        if (cr <= cl) { el.style.display = 'none'; return; }
        el.style.display = '';
        el.style.left    = cl + 'px';
        el.style.width   = Math.max(2, cr - cl) + 'px';
    });

    // Corpos celestes e suas luas
    celestialBodies.forEach(body => {
        const container = document.getElementById(`container-${body.id}`);
        if (!container) return;

        const sx     = screenX(body.dist);
        const sizePx = Math.max(2, body.size * 1000 / currentScale);

        if (sx < -MARGIN || sx > vw + MARGIN) {
            container.style.display = 'none';
        } else {
            container.style.display = '';
            container.style.left = sx + 'px';

            const planet = document.getElementById(`body-${body.id}`);
            planet.style.width  = sizePx + 'px';
            // Haumea é achatada nos polos — razão real ~2:1 (2322 × 1138 km)
            planet.style.height = (body.id === 'haumea' ? sizePx * 0.5 : sizePx) + 'px';

            if (body.id === 'saturn') {
                // Anéis só mudam em zoom — ignora durante scroll puro (< 0.3px de variação)
                if (Math.abs(sizePx - _lastSaturnSizePx) > 0.3) {
                    _lastSaturnSizePx = sizePx;
                    const ringDefs = [
                        { id: 'c', outerD: sizePx * 1.62, borderW: sizePx * 0.155, color: 'rgba(130, 100, 65, 0.18)' },
                        { id: 'b', outerD: sizePx * 1.985, borderW: sizePx * 0.240, color: 'rgba(195, 162, 96, 0.43)' },
                        { id: 'a', outerD: sizePx * 2.42, borderW: sizePx * 0.175, color: 'rgba(218, 198, 145, 0.34)' },
                    ];
                    ringDefs.forEach(def => {
                        const el = document.getElementById(`saturn-ring-${def.id}`);
                        if (!el) return;
                        el.style.width       = def.outerD + 'px';
                        el.style.height      = def.outerD + 'px';
                        el.style.borderWidth = Math.max(1, def.borderW) + 'px';
                        el.style.borderColor = def.color;
                    });
                    const topCover = document.getElementById('saturn-top-cover');
                    if (topCover) {
                        const photo = planet.dataset.photo;
                        topCover.style.backgroundImage = (photo && loadedPhotos.has(photo) && sizePx > 1)
                            ? `url('photos/${photo}')` : '';
                    }
                }
            } else if (body.rings) {
                const rings    = planet.querySelector('.planet-rings');
                const ringSize = sizePx * body.rings.ratio;
                rings.style.width  = ringSize + 'px';
                rings.style.height = ringSize + 'px';
            }

            const photo = planet.dataset.photo;
            const newBg = (photo && loadedPhotos.has(photo) && sizePx > 1)
                ? `url('photos/${photo}')` : '';
            if (planet.dataset.renderedBg !== newBg) {
                planet.style.backgroundImage = newBg;
                planet.dataset.renderedBg    = newBg;
            }

        }

        // Luas — processadas independentemente do planeta (visibilidade própria)
        body.moons.forEach((moon, idx) => {
            const mc = document.getElementById(`container-${moon.id}`);
            if (!mc) return;

            const moonSX     = screenX(body.dist + moon.dist);
            const moonSizePx = Math.max(1.5, moon.size * 1000 / currentScale);

            if (moonSX < -MARGIN || moonSX > vw + MARGIN) {
                mc.style.display = 'none';
                return;
            }

            // Offset vertical: cresce com o planeta mas é limitado a 55% da meia-tela
            // para que a lua nunca saia do enquadramento vertical
            const baseOffset = Math.max(28, sizePx * 0.55 + moonSizePx + 6);
            const rawV       = moon.side * baseOffset + moonVerticalOffset(idx) * 0.3;
            const totalV     = Math.sign(rawV) * Math.min(Math.abs(rawV), hh * 0.55);

            mc.style.display = '';
            mc.style.left    = moonSX + 'px';
            mc.style.top     = (hh + totalV - moonSizePx / 2) + 'px';

            const dot = document.getElementById(`moon-${moon.id}`);
            if (dot) {
                dot.style.width  = moonSizePx + 'px';
                dot.style.height = moonSizePx + 'px';
            }

            // Nome sempre visível: opacidade mínima 0.5, sobe com o tamanho
            const lbl = mc.querySelector('.moon-label');
            if (lbl) lbl.style.opacity = Math.max(0.5, Math.min(1, moonSizePx / 5));
        });
    });

    // Elemento "fim da jornada"
    const endEl = document.getElementById('journey-end');
    if (endEl) {
        const endSX = screenX(parseFloat(endEl.dataset.distKm));
        if (endSX < -MARGIN || endSX > vw + MARGIN) {
            endEl.style.display = 'none';
        } else {
            endEl.style.display = '';
            endEl.style.left    = endSX + 'px';
        }
    }

    // Marcos de viagem
    const currentKm = scrollPos * currentScale;
    journeyWaypoints.forEach((wp, i) => {
        const el = document.getElementById(`waypoint-${i}`);
        if (!el) return;
        // Never override dismissed hints
        if (el.dataset.dismissed === '1') return;
        const sx = screenX(wp.km);
        if (sx < -MARGIN || sx > vw + MARGIN) { el.style.display = 'none'; return; }
        // Hide waypoints the user has passed (> 2M km behind)
        const isPast = wp.km < currentKm - 2_000_000;
        if (isPast) { el.style.display = 'none'; return; }
        el.style.display = '';
        el.style.left = sx + 'px';
    });


    if (zoomOutBtn) {
        zoomOutBtn.style.display = currentScale < 2500 ? 'block' : 'none';
    }
}

// ─── Minimapa ────────────────────────────────────────────────────────────────

function createMinimap() {
    const canvas = document.getElementById('minimap-canvas');
    if (!canvas) return;

    // Aguarda layout para obter largura real
    requestAnimationFrame(() => {
        const W = canvas.offsetWidth;

        // Zonas
        const zonesEl = document.getElementById('minimap-zones');
        zonesEl.innerHTML = '';
        solarZones.forEach(zone => {
            const band = document.createElement('div');
            band.className = 'minimap-zone';
            band.id = `minimap-zone-${zone.id}`;
            const x1 = minimapScale(zone.innerKm, W);
            const x2 = minimapScale(Math.min(zone.outerKm, MINIMAP_MAX_KM), W);
            band.style.left       = x1 + 'px';
            band.style.width      = Math.max(1, x2 - x1) + 'px';
            band.style.background = zone.minimapColor;

            const lbl = document.createElement('div');
            lbl.className = 'minimap-zone-label';
            lbl.textContent = zone.id === 'asteroid-belt' ? 'ASTER.' : 'KUIPER';
            band.appendChild(lbl);

            zonesEl.appendChild(band);
        });

        // Planetas — wrapper com área de clique ampla, sem alterar zoom
        const bodiesEl = document.getElementById('minimap-bodies');
        bodiesEl.innerHTML = '';
        celestialBodies.forEach(body => {
            const wrap = document.createElement('div');
            wrap.className = 'minimap-body';
            wrap.id = `minimap-dot-${body.id}`;
            wrap.style.left = minimapScale(body.dist, W) + 'px';
            wrap.title = body.name;

            const dotSize = Math.max(4, Math.min(11, Math.sqrt(body.size) * 0.75));
            const dot = document.createElement('div');
            dot.className = 'minimap-dot-visual';
            dot.style.width           = dotSize + 'px';
            dot.style.height          = dotSize + 'px';
            dot.style.backgroundColor = body.color;
            wrap.appendChild(dot);

            const lbl = document.createElement('div');
            lbl.className = 'minimap-dot-label';
            lbl.innerText = body.name.substring(0, 3).toUpperCase();
            wrap.appendChild(lbl);

            wrap.onclick = () => navigateWithWarp(body, Math.max(currentScale, 3000));
            bodiesEl.appendChild(wrap);
        });
    });
}

function updateMinimap() {
    const canvas = document.getElementById('minimap-canvas');
    const cursor = document.getElementById('minimap-cursor');
    if (!canvas || !cursor) return;

    // Minimap não precisa de 60fps — 15fps é imperceptível para um mapa de navegação
    const _mnow = performance.now();
    if (_mnow - _lastMinimapMs < 66) return;
    _lastMinimapMs = _mnow;

    const W        = canvas.offsetWidth;
    const cursorKm = Math.max(0, scrollPos * currentScale);
    const x        = minimapScale(cursorKm, W);
    const clampedX = Math.min(x, W - 1);

    cursor.style.left = clampedX + 'px';

    // Label "VOCÊ ESTÁ AQUI" posicionado abaixo da barra
    const youLabel = document.getElementById('minimap-you-label');
    if (youLabel) {
        // Limita para não sair dos cantos
        const labelX = Math.max(50, Math.min(clampedX, W - 50));
        youLabel.style.left = labelX + 'px';
    }

    // Destaca o planeta mais próximo
    let nearest = null, nearestDelta = Infinity;
    celestialBodies.forEach(body => {
        const delta = Math.abs(body.dist - cursorKm);
        if (delta < nearestDelta) { nearestDelta = delta; nearest = body; }
    });

    document.querySelectorAll('.minimap-body').forEach(el => {
        el.classList.toggle('active', nearest && el.id === `minimap-dot-${nearest.id}`);
    });
}

// ─── Navegação Anterior / Próximo ────────────────────────────────────────────

function updateNavArrows() {
    // As setas mudam só quando o planeta mais próximo muda — 5fps é mais que suficiente
    const _nnow = performance.now();
    if (_nnow - _lastNavMs < 200) return;
    _lastNavMs = _nnow;

    const idx           = getNearestBodyIndex();
    const currentNameEl = document.getElementById('nav-current-name');
    const prevNameEl    = document.getElementById('nav-prev-name');
    const nextNameEl    = document.getElementById('nav-next-name');
    const prevBtn       = document.getElementById('nav-prev');
    const nextBtn       = document.getElementById('nav-next');

    if (currentNameEl) currentNameEl.textContent = celestialBodies[idx].name.toUpperCase();

    const hasPrev = idx > 0;
    const hasNext = idx < celestialBodies.length - 1;

    if (prevBtn) prevBtn.style.visibility = hasPrev ? 'visible' : 'hidden';
    if (nextBtn) nextBtn.style.visibility = hasNext ? 'visible' : 'hidden';
    if (hasPrev && prevNameEl) prevNameEl.textContent = celestialBodies[idx - 1].name.toUpperCase();
    if (hasNext && nextNameEl) nextNameEl.textContent = celestialBodies[idx + 1].name.toUpperCase();
}

// ─── Eventos ─────────────────────────────────────────────────────────────────

function setupEvents() {
    // Scroll e zoom
    window.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (tourActive) interruptTour();
        if (e.ctrlKey) {
            isAnimating = false;
            const factor = 1 + e.deltaY * 0.001;
            applyManualZoom(currentScale * factor);
        } else {
            isAnimating = false;
            scrollPos += e.deltaY * sensitivity;
            scrollPos = Math.max(startDistKm() / currentScale, scrollPos);
            updateScroll();
        }
    }, { passive: false });

    // Arrasto
    window.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragStartX = e.clientX;
        dragStartScrollPos = scrollPos;
        document.body.classList.add('dragging');
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = dragStartX - e.clientX;
        if (tourActive && Math.abs(dx) > 6) interruptTour();
        isAnimating = false;
        scrollPos = Math.max(startDistKm() / currentScale, dragStartScrollPos + dx);
        updateScroll();
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
        document.body.classList.remove('dragging');
    });

    // Touch events for mobile navigation
    window.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            if (inertiaFrame) cancelAnimationFrame(inertiaFrame);
            isDragging = true;
            dragStartX = e.touches[0].clientX;
            dragStartScrollPos = scrollPos;

            lastTouchX = e.touches[0].clientX;
            lastTouchTime = performance.now();
            touchVelocity = 0;
            initialPinchDist = null;
        } else if (e.touches.length === 2) {
            isDragging = false;
            initialPinchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            initialPinchScale = currentScale;
        }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && initialPinchDist) {
            const currentDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const ratio = initialPinchDist / currentDist;
            applyManualZoom(initialPinchScale * ratio);
            if (e.cancelable) e.preventDefault();
            return;
        }

        if (!isDragging || e.touches.length !== 1) return;

        const currentX = e.touches[0].clientX;
        const currentTime = performance.now();
        const dt = currentTime - lastTouchTime;

        const dx = (dragStartX - currentX) * sensitivity;
        if (tourActive && Math.abs(dx) > 10) interruptTour();

        if (dt > 0) {
            touchVelocity = (lastTouchX - currentX) / dt;
        }
        lastTouchX = currentX;
        lastTouchTime = currentTime;

        isAnimating = false;

        const minScroll = startDistKm() / currentScale;
        const maxScroll = MINIMAP_MAX_KM / currentScale;
        scrollPos = Math.max(minScroll, Math.min(maxScroll, dragStartScrollPos + dx));

        updateScroll();
        if (e.cancelable) e.preventDefault();
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
        isDragging = false;

        // Régua: tap detectado se deslocamento < 12px
        if (measureActive && e.changedTouches.length === 1) {
            const dx = Math.abs(e.changedTouches[0].clientX - dragStartX);
            if (dx < 12) {
                handleMeasurePoint(e.changedTouches[0].clientX);
                touchVelocity = 0;
                return;
            }
        }

        if (Math.abs(touchVelocity) > 0.1) {
            applyInertia();
        }
    });

    function applyInertia() {
        const friction = 0.97;
        const minScroll = startDistKm() / currentScale;
        const maxScroll = MINIMAP_MAX_KM / currentScale;

        scrollPos += touchVelocity * 16 * sensitivity;
        scrollPos = Math.max(minScroll, Math.min(maxScroll, scrollPos));

        updateScroll();

        touchVelocity *= friction;

        if (Math.abs(touchVelocity) > 0.01) {
            inertiaFrame = requestAnimationFrame(applyInertia);
        }
    }

    // Redimensionamento
    window.addEventListener('resize', () => {
        updateUniversePositions();
        createMinimap();
    });

    // Botão Reduzir Zoom
    if (zoomOutBtn) {
        zoomOutBtn.onclick = () => {
            startProgrammedAnim(scrollPos * currentScale, 3000);
        };
    }

    // Velocidade da Luz
    const lightspeedBtn  = document.getElementById('lightspeed-btn');
    if (lightspeedBtn) {
        lightspeedBtn.onclick = () => {
            if (tourActive) return;
            if (isLightspeedManual) {
                lightspeedDecelerating = true;
                lightspeedDecelStart   = null;
                lightspeedDecelSpeed   = LIGHT_SPEED_KM_S;
                isLightspeedManual = false;
            } else {
                lightspeedDecelerating = false;
                isLightspeedManual = true;
                // Sync waypoint index to current position so we don't replay passed waypoints
                const curKm = scrollPos * currentScale;
                lastShownWaypointIdx = journeyWaypoints.reduce((acc, wp, i) =>
                    wp.km <= curKm ? i : acc, -1);
            }
            updateFreeLightspeedBtn();
        };
    }

    // Régua Interativa
    const measureBtn = document.getElementById('measure-btn');
    if (measureBtn) measureBtn.onclick = toggleMeasure;

    const measureCapture = document.getElementById('measure-capture');
    if (measureCapture) {
        measureCapture.addEventListener('click', (e) => {
            handleMeasurePoint(e.clientX);
        });
    }

    // Painel de Detalhes
    const detailCloseBtn = document.getElementById('planet-detail-close');
    if (detailCloseBtn) detailCloseBtn.onclick = closePlanetDetail;
    const collapseBtn = document.getElementById('detail-collapse-btn');
    if (collapseBtn) {
        collapseBtn.onclick = (e) => {
            e.stopPropagation();
            const panel = document.getElementById('planet-detail-panel');
            if (!panel) return;
            const isCollapsed = panel.classList.toggle('collapsed');
            collapseBtn.textContent = isCollapsed ? '▶' : '◀';
        };
    }

    // Créditos
    const creditsToggle = document.getElementById('credits-toggle');
    const creditsPanel  = document.getElementById('credits-panel');
    const creditsClose  = document.getElementById('credits-close');
    if (creditsToggle && creditsPanel) {
        creditsToggle.onclick = () => creditsPanel.classList.toggle('visible');
    }
    if (creditsClose && creditsPanel) {
        creditsClose.onclick = () => creditsPanel.classList.remove('visible');
    }

    // Navegação anterior / próximo
    const navPrevBtn = document.getElementById('nav-prev');
    const navNextBtn = document.getElementById('nav-next');
    if (navPrevBtn) {
        navPrevBtn.onclick = () => {
            const idx = getNearestBodyIndex();
            if (idx > 0) navigateWithWarp(celestialBodies[idx - 1], Math.max(currentScale, 3000));
        };
    }
    if (navNextBtn) {
        navNextBtn.onclick = () => {
            const idx = getNearestBodyIndex();
            if (idx < celestialBodies.length - 1) navigateWithWarp(celestialBodies[idx + 1], Math.max(currentScale, 3000));
        };
    }

    // Minimap toggle (for small screens)
    const minimapToggle = document.getElementById('minimap-toggle');
    if (minimapToggle) {
        minimapToggle.onclick = () => {
            const container = document.getElementById('minimap-container');
            if (!container) return;
            const collapsed = container.classList.toggle('collapsed');
            minimapToggle.setAttribute('aria-expanded', !collapsed);
            // Força o recálculo da largura para que os planetas fiquem nas posições corretas
            if (!collapsed) {
                setTimeout(createMinimap, 350); // Aguarda a transição CSS terminar
            }
        };
    }

    const resetHintsBtn = document.getElementById('reset-hints-btn');
    if (resetHintsBtn) {
        resetHintsBtn.onclick = () => {
            localStorage.removeItem('hideHints');
            document.querySelectorAll('.help-waypoint').forEach(e => {
                delete e.dataset.dismissed;
                e.style.display = '';
            });
        };
    }


    // Toggle de configurações
    const settingsToggle = document.getElementById('settings-toggle');
    const settingsPanel  = document.getElementById('settings-panel');
    if (settingsToggle && settingsPanel) {
        settingsToggle.onclick = () => settingsPanel.classList.toggle('open');
    }

    // Sensibilidade
    const sensitivitySlider = document.getElementById('sensitivity-slider');
    if (sensitivitySlider) {
        sensitivitySlider.oninput = () => {
            sensitivity = parseFloat(sensitivitySlider.value);
        };
    }
}

// ─── Zoom Manual ─────────────────────────────────────────────────────────────

function applyManualZoom(newScale) {
    newScale = Math.max(0.01, Math.min(5000, newScale));
    const centerDist = scrollPos * currentScale;
    currentScale = newScale;
    scrollPos    = centerDist / currentScale;
    updateScroll();
}

// ─── Info Display — construído uma vez, atualizado por textContent ────────────

function buildInfoDisplay() {
    if (!infoDisplay) return;
    infoDisplay.innerHTML = `
        <div class="info-item"><span class="info-label">Distância</span><span class="info-value" id="info-val-dist">0 km</span></div>
        <div class="info-item"><span class="info-label">UA</span><span class="info-value" id="info-val-ua">0.0000</span></div>
        <div class="info-item"><span class="info-label">Ano-Luz</span><span class="info-value" id="info-val-al">0.00000000</span></div>
        <div class="info-item"><span class="info-label">Tempo de Luz</span><span class="info-value" id="info-val-light">0.0s</span></div>
    `;
    _infoDistEl  = document.getElementById('info-val-dist');
    _infoUaEl    = document.getElementById('info-val-ua');
    _infoAlEl    = document.getElementById('info-val-al');
    _infoLightEl = document.getElementById('info-val-light');
    _lastInfoKm    = null;
    _lastInfoScale = null;
}

// ─── Scroll / UI ─────────────────────────────────────────────────────────────
//
// FIX: universe.style.transform = translateX(...) foi removido.
// Posicionamento agora é viewport-relativo em updateUniversePositions().

function updateScroll() {
    updateUniversePositions();
    updateRulerPosition();
    updateUI();
    updateWelcomeOverlay();
    updateScaleIntro();
    updateMeasureOverlay();
}

const RULER_START_KM = -1_000_000; // régua começa 1M km antes do Sol

function rulerLeftPx() {
    // Posição de tela do ponto de início da régua
    const x = window.innerWidth / 2 + (RULER_START_KM - scrollPos * currentScale) / currentScale;
    return Math.max(0, x);
}

function updateRulerPosition() {
    const rulerEl = document.getElementById('astronomical-ruler');
    if (rulerEl) rulerEl.style.left = rulerLeftPx() + 'px';
}

function updateWelcomeOverlay() {
    const ws = document.getElementById('welcome-screen');
    if (!ws) return;
    // Slide with the universe: translate so the screen is centered at km = -4M
    const offsetPx = screenX(startDistKm()) - window.innerWidth / 2;
    ws.style.transform = `translateX(${offsetPx}px)`;
    // Pointer events only when close to viewport (within 1 screen width)
    ws.style.pointerEvents = Math.abs(offsetPx) < window.innerWidth ? 'auto' : 'none';
}

function updateScaleIntro() {
    const si = document.getElementById('scale-intro');
    if (!si) return;

    const km = scrollPos * currentScale;

    // Visível apenas entre a tela de início e o Sol (-4M a 0 km)
    if (km <= startDistKm() || scrollPos >= 0) {
        si.style.display = 'none';
        return;
    }

    si.style.display = 'flex';

    // Fade-in proporcional à distância de início (desktop vs mobile)
    // Aparece após percorrer ~25% do caminho; some no último 25%
    const start       = startDistKm();          // ex: -15M desktop, -4M mobile
    const fadeInStart = start * 0.75;           // -11.25M / -3M
    const fadeInEnd   = start * 0.60;           // -9M / -2.4M
    const fadeOutKm   = start * 0.25;           // -3.75M / -1M

    let opacity = 1;
    if (km < fadeInEnd) {
        opacity = (km - fadeInStart) / (fadeInEnd - fadeInStart);
    } else if (km > fadeOutKm) {
        opacity = km / fadeOutKm;
    }
    si.style.opacity = Math.max(0, Math.min(1, opacity));

    const screenKm   = window.innerWidth * currentScale;
    const lightCross = screenKm / LIGHT_SPEED_KM_S;
    const distToSun  = Math.abs(km);

    const pxEl  = document.getElementById('si-px');
    const detEl = document.getElementById('si-details');
    const arrEl = document.getElementById('si-arrow');

    if (pxEl)  pxEl.textContent  = `1 PIXEL = ${formatKm(currentScale)}`;
    if (detEl) detEl.textContent = `TELA = ${formatKm(screenKm)}  ·  LUZ CRUZA EM ${formatTime(lightCross)}`;
    if (arrEl) arrEl.textContent = `── ── SOL A ${formatKm(distToSun)} ──▶`;
}

function updateUI() {
    const distKm  = scrollPos * currentScale;
    const distUA  = distKm / UA_KM;
    const distAL  = distKm / AL_KM;
    const lightSec = distKm / LIGHT_SPEED_KM_S;

    // Oculta botões e minimapa antes do Sol (0 km)
    const lsBtn  = document.getElementById('lightspeed-btn');
    const mBtn   = document.getElementById('measure-btn');
    const mmCont = document.getElementById('minimap-container');
    if (lsBtn)  lsBtn.style.display  = distKm < 0 ? 'none' : 'flex';
    if (mBtn)   mBtn.style.display   = distKm < 0 ? 'none' : 'flex';
    if (mmCont) {
        const wasHidden = mmCont.style.display === 'none';
        mmCont.style.display = distKm < 0 ? 'none' : '';
        if (wasHidden && distKm >= 0) setTimeout(createMinimap, 350);
    }

    // Só atualiza os spans quando o valor muda de forma perceptível
    // (threshold = 1 "pixel escalonado" de distância — elimina writes desnecessários)
    if (_infoDistEl) {
        const threshold = Math.max(100, currentScale);
        const roundedKm = Math.floor(distKm / threshold) * threshold;
        if (roundedKm !== _lastInfoKm || currentScale !== _lastInfoScale) {
            _lastInfoKm    = roundedKm;
            _lastInfoScale = currentScale;
            _infoDistEl.textContent  = Math.max(0, Math.floor(distKm)).toLocaleString('pt-BR') + ' km';
            _infoUaEl.textContent    = Math.max(0, distUA).toFixed(4);
            _infoAlEl.textContent    = Math.max(0, distAL).toFixed(8);
            _infoLightEl.textContent = formatTime(Math.max(0, lightSec));
        }
    }

    // Indicador de cinturão
    const zoneIndicatorEl = document.getElementById('zone-indicator');
    if (zoneIndicatorEl) {
        const curKm = Math.max(0, distKm);
        const zone  = solarZones.find(z => curKm >= z.innerKm && curKm <= z.outerKm);
        if (zone) {
            zoneIndicatorEl.textContent = '✦  ' + zone.name.toUpperCase() + '  ✦';
            zoneIndicatorEl.style.display = 'block';
        } else {
            zoneIndicatorEl.style.display = 'none';
        }
    }

    updateRuler();
    updateMinimap();
    updateNavArrows();
}

// ─── Régua ───────────────────────────────────────────────────────────────────

function updateRuler() {
    if (!rulerTicks) return;

    // Calcula step antes do guard para poder comparar posição real dos ticks
    let stepKm = 100000;
    if (currentScale < 100)   stepKm = 10000;
    if (currentScale < 10)    stepKm = 1000;
    if (currentScale > 5000)  stepKm = 1000000;
    if (currentScale > 50000) stepKm = 10000000;

    const stepPx = stepKm / currentScale;

    // Só reconstrói quando os ticks se deslocaram ≥ 10% de um intervalo
    if (_lastRulerScale === currentScale &&
        _lastRulerScrollPos !== null &&
        Math.abs(scrollPos - _lastRulerScrollPos) < stepPx * 0.1) return;
    _lastRulerScale     = currentScale;
    _lastRulerScrollPos = scrollPos;

    rulerTicks.innerHTML = '';
    const halfWidth  = window.innerWidth / 2;
    const sunX       = halfWidth - scrollPos;  // screenX(0)
    const rulerLeft  = rulerLeftPx();          // borda esquerda do #astronomical-ruler
    // .ruler-ticks vive no content box do ruler (após o padding-left).
    // A origem real dos ticks na tela é rulerLeft + paddingLeft, não rulerLeft.
    const rulerEl2   = document.getElementById('astronomical-ruler');
    const padLeft    = rulerEl2 ? parseInt(window.getComputedStyle(rulerEl2).paddingLeft) : 20;
    const tickOrigin = rulerLeft + padLeft;    // screen-x real do left de .ruler-ticks
    const rulerWidth = window.innerWidth - tickOrigin;

    // Ticks apenas para km ≥ 0
    const offset   = scrollPos - halfWidth;
    const startIdx = Math.max(0, Math.floor(offset / stepPx));
    const endIdx   = startIdx + Math.ceil(rulerWidth / stepPx) + 1;

    for (let i = startIdx; i <= endIdx; i++) {
        const tickX = (i * stepPx + sunX) - tickOrigin;
        if (tickX < 0 || tickX > rulerWidth) continue;
        const tick     = document.createElement('div');
        const isMajor  = i % 10 === 0;
        tick.className = `tick${isMajor ? ' major' : ''}`;
        tick.style.left = tickX + 'px';
        if (isMajor) {
            const lbl = document.createElement('div');
            lbl.className  = 'tick-label';
            lbl.innerText  = formatKm(i * stepKm);
            tick.appendChild(lbl);
        }
        rulerTicks.appendChild(tick);
    }

}

// ─── Animação Programada ─────────────────────────────────────────────────────

function startProgrammedAnim(targetDistKm, targetS, onComplete = null, duration = 2500, easing = null) {
    // Mensagens de manobra
    if (targetS < currentScale * 0.45 && currentScale > 300) {
        showMsgOverlay('Entrando em órbita...', 2500);
    } else if (targetS > currentScale * 2 && currentScale < 800) {
        showMsgOverlay('Saindo de órbita...', 2500);
    }

    targetScale       = targetS;
    scaleStart        = currentScale;
    focalDist         = targetDistKm;
    scrollStart   = scrollPos;
    animStartTime = performance.now();
    isAnimating  = true;
    animDuration = duration;
    animCallback = onComplete;
    animEasing   = easing;
}

// ─── Loop de Animação ────────────────────────────────────────────────────────

function animate(now) {
    // Delta time in seconds — capped at 100ms to avoid jumps after tab pause
    const dt = prevFrameTime !== null ? Math.min((now - prevFrameTime) / 1000, 0.1) : 1 / 60;
    prevFrameTime = now;

    let dirty = false;

    if (isAnimating) {
        const DURATION = animDuration;
        const elapsed  = now - animStartTime;
        const t        = Math.min(elapsed / DURATION, 1);
        const eased    = animEasing ? animEasing(t) : easeInOutCubic(t);

        currentScale = scaleStart + (targetScale - scaleStart) * eased;

        // Interpolação linear em km — evita overshoot ao navegar para trás
        const startKm  = scrollStart * scaleStart;
        const currentKm = startKm + (focalDist - startKm) * eased;
        scrollPos = currentKm / currentScale;

        if (t >= 1) {
            isAnimating  = false;
            currentScale = targetScale;
            scrollPos    = focalDist / targetScale;
            animEasing   = null;
            const cb = animCallback;
            animCallback = null;
            if (cb) cb();
        }
        dirty = true;
    }

    if (isLightSpeed || isLightspeedManual) {
        const speedKmS = (tourActive && tourTransitSpeedKmS !== null)
            ? tourTransitSpeedKmS
            : LIGHT_SPEED_KM_S;
        scrollPos += (speedKmS / currentScale) * dt;
        dirty = true;

        const currentKm = scrollPos * currentScale;

        // Tour: detecta cruzamento do limiar para ativar dobra
        if (tourActive && warpThresholdKm !== null && currentKm >= warpThresholdKm) {
            isLightSpeed        = false;
            tourTransitSpeedKmS = null;
            warpThresholdKm     = null;
            isWarpVisual        = true;

            const ni = tourTransitNextIdx;
            const nb = tourTransitNextBody;
            const ns = tourTransitNextStop;
            const warpAnimDur = 3500;
            // Warp visual stays on during the entire programmed animation
            // Turn it off 1s before arrival so the "arrival" feel is clean
            tourPauseTimeout = setTimeout(() => {
                if (!tourActive) return;
                isWarpVisual = false;
            }, warpAnimDur - 1000);
            startProgrammedAnim(nb.dist, ns.scale, () => {
                if (!tourActive) return;
                isWarpVisual = false;
                tourStepIdx = ni;
                openPlanetDetail(nb);
                showTourHold(ni);
            }, warpAnimDur);
        }
    }

    // Lightspeed deceleration
    if (lightspeedDecelerating) {
        if (!lightspeedDecelStart) lightspeedDecelStart = now;
        const elapsed = now - lightspeedDecelStart;
        const t = Math.min(elapsed / 1000, 1);
        const eased = 1 - t * t; // quadratic ease-out
        if (eased > 0) {
            scrollPos += (lightspeedDecelSpeed / currentScale) * eased * dt;
            dirty = true;
        }
        if (t >= 1) {
            lightspeedDecelerating = false;
            lightspeedDecelStart   = null;
        }
    }

    if (dirty) updateScroll(); // updateUniversePositions + updateUI

    // anyMotion: ativa foton e lightspeed-active (botão manual + tour + warp)
    // streaking: estrelas esticadas APENAS no warp visual (saltos do minimapa)
    const anyMotion = isLightSpeed || isLightspeedManual || lightspeedDecelerating || isWarpVisual;
    const streaking = isWarpVisual;
    // Só chama classList.toggle quando o estado muda — evita cascade de CSS em 99% dos frames
    if (anyMotion !== prevAnyLight || streaking !== prevStreaking) {
        if (photon)      photon.classList.toggle('active',      anyMotion);
        if (starFieldEl) starFieldEl.classList.toggle('warp-active', streaking);
        document.body.classList.toggle('lightspeed-active', anyMotion);
        prevAnyLight = anyMotion;
        prevStreaking = streaking;
    }
    if (tourActive !== _prevTourActive) {
        document.body.classList.toggle('tour-active', tourActive);
        _prevTourActive = tourActive;
    }

    // Star layer movement: speed-based during lightspeed, position-based otherwise
    const PLUTO_KM_REF = 5906400000;
    const kmPos        = Math.max(0, scrollPos * currentScale);
    const maxShifts    = [60, 30, 10]; // max px shift at Pluto distance (position-based)
    // px/s por layer a 1c — mobile usa ~1/3 do desktop para não saturar a tela pequena
    const basePixels   = window.innerWidth <= 600 ? [600, 300, 120] : [1800, 900, 360];

    // Compute fractional speed (0=stopped, 1=1c, >1 if tour speed > 1c)
    let speedFactor = 0;
    if (isLightSpeed || isLightspeedManual) {
        const kmS = (tourActive && tourTransitSpeedKmS !== null) ? tourTransitSpeedKmS : LIGHT_SPEED_KM_S;
        speedFactor = kmS / LIGHT_SPEED_KM_S;
    } else if (isWarpVisual) {
        speedFactor = 1; // warp travels at 1c visually
    } else if (lightspeedDecelerating && lightspeedDecelStart) {
        const elapsed = now - lightspeedDecelStart;
        const t = Math.min(elapsed / 1000, 1);
        speedFactor = Math.max(0, 1 - t * t);
    }

    // Sync offsets when entering lightspeed so there's no visual jump
    if (anyMotion && !prevAnyLight) {
        starLayers.forEach((_, l) => {
            const raw = (kmPos / PLUTO_KM_REF) * maxShifts[l];
            starScrollOffsets[l] = raw % window.innerWidth;
        });
    }

    if (anyMotion && speedFactor > 0) {
        starLayers.forEach((layer, l) => {
            if (!layer) return;
            starScrollOffsets[l] = (starScrollOffsets[l] + basePixels[l] * speedFactor * dt) % window.innerWidth;
            layer.style.transform = `translateX(-${starScrollOffsets[l].toFixed(1)}px)`;
        });
    } else {
        // Position-based parallax (subtle depth cue during normal travel)
        starLayers.forEach((layer, l) => {
            if (!layer) return;
            const raw = (kmPos / PLUTO_KM_REF) * maxShifts[l];
            starScrollOffsets[l] = raw % window.innerWidth;
            layer.style.transform = `translateX(-${starScrollOffsets[l].toFixed(1)}px)`;
        });
    }

    requestAnimationFrame(animate);
}

// ─── Painel de Detalhes do Planeta ───────────────────────────────────────────

function openPlanetDetail(body) {
    const panel = document.getElementById('planet-detail-panel');
    if (!panel) return;
    const data = planetData[body.id];
    if (!data) return;

    // Visual
    const visual = document.getElementById('planet-detail-visual');
    if (visual) {
        const hasPhoto = body.photo && loadedPhotos.has(body.photo);
        const ringHTML = body.id === 'saturn'
            ? `<div class="pdv-ring pdv-ring-c"></div><div class="pdv-ring pdv-ring-b"></div><div class="pdv-ring pdv-ring-a"></div>`
            : body.rings
                ? `<div class="pdv-ring" style="border-color:${body.rings.color}"></div>`
                : '';
        const topCoverHTML = body.id === 'saturn'
            ? `<div class="pdv-top-cover" style="${hasPhoto ? `background-image:url('photos/${body.photo}');background-size:cover;background-position:center` : `background:radial-gradient(circle at 38% 32%,rgba(255,255,255,0.28),${body.color} 58%,rgba(0,0,0,0.5))`}"></div>`
            : '';
        const moonsHTML = body.moons.slice(0, 8).map(m => {
            const sz = Math.max(4, Math.min(14, m.size * 2.5));
            return `<div class="pdv-moon-dot" style="width:${sz}px;height:${sz}px;background:${m.color}" title="${m.name}"></div>`;
        }).join('');
        const sphereBg = hasPhoto
            ? `background-image:url('photos/${body.photo}');background-size:cover;background-position:center`
            : `background:radial-gradient(circle at 38% 32%,rgba(255,255,255,0.28),${body.color} 58%,rgba(0,0,0,0.5))`;
        visual.innerHTML =
            `<div class="pdv-sphere" style="${sphereBg};box-shadow:0 0 40px ${body.color}33">${ringHTML}${topCoverHTML}</div>` +
            (body.moons.length > 0 ? `<div class="pdv-moon-row">${moonsHTML}</div>` : '');
    }

    const typeEl = document.getElementById('planet-detail-type');
    const nameEl = document.getElementById('planet-detail-name');
    const descEl = document.getElementById('planet-detail-desc');
    if (typeEl) typeEl.textContent = data.type.toUpperCase();
    if (nameEl) nameEl.textContent = body.name.toUpperCase();
    if (descEl) descEl.innerHTML = data.desc_html || data.desc;  // supports HTML in JSON

    const statsEl = document.getElementById('planet-detail-stats');
    if (statsEl) {
        const rows = [
            ['Distância do Sol',  body.dist === 0 ? '0 km' : formatKm(body.dist)],
            ['Distância em UA',   data.distAU === "0" ? '—' : `${data.distAU} UA`],
            ['Diâmetro',          `${(body.size * 1000).toLocaleString('pt-BR')} km`],
            ['Massa (Terra = 1)', data.massEarth || '—'],
            ['Gravidade',         data.gravity || '—'],
            ['Temperatura',       data.temp],
            ['Período Orbital',   data.period],
            ['Tempo de Luz',      body.dist === 0 ? '—' : formatTime(body.dist / LIGHT_SPEED_KM_S)],
            ['Luas Conhecidas',   data.moons.toString()],
        ];
        statsEl.innerHTML = rows.map(([l, v]) =>
            `<div class="detail-stat"><span class="detail-stat-label">${l}</span><span class="detail-stat-value">${v}</span></div>`
        ).join('');
    }

    const moonsListEl = document.getElementById('planet-detail-moons-list');
    if (moonsListEl) {
        moonsListEl.innerHTML = body.moons.length > 0
            ? `<div class="detail-section-title">LUAS NESTA SIMULAÇÃO</div>` +
              body.moons.map(m => {
                const hasPhoto = m.photo && loadedPhotos.has(m.photo);
                const visual = hasPhoto
                    ? `<img class="detail-moon-thumb" src="photos/${m.photo}" alt="${m.name}">`
                    : `<span class="detail-moon-swatch" style="background:${m.color}"></span>`;
                return `<div class="detail-moon-item">
                    ${visual}
                    <span class="detail-moon-name">${m.name}</span>
                    <span class="detail-moon-dist">${m.dist.toLocaleString('pt-BR')} km</span>
                 </div>`;
              }).join('')
            : '';
    }

    panel.classList.add('open');
    panel.classList.remove('collapsed');
    const collapseBtn = document.getElementById('detail-collapse-btn');
    if (collapseBtn) collapseBtn.textContent = '◀';
    panel.scrollTop = 0;
}

function closePlanetDetail() {
    const panel = document.getElementById('planet-detail-panel');
    if (panel) {
        panel.classList.remove('open');
        panel.classList.remove('collapsed');
    }
    
    // Reseta o ícone do botão de colapso para quando abrir novamente
    const collapseBtn = document.getElementById('detail-collapse-btn');
    if (collapseBtn) collapseBtn.textContent = '◀';
}

// ─── Tour Guiado ─────────────────────────────────────────────────────────────

function startFreeMode() { /* no-op: welcome screen is always in the universe */ }

function startTour() {
    const introPanel = document.getElementById('tour-intro-panel');
    if (introPanel) introPanel.classList.add('visible');
}

function beginTour() {
    const introPanel = document.getElementById('tour-intro-panel');
    if (introPanel) introPanel.classList.remove('visible');
    const lightspeedBtn = document.getElementById('lightspeed-btn');
    if (lightspeedBtn) { lightspeedBtn.classList.remove('intro'); lightspeedBtn.style.display = 'none'; }
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    if (zoomOutBtn) zoomOutBtn.style.display = 'none';
    tourActive   = true;
    tourStepIdx  = 0;
    lastShownWaypointIdx = -1;
    showTourTransit();
    runTourStep(0);
    updateTourResumeBtn();
}

// Para todo movimento propulsado e limpa todos os timers de tour.
// Não altera tourActive, tourStepIdx nem faz cleanup de UI — isso fica a cargo do chamador.
function _stopAllMotion() {
    if (tourPauseTimeout) { clearTimeout(tourPauseTimeout); tourPauseTimeout = null; }
    if (holdTimeout)      { clearTimeout(holdTimeout);      holdTimeout = null; }
    if (warpOffTimeout)   { clearTimeout(warpOffTimeout);   warpOffTimeout = null; }
    tourWaypointTimeouts.forEach(clearTimeout);
    tourWaypointTimeouts   = [];
    animCallback           = null;
    isAnimating            = false;
    isLightSpeed           = false;
    isWarpVisual           = false;
    lightspeedDecelerating = false;
    lightspeedDecelStart   = null;
    tourTransitSpeedKmS    = null;
    warpThresholdKm        = null;
}

function interruptTour() {
    _stopAllMotion();
    tourActive = false;
    document.body.classList.remove('tour-intro-zooming');
    hideTourMsg();
    // tourStepIdx preservado para permitir retomada
    const lightspeedBtn = document.getElementById('lightspeed-btn');
    if (lightspeedBtn) lightspeedBtn.style.display = '';
    updateFreeLightspeedBtn();
    updateTourResumeBtn();
}

function resumeTour() {
    if (tourStepIdx < 0) { startTour(); return; }
    const lightspeedBtn = document.getElementById('lightspeed-btn');
    if (lightspeedBtn) lightspeedBtn.style.display = 'none';
    tourActive = true;
    const curKm = scrollPos * currentScale;
    lastShownWaypointIdx = journeyWaypoints.reduce((acc, wp, i) =>
        wp.km <= curKm ? i : acc, -1);
    hideTourMsg();
    closePlanetDetail();
    runTourStep(tourStepIdx);
    updateTourResumeBtn();
}

function updateTourResumeBtn() {
    const btn = document.getElementById('tour-resume-btn');
    if (!btn) return;
    if (tourActive) {
        btn.style.display = 'none';
        return;
    }
    btn.style.display = 'flex';
    if (tourStepIdx >= 0) {
        btn.textContent = '↩ RETORNAR AO TOUR';
        btn.classList.add('resumable');
    } else {
        btn.textContent = 'TOUR GUIADO';
        btn.classList.remove('resumable');
    }
}

function endTour() {
    hideConfirmExitTour();
    _stopAllMotion();
    tourActive  = false;
    tourStepIdx = -1;
    document.body.classList.remove('tour-intro-zooming');
    hideTourMsg();
    closePlanetDetail();
    const introPanel = document.getElementById('tour-intro-panel');
    if (introPanel) introPanel.classList.remove('visible');
    const lightspeedBtn = document.getElementById('lightspeed-btn');
    if (lightspeedBtn) lightspeedBtn.style.display = '';
    updateFreeLightspeedBtn();
    updateTourResumeBtn();
}

function runTourStep(idx) {
    if (!tourActive) return;
    if (idx >= tourStops.length) { endTour(); return; }
    tourStepIdx = idx;
    const stop = tourStops[idx];
    const body = celestialBodies.find(b => b.id === stop.id);
    if (!body) { runTourStep(idx + 1); return; }

    showTourTransit();
    showMsgOverlay(`Viajando para ${body.name}...`, 3000);

    startProgrammedAnim(body.dist, stop.scale, () => {
        if (!tourActive) return;
        openPlanetDetail(body);
        showTourHold(idx);
    });
}

function advanceTour() {
    if (!tourActive) return;
    if (tourPauseTimeout) { clearTimeout(tourPauseTimeout); tourPauseTimeout = null; }
    if (holdTimeout)      { clearTimeout(holdTimeout);      holdTimeout = null; }
    animCallback = null;
    isAnimating  = false;
    closePlanetDetail();

    const currIdx = tourStepIdx;
    const nextIdx = currIdx + 1;
    if (nextIdx >= tourStops.length) { endTour(); return; }

    const currStop = tourStops[currIdx];
    const nextStop = tourStops[nextIdx];
    const currBody = celestialBodies.find(b => b.id === currStop.id);
    const nextBody = celestialBodies.find(b => b.id === nextStop.id);
    if (!nextBody) { endTour(); return; }

    const fromDist = currBody ? currBody.dist : 0;
    const toDist   = nextBody.dist;

    // Último waypoint entre os dois corpos → limiar de ativação da dobra
    const wpsInRange = journeyWaypoints.filter(wp => wp.km > fromDist && wp.km < toDist);
    const lastWp     = wpsInRange.length > 0 ? wpsInRange[wpsInRange.length - 1] : null;
    const warpThresh = lastWp
        ? lastWp.km + 4_000_000
        : fromDist + (toDist - fromDist) * 0.45;

    // Velocidade: cobrir a distância até o limiar em ~20s
    const travelDist = warpThresh - fromDist;
    const speed      = Math.max(travelDist / 20, LIGHT_SPEED_KM_S); // mínimo: 1c

    tourTransitNextIdx  = nextIdx;
    tourTransitNextBody = nextBody;
    tourTransitNextStop = nextStop;
    warpThresholdKm     = warpThresh;
    tourTransitSpeedKmS = speed;

    // Inicializa índice de waypoints a partir da posição atual
    const curKm = scrollPos * currentScale;
    lastShownWaypointIdx = journeyWaypoints.reduce((acc, wp, i) =>
        wp.km <= curKm ? i : acc, -1);

    showTourTransit();

    const lightTime = Math.abs((toDist - fromDist) / LIGHT_SPEED_KM_S);
    const fromName  = currBody ? currBody.name : 'aqui';
    const doLaunch  = () => {
        if (!tourActive) return;
        showMsgOverlay(
            `A luz leva ${formatTime(lightTime)} de ${fromName} até ${nextBody.name}.`,
            5000
        );
        tourPauseTimeout = setTimeout(() => {
            if (!tourActive) return;
            _startTourLightspeed(wpsInRange);
        }, 2000);
    };

    // Zoom out se necessário, depois ativa lightspeed
    if (currentScale < 1500) {
        startProgrammedAnim(fromDist, 3000, doLaunch);
    } else {
        doLaunch();
    }
}

function _startTourLightspeed(wpsInRange) {
    isLightSpeed = true;
    showMsgOverlay('Velocidade da luz ativada.', 2000);

    // Clear any pending waypoint timers
    tourWaypointTimeouts.forEach(clearTimeout);
    tourWaypointTimeouts = [];

    const totalMs = 20000;
    (wpsInRange || []).forEach((wp, i, arr) => {
        const delay = Math.round((i + 1) / (arr.length + 1) * totalMs);
        const t = setTimeout(() => {
            if (!tourActive || !isLightSpeed) return;
            showMsgOverlay(wp.text, 5000);
        }, delay);
        tourWaypointTimeouts.push(t);
    });
}

function showTourTransit() {
    const msg       = document.getElementById('tour-center-msg');
    const progress  = document.getElementById('tour-panel-progress');
    const followBtn = document.getElementById('tour-follow-btn');
    const nextInfo  = document.getElementById('tour-next-info');
    if (!msg) return;
    if (progress)  progress.textContent   = 'EM TRÂNSITO';
    if (followBtn) followBtn.style.display = 'none';
    if (nextInfo)  nextInfo.style.display  = 'none';
    msg.classList.add('visible');
}

function showTourHold(idx) {
    const msg       = document.getElementById('tour-center-msg');
    const progress  = document.getElementById('tour-panel-progress');
    const followBtn = document.getElementById('tour-follow-btn');
    const nextInfo  = document.getElementById('tour-next-info');
    if (!msg) return;

    const stop   = tourStops[idx];
    const body   = celestialBodies.find(b => b.id === stop.id);
    const isLast = idx >= tourStops.length - 1;

    if (progress) progress.textContent = `PARADA ${idx + 1} / ${tourStops.length}`;

    if (isLast) {
        if (followBtn) followBtn.style.display = 'none';
        if (nextInfo)  nextInfo.style.display  = 'none';
    } else {
        const nextStop = tourStops[idx + 1];
        const nextBody = celestialBodies.find(b => b.id === nextStop.id);
        if (followBtn) followBtn.style.display = 'block';
        if (nextInfo) {
            nextInfo.textContent   = nextBody ? `PRÓXIMO: ${nextBody.name.toUpperCase()}` : '';
            nextInfo.style.display = 'block';
        }
    }
    msg.classList.add('visible');
}

function hideTourMsg() {
    const msg = document.getElementById('tour-center-msg');
    if (msg) msg.classList.remove('visible');
}

function showConfirmExitTour() {
    const dialog = document.getElementById('tour-confirm-exit');
    if (dialog) dialog.classList.add('visible');
}

function hideConfirmExitTour() {
    const dialog = document.getElementById('tour-confirm-exit');
    if (dialog) dialog.classList.remove('visible');
}

// ─── Overlay de Mensagem Central ─────────────────────────────────────────────

function showMsgOverlay(text, duration = 4000) {
    const el = document.getElementById('msg-overlay');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('fade-out');
    el.classList.add('visible');
    clearTimeout(maneuverMsgTimeout);
    maneuverMsgTimeout = setTimeout(() => {
        el.classList.add('fade-out');
        setTimeout(() => el.classList.remove('visible', 'fade-out'), 700);
    }, duration);
}

// ─── Navegação com Visual de Dobra ───────────────────────────────────────────

function navigateWithWarp(body, tgtScale) {
    // Stop any ongoing propulsion before navigating
    isLightSpeed           = false;
    lightspeedDecelerating = false;
    lightspeedDecelStart   = null;
    if (warpOffTimeout) { clearTimeout(warpOffTimeout); warpOffTimeout = null; }
    updateFreeLightspeedBtn();

    const panel     = document.getElementById('planet-detail-panel');
    const panelOpen = panel && panel.classList.contains('open');

    const doWarp = () => {
        isWarpVisual = true;
        const curKm = scrollPos * currentScale;
        lastShownWaypointIdx = journeyWaypoints.reduce((acc, wp, i) =>
            wp.km <= curKm ? i : acc, -1);

        const animDur = 5000;
        const warpEnd = () => {
            isWarpVisual = false;
            if (panelOpen) openPlanetDetail(body);
        };

        if (body.dist >= curKm) {
            // Destino à frente: 1s de viagem real, depois animação longa com ease-out
            isLightSpeed = true;
            warpOffTimeout = setTimeout(() => {
                if (!isWarpVisual) return;
                isLightSpeed = false;
                warpOffTimeout = setTimeout(() => { isWarpVisual = false; }, animDur - 1000);
                startProgrammedAnim(body.dist, tgtScale, warpEnd, animDur, easeOutCubic);
            }, 1000);
        } else {
            // Destino atrás: sem drift — animação longa com ease-out
            warpOffTimeout = setTimeout(() => { isWarpVisual = false; }, animDur - 1000);
            startProgrammedAnim(body.dist, tgtScale, warpEnd, animDur, easeOutCubic);
        }
    };

    // If currently zoomed in, zoom out to 3000 first, then warp
    if (currentScale < 3000) {
        startProgrammedAnim(scrollPos * currentScale, 3000, doWarp);
    } else {
        doWarp();
    }
}

// ─── Estado do Botão de Dobra (modo livre) ────────────────────────────────────

function updateFreeLightspeedBtn() {
    if (tourActive) return;
    const btn  = document.getElementById('lightspeed-btn');
    const text = document.getElementById('lightspeed-text');
    if (!btn || !text) return;
    if (isLightspeedManual) {
        text.innerText = 'PARAR';
        btn.classList.add('active');
    } else {
        text.innerText = '';
        btn.classList.remove('active');
    }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

window.onload = async () => {
    await loadData();
    init();
};
