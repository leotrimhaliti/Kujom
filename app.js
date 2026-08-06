// ============================================================
// ku jom? — a Kosovo geography game
// ============================================================

(() => {
  "use strict";

  const CFG = window.KUJOM_CONFIG || {};
  const ROUNDS = CFG.roundsPerGame || 5;
  const MAX_SCORE = CFG.maxScore || 5000;
  const FALLOFF_KM = CFG.falloffKm || 15;

  const KOSOVO_CENTER = [42.56, 20.9];
  // whole-country view, so the map reads at any size
  const KOSOVO_BOUNDS = [[41.85, 20.0], [43.27, 21.81]];
  const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
  const TILE_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

  // ---------- state ----------
  let locations = []; // [[lat, lng, panoId], ...]
  let gameRoundIndices = []; // indices into locations for this game
  let roundIndex = 0;
  let totalScore = 0;
  let roundResults = []; // { distKm, points }
  let guessLatLng = null;
  let challenge = null; // { indices, score } when opened via party link

  const currentLoc = () => locations[gameRoundIndices[roundIndex]];

  let guessMap = null;
  let guessMarker = null;
  let resultMap = null;
  let userAdjustedMap = false; // once you pan/zoom, stop auto-fitting
  let fittingBounds = false;

  // ---------- dom ----------
  const $ = (id) => document.getElementById(id);
  const screens = {
    home: $("screen-home"),
    game: $("screen-game"),
    result: $("screen-result"),
    final: $("screen-final"),
  };

  function show(name) {
    Object.entries(screens).forEach(([key, el]) => {
      const active = key === name || (name !== "home" && key === "game" && (name === "result" || name === "final"));
      el.classList.toggle("is-active", active);
      el.setAttribute("aria-hidden", String(!active));
    });
  }

  // ---------- utils ----------
  function haversineKm(a, b) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function scoreFor(distKm) {
    if (distKm < 0.05) return MAX_SCORE;
    return Math.round(MAX_SCORE * Math.exp(-distKm / FALLOFF_KM));
  }

  function fmtDistance(km) {
    if (km < 1) return `${Math.round(km * 1000)} m`;
    if (km < 10) return `${km.toFixed(1)} km`;
    return `${Math.round(km)} km`;
  }

  function fmtPts(n) {
    return n.toLocaleString("en-US");
  }

  function sampleIndices(count, max) {
    const seen = new Set();
    while (seen.size < Math.min(count, max)) {
      seen.add(Math.floor(Math.random() * max));
    }
    return [...seen];
  }

  // ---------- party links ----------
  // rounds are encoded as fixed-width base36 indices: #c=07x1b20aa39z07q&s=18340
  function encodeChallenge() {
    const code = gameRoundIndices.map((i) => i.toString(36).padStart(3, "0")).join("");
    return `${location.origin}${location.pathname}#c=${code}&s=${totalScore}`;
  }

  function parseChallenge() {
    const params = new URLSearchParams(location.hash.slice(1));
    const code = params.get("c");
    if (!code || code.length % 3 !== 0) return null;
    const indices = [];
    for (let i = 0; i < code.length; i += 3) {
      const idx = parseInt(code.slice(i, i + 3), 36);
      if (Number.isNaN(idx) || idx < 0 || idx >= locations.length) return null;
      indices.push(idx);
    }
    if (!indices.length || indices.length > 10) return null;
    const score = Math.max(0, parseInt(params.get("s") || "0", 10) || 0);
    return { indices, score };
  }

  function panoUrl(loc) {
    const [lat, lng, panoId] = loc;
    const heading = Math.floor(Math.random() * 360);
    if (CFG.googleApiKey) {
      return (
        `https://www.google.com/maps/embed/v1/streetview` +
        `?key=${encodeURIComponent(CFG.googleApiKey)}` +
        `&pano=${encodeURIComponent(panoId)}` +
        `&heading=${heading}&pitch=0&fov=100`
      );
    }
    // keyless share embed fallback — !5f0 gives the widest (original) view
    return (
      `https://www.google.com/maps/embed?pb=` +
      `!4v${Date.now()}!6m8!1m7!1s${encodeURIComponent(panoId)}` +
      `!2m2!1d${Number(lat)}!2d${Number(lng)}` +
      `!3f${heading}!4f0!5f0`
    );
  }

  const pinIcon = (cls) =>
    L.divIcon({ className: "", html: `<div class="pin ${cls}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });

  // ---------- landing dot map ----------
  function drawDotMap() {
    const canvas = $("dotmap");
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (!locations.length) return;

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const [lat, lng] of locations) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }

    // fit into canvas, correcting for latitude squish, leaving margin
    const margin = Math.min(w, h) * 0.12;
    const latSpan = maxLat - minLat;
    const lngSpan = (maxLng - minLng) * Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
    const scale = Math.min((w - margin * 2) / lngSpan, (h - margin * 2) / latSpan);
    const ox = (w - lngSpan * scale) / 2;
    const oy = (h - latSpan * scale) / 2;

    const pts = locations.map(([lat, lng]) => [
      ox + (lng - minLng) * Math.cos((lat * Math.PI) / 180) * scale,
      oy + (maxLat - lat) * scale,
    ]);

    // draw progressively — the country sketches itself in
    let i = 0;
    const chunk = Math.ceil(pts.length / 70);
    ctx.fillStyle = "rgba(36, 67, 156, 0.5)";
    (function step() {
      const end = Math.min(i + chunk, pts.length);
      for (; i < end; i++) {
        ctx.fillRect(pts[i][0], pts[i][1], 1.8, 1.8);
      }
      if (i < pts.length) requestAnimationFrame(step);
    })();
  }

  // ---------- game flow ----------
  function startGame(forcedIndices) {
    gameRoundIndices = forcedIndices
      ? forcedIndices.slice()
      : challenge
        ? challenge.indices.slice()
        : sampleIndices(ROUNDS, locations.length);
    roundIndex = 0;
    totalScore = 0;
    roundResults = [];
    show("game");
    initGuessMap();
    loadRound();
  }

  function initGuessMap() {
    if (guessMap) return;
    guessMap = L.map("guess-map", {
      center: KOSOVO_CENTER,
      zoom: 8,
      zoomControl: false,
      attributionControl: true,
      tap: false, // let our own tap-to-expand handler run first
    });
    L.control.zoom({ position: "topright" }).addTo(guessMap);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 18 }).addTo(guessMap);

    guessMap.on("click", (e) => {
      guessLatLng = e.latlng;
      if (!guessMarker) {
        guessMarker = L.marker(e.latlng, { icon: pinIcon("pin-guess") }).addTo(guessMap);
      } else {
        guessMarker.setLatLng(e.latlng);
      }
      const btn = $("btn-guess");
      btn.disabled = false;
      btn.textContent = "Guess";
    });

    // any real interaction with the map means the player has chosen
    // their own view — never yank it back after that
    const mapEl = $("guess-map");
    ["pointerdown", "touchstart", "wheel", "dblclick"].forEach((ev) =>
      mapEl.addEventListener(ev, () => { userAdjustedMap = true; }, { passive: true })
    );

    // leaflet needs a size refresh when the card resizes.
    // NOTE: leaflet animates zoom with CSS transitions and transitionend
    // bubbles, so this must ignore anything coming from inside the map.
    const card = $("guess-card");
    card.addEventListener("transitionend", (e) => {
      if (e.target !== card && e.target !== mapEl) return;
      if (e.propertyName !== "width" && e.propertyName !== "height") return;
      refreshMapSize();
    });
    card.addEventListener("mouseenter", () => setTimeout(refreshMapSize, 260));
  }

  function fitKosovo() {
    if (!guessMap) return;
    fittingBounds = true;
    guessMap.fitBounds(KOSOVO_BOUNDS, { padding: [6, 6], animate: false });
    fittingBounds = false;
  }

  function renderPips() {
    const el = $("hud-pips");
    el.innerHTML = "";
    for (let i = 0; i < gameRoundIndices.length; i++) {
      const pip = document.createElement("span");
      pip.className = "pip" + (i < roundIndex ? " done" : i === roundIndex ? " now" : "");
      el.appendChild(pip);
    }
  }

  let introTimer = null;
  function flashRoundIntro() {
    const intro = $("round-intro");
    $("round-intro-num").textContent = `${roundIndex + 1} / ${gameRoundIndices.length}`;
    intro.classList.remove("show");
    void intro.offsetWidth; // restart transition
    intro.classList.add("show");
    clearTimeout(introTimer);
    introTimer = setTimeout(() => intro.classList.remove("show"), 1500);
  }

  function loadRound() {
    guessLatLng = null;
    if (guessMarker) {
      guessMarker.remove();
      guessMarker = null;
    }
    const btn = $("btn-guess");
    btn.disabled = true;
    btn.textContent = "Place a pin first";

    userAdjustedMap = false; // fresh round, fresh country-wide view
    fitKosovo();
    $("guess-card").classList.remove("open");

    $("hud-round").textContent = `Round ${roundIndex + 1} / ${gameRoundIndices.length}`;
    renderPips();
    flashRoundIntro();
    $("hud-score").textContent = `${fmtPts(totalScore)} pts`;
    $("pano").src = panoUrl(currentLoc());
  }

  function submitGuess() {
    if (!guessLatLng) return;
    const [lat, lng] = currentLoc();
    const actual = { lat, lng };
    const distKm = haversineKm(guessLatLng, actual);
    const points = scoreFor(distKm);
    totalScore += points;
    roundResults.push({ distKm, points });
    mpSendScore(roundIndex + 1);
    renderStandings($("result-standings"));

    // fill result card
    $("result-round-label").textContent = `Round ${roundIndex + 1} of ${gameRoundIndices.length}`;
    $("result-distance").textContent = `${fmtDistance(distKm)} away`;
    $("btn-next").textContent = roundIndex + 1 === gameRoundIndices.length ? "See final score" : "Next round";

    show("game");
    screens.result.classList.add("is-active");
    screens.result.setAttribute("aria-hidden", "false");

    // animated count-up + bar
    animateCount($("result-points"), points, 800);
    requestAnimationFrame(() => {
      $("score-fill").style.width = `${(points / MAX_SCORE) * 100}%`;
    });

    // result mini-map
    if (resultMap) {
      resultMap.remove();
      resultMap = null;
    }
    resultMap = L.map("result-map", { zoomControl: false });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 18 }).addTo(resultMap);
    L.marker(guessLatLng, { icon: pinIcon("pin-guess") }).addTo(resultMap);
    L.marker(actual, { icon: pinIcon("pin-actual") }).addTo(resultMap);
    L.polyline([guessLatLng, actual], {
      color: "#1b1813",
      weight: 2,
      dashArray: "5 7",
      opacity: 0.6,
    }).addTo(resultMap);
    resultMap.fitBounds(L.latLngBounds([guessLatLng, actual]).pad(0.35));
  }

  function nextRound() {
    $("score-fill").style.width = "0%";
    screens.result.classList.remove("is-active");
    screens.result.setAttribute("aria-hidden", "true");

    roundIndex++;
    if (roundIndex >= gameRoundIndices.length) {
      showFinal();
    } else {
      loadRound();
    }
  }

  function verdictFor(score) {
    const max = gameRoundIndices.length * MAX_SCORE;
    const r = score / max;
    if (r >= 0.9) return "Okay — you basically live there.";
    if (r >= 0.7) return "Very solid. Family in Kosovo, or just good instincts?";
    if (r >= 0.5) return "Respectable. You clearly know your way around.";
    if (r >= 0.25) return "Not bad — the mountains do all look alike.";
    return "Hey, at least the scenery was nice.";
  }

  function showFinal() {
    show("game");
    screens.final.classList.add("is-active");
    screens.final.setAttribute("aria-hidden", "false");

    animateCount($("final-score"), totalScore, 1100);
    $("final-verdict").textContent = verdictFor(totalScore);
    renderStandings($("final-standings"));
    setupFinalBoard();

    // challenge comparison
    const vs = $("final-vs");
    if (challenge && challenge.score > 0) {
      const won = totalScore > challenge.score;
      const tied = totalScore === challenge.score;
      vs.hidden = false;
      vs.className = "final-vs " + (won ? "won" : "lost");
      vs.textContent = tied
        ? `Dead tie with your friend — ${fmtPts(challenge.score)} each. Rematch?`
        : won
          ? `You beat your friend's ${fmtPts(challenge.score)}. Bragging rights secured.`
          : `Your friend's ${fmtPts(challenge.score)} still stands. Rematch?`;
    } else {
      vs.hidden = true;
    }

    const list = $("final-rounds");
    list.innerHTML = "";
    roundResults.forEach((r, i) => {
      const li = document.createElement("li");
      li.innerHTML =
        `<span class="r-label">Round ${i + 1} · ${fmtDistance(r.distKm)}</span>` +
        `<span class="r-bar"><i style="width:${(r.points / MAX_SCORE) * 100}%"></i></span>` +
        `<span class="r-pts">${fmtPts(r.points)}</span>`;
      list.appendChild(li);
    });

    // best score
    const best = Math.max(totalScore, Number(localStorage.getItem("kujom-best") || 0));
    localStorage.setItem("kujom-best", String(best));
    $("final-best").textContent =
      best === totalScore ? "New personal best!" : `Personal best: ${fmtPts(best)}`;
  }

  function playAgain() {
    // a rematch of a challenge/party is a fresh solo game
    challenge = null;
    if (MP.active) mpLeave();
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    screens.final.classList.remove("is-active");
    screens.final.setAttribute("aria-hidden", "true");
    startGame();
  }

  function shareChallenge() {
    const url = encodeChallenge();
    const text =
      `ku jom? — I scored ${fmtPts(totalScore)} on these exact 5 spots in Kosovo. ` +
      `Same locations, your turn:\n${url}`;
    shareText(text, $("btn-challenge"), "Party link copied — send it!", "Challenge a friend on these exact spots");
  }

  // landing-page party: live lobby when Supabase is configured,
  // otherwise fall back to a same-rounds async link
  function createParty() {
    if (mpAvailable()) {
      openLobby("create");
      return;
    }
    const indices = sampleIndices(ROUNDS, locations.length);
    const code = indices.map((i) => i.toString(36).padStart(3, "0")).join("");
    const url = `${location.origin}${location.pathname}#c=${code}`;
    const text = `ku jom? — five spots somewhere in Kosovo. Let's see who knows the country better:\n${url}`;

    // the host plays the exact same rounds they just shared
    challenge = { indices, score: 0 };
    history.replaceState(null, "", `#c=${code}`);

    $("home-sub").textContent =
      "Party link copied — send it to your friends. When you hit start, you'll play the same five spots they will.";
    $("btn-play").textContent = "Start playing the party rounds";

    shareText(text, $("btn-party"), "Link copied!", "Create a party link");
  }

  // native share sheet is great on phones, unreliable on desktop — clipboard there
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  async function shareText(text, btn, doneLabel, idleLabel) {
    if (isMobile && navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (_) {
        /* cancelled or failed — fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = doneLabel;
      setTimeout(() => (btn.textContent = idleLabel), 2000);
    } catch (_) {
      window.prompt("Copy this:", text);
    }
  }

  function shareResult() {
    const text =
      `ku jom? — I scored ${fmtPts(totalScore)} / ${fmtPts(gameRoundIndices.length * MAX_SCORE)} ` +
      `guessing where I was in Kosovo.\n${location.origin}${location.pathname}`;
    shareText(text, $("btn-share"), "Copied!", "Copy result");
  }

  // ============================================================
  // live parties (Supabase Realtime — presence + broadcast only,
  // no database tables involved)
  // ============================================================

  const MP = {
    client: null,
    channel: null,
    code: null,
    isHost: false,
    active: false, // in a live party (lobby or playing)
    me: { id: Math.random().toString(36).slice(2, 10), name: "" },
    totals: {}, // id -> { name, total, round, done }
  };
  let pendingPartyCode = null; // set when opened via #party=CODE

  const mpAvailable = () => Boolean(CFG.supabaseUrl && CFG.supabaseAnonKey);

  function loadSupabase() {
    if (window.supabase) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load Supabase SDK"));
      document.head.appendChild(s);
    });
  }

  // one client shared by realtime parties and the leaderboard
  async function getClient() {
    if (MP.client) return MP.client;
    await loadSupabase();
    MP.client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
    return MP.client;
  }

  // ---------- leaderboard ----------
  // party key for the game just played: live room, challenge link, or solo
  function partyKey() {
    if (MP.active && MP.code) return `p:${MP.code}`;
    const m = location.hash.match(/[#&]c=([0-9a-z]+)/);
    if (m) return `c:${m[1].slice(0, 20)}`;
    return null;
  }

  async function lbSubmit(name, score, rounds, party) {
    const db = await getClient();
    const { error } = await db.from("scores").insert({ name, score, rounds, party });
    if (error) throw error;
  }

  async function lbFetch(party, limit = 10) {
    const db = await getClient();
    let q = db.from("scores").select("name,score,rounds,created_at");
    q = party ? q.eq("party", party) : q.is("party", null);
    const { data, error } = await q
      .order("score", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  function renderBoard(listEl, emptyEl, rows, emptyMsg, highlightName) {
    listEl.innerHTML = "";
    if (!rows.length) {
      listEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.textContent = emptyMsg;
      return;
    }
    emptyEl.hidden = true;
    listEl.hidden = false;
    rows.forEach((r, i) => {
      const li = document.createElement("li");
      li.className = `medal-${i + 1}`;
      if (highlightName && r.name === highlightName) li.classList.add("me");
      li.innerHTML =
        `<span class="s-rank">${i + 1}</span>` +
        `<span class="s-name">${escapeHtml(safeName(r.name))}</span>` +
        `<span class="s-pts">${fmtPts(safeInt(r.score, 0, 50000))}</span>`;
      listEl.appendChild(li);
    });
  }

  // --- final screen board ---
  let lbSubmitted = false;
  let lbTab = "party";

  function setupFinalBoard() {
    if (!mpAvailable()) return;
    const block = $("lb-block");
    block.hidden = false;
    lbSubmitted = false;
    const party = partyKey();
    lbTab = party ? "party" : "global";

    $("lb-submit").hidden = false;
    $("lb-tabs").hidden = !party;
    $("lb-list").hidden = true;
    $("lb-empty").hidden = true;
    $("lb-name").value = localStorage.getItem("kujom-name") || MP.me.name || "";
    $("btn-lb-submit").disabled = false;
    $("btn-lb-submit").textContent = "Save score";

    document.querySelectorAll(".lb-tab").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.tab === lbTab);
    });
  }

  async function submitAndShow() {
    const btn = $("btn-lb-submit");
    const name = $("lb-name").value.trim().slice(0, 20);
    if (!name) {
      $("lb-name").focus();
      return;
    }
    localStorage.setItem("kujom-name", name);
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      if (!lbSubmitted) {
        await lbSubmit(name, totalScore, gameRoundIndices.length, partyKey());
        lbSubmitted = true;
      }
      $("lb-submit").hidden = true;
      await refreshFinalBoard();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = "Couldn't save — retry";
    }
  }

  async function refreshFinalBoard() {
    const list = $("lb-list");
    const empty = $("lb-empty");
    const party = partyKey();
    const name = localStorage.getItem("kujom-name") || "";
    empty.hidden = false;
    empty.textContent = "Loading…";
    list.hidden = true;
    try {
      const rows = await lbFetch(lbTab === "party" ? party : null, 10);
      renderBoard(
        list,
        empty,
        rows,
        lbTab === "party" ? "Nobody else has played this link yet." : "No scores yet — you're the first.",
        name
      );
    } catch (err) {
      console.error(err);
      empty.textContent = "Couldn't load the leaderboard.";
    }
  }

  // --- landing board ---
  async function openGlobalBoard() {
    const el = $("screen-lb");
    el.classList.add("is-active");
    el.setAttribute("aria-hidden", "false");
    const list = $("lb-global-list");
    const empty = $("lb-global-empty");
    empty.hidden = false;
    empty.textContent = "Loading…";
    list.hidden = true;
    try {
      const rows = await lbFetch(null, 10);
      renderBoard(list, empty, rows, "No scores yet — be the first.", localStorage.getItem("kujom-name"));
    } catch (err) {
      console.error(err);
      empty.textContent = "Couldn't load the leaderboard.";
    }
  }

  function closeGlobalBoard() {
    const el = $("screen-lb");
    el.classList.remove("is-active");
    el.setAttribute("aria-hidden", "true");
  }

  function lobbyEls() {
    return {
      screen: $("screen-lobby"),
      kicker: $("lobby-kicker"),
      code: $("lobby-code"),
      nameRow: $("lobby-name-row"),
      name: $("lobby-name"),
      go: $("btn-lobby-go"),
      room: $("lobby-room"),
      players: $("lobby-players"),
      copy: $("btn-lobby-copy"),
      start: $("btn-lobby-start"),
      wait: $("lobby-wait"),
    };
  }

  function openLobby(mode) {
    const el = lobbyEls();
    MP.isHost = mode === "create";
    MP.code = MP.isHost
      ? Math.random().toString(36).slice(2, 6).toUpperCase()
      : pendingPartyCode;

    el.kicker.textContent = MP.isHost ? "your party room" : "joining party";
    el.code.textContent = MP.code;
    el.nameRow.hidden = false;
    el.room.hidden = true;
    el.go.textContent = MP.isHost ? "Open the room" : "Join the room";
    el.name.value = localStorage.getItem("kujom-name") || "";
    el.screen.classList.add("is-active");
    el.screen.setAttribute("aria-hidden", "false");
    el.name.focus();
  }

  function closeLobby() {
    const el = lobbyEls();
    el.screen.classList.remove("is-active");
    el.screen.setAttribute("aria-hidden", "true");
  }

  async function connectLobby() {
    const el = lobbyEls();
    const name = el.name.value.trim() || "Anonymous";
    MP.me.name = name;
    localStorage.setItem("kujom-name", name);
    el.go.disabled = true;
    el.go.textContent = "Connecting…";

    try {
      await getClient();
      MP.channel = MP.client.channel(`kujom:${MP.code}`, {
        config: { presence: { key: MP.me.id }, broadcast: { self: false } },
      });

      MP.channel
        .on("presence", { event: "sync" }, renderLobbyPlayers)
        .on("broadcast", { event: "start" }, ({ payload }) => {
          if (MP.isHost) return;
          const indices = safeIndices(payload && payload.indices);
          if (!indices) return; // malformed or hostile — ignore
          mpBeginGame(indices);
        })
        .on("broadcast", { event: "score" }, ({ payload }) => {
          if (!payload || typeof payload.id !== "string") return;
          const rounds = gameRoundIndices.length || ROUNDS;
          MP.totals[payload.id.slice(0, 40)] = {
            id: payload.id.slice(0, 40),
            name: safeName(payload.name),
            total: safeInt(payload.total, 0, rounds * MAX_SCORE),
            round: safeInt(payload.round, 0, rounds),
            done: Boolean(payload.done),
          };
          renderStandings($("result-standings"));
          renderStandings($("final-standings"));
        });

      MP.channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await MP.channel.track({ name: MP.me.name, host: MP.isHost });
          MP.active = true;
          MP.totals = {};
          el.nameRow.hidden = true;
          el.room.hidden = false;
          el.start.hidden = !MP.isHost;
          el.wait.hidden = MP.isHost;
          el.go.disabled = false;
          renderLobbyPlayers();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          el.go.disabled = false;
          el.go.textContent = "Connection failed — retry";
        }
      });
    } catch (err) {
      console.error(err);
      el.go.disabled = false;
      el.go.textContent = "Connection failed — retry";
    }
  }

  function renderLobbyPlayers() {
    if (!MP.channel) return;
    const el = lobbyEls();
    const state = MP.channel.presenceState();
    el.players.innerHTML = "";
    let count = 0;
    for (const [id, metas] of Object.entries(state)) {
      const meta = metas[0];
      if (!meta) continue;
      count++;
      const li = document.createElement("li");
      if (meta.host) li.classList.add("host");
      li.innerHTML =
        `<span>${escapeHtml(safeName(meta.name))}${id === MP.me.id ? " (you)" : ""}</span>` +
        (meta.host ? `<span class="host-tag">host</span>` : "");
      el.players.appendChild(li);
    }
    el.start.disabled = count < 1;
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  // ---- untrusted input hardening ----
  // anyone who knows a room code can join and broadcast anything,
  // so every payload from the wire gets coerced and clamped.
  function safeName(v) {
    const s = String(v ?? "").trim().slice(0, 20);
    return s || "Anonymous";
  }

  function safeInt(v, min, max, fallback = 0) {
    const n = Math.trunc(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function safeIndices(v) {
    if (!Array.isArray(v) || v.length < 1 || v.length > 10) return null;
    const out = [];
    for (const raw of v) {
      const n = Math.trunc(Number(raw));
      if (!Number.isFinite(n) || n < 0 || n >= locations.length) return null;
      out.push(n);
    }
    return out;
  }

  function mpBeginGame(indices) {
    closeLobby();
    challenge = null;
    startGame(indices);
  }

  function mpStart() {
    const indices = sampleIndices(ROUNDS, locations.length);
    MP.channel.send({ type: "broadcast", event: "start", payload: { indices } });
    mpBeginGame(indices);
  }

  function mpSendScore(roundDone) {
    if (!MP.active || !MP.channel) return;
    const payload = {
      id: MP.me.id,
      name: MP.me.name,
      total: totalScore,
      round: roundDone,
      done: roundDone >= gameRoundIndices.length,
    };
    MP.totals[MP.me.id] = payload;
    MP.channel.send({ type: "broadcast", event: "score", payload });
  }

  function renderStandings(el) {
    if (!MP.active) {
      el.hidden = true;
      return;
    }
    const rows = Object.values(MP.totals).sort((a, b) => b.total - a.total);
    if (rows.length < 2) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = "";
    rows.forEach((r, i) => {
      const li = document.createElement("li");
      if (r.id === MP.me.id) li.classList.add("me");
      const rounds = gameRoundIndices.length;
      li.innerHTML =
        `<span class="s-rank">${i + 1}</span>` +
        `<span class="s-name">${escapeHtml(r.name)}</span>` +
        `<span class="s-status">${
          r.done ? "finished" : `round ${safeInt(r.round, 0, rounds)}/${rounds}`
        }</span>` +
        `<span class="s-pts">${fmtPts(safeInt(r.total, 0, rounds * MAX_SCORE))}</span>`;
      el.appendChild(li);
    });
  }

  function mpLeave() {
    if (MP.channel) {
      MP.channel.unsubscribe();
      MP.channel = null;
    }
    MP.active = false;
    MP.isHost = false;
    MP.totals = {};
    pendingPartyCode = null;
    closeLobby();
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }

  function copyInvite() {
    const url = `${location.origin}${location.pathname}#party=${MP.code}`;
    shareText(
      `ku jom? — join my party, we're guessing spots in Kosovo. Room ${MP.code}:\n${url}`,
      $("btn-lobby-copy"),
      "Invite copied!",
      "Copy invite link"
    );
  }

  function animateCount(el, target, ms) {
    const start = performance.now();
    (function tick(now) {
      const t = Math.min((now - start) / ms, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmtPts(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(tick);
    })(performance.now());
  }

  // ---------- wiring ----------
  $("btn-play").addEventListener("click", () => {
    if (pendingPartyCode && mpAvailable()) openLobby("join");
    else startGame();
  });
  $("btn-guess").addEventListener("click", submitGuess);
  $("btn-next").addEventListener("click", nextRound);
  $("btn-again").addEventListener("click", playAgain);
  $("btn-share").addEventListener("click", shareResult);
  $("btn-challenge").addEventListener("click", shareChallenge);
  $("btn-party").addEventListener("click", createParty);
  $("btn-lobby-go").addEventListener("click", connectLobby);
  $("lobby-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") connectLobby();
  });
  $("btn-lobby-copy").addEventListener("click", copyInvite);
  $("btn-lobby-start").addEventListener("click", mpStart);
  $("btn-lobby-leave").addEventListener("click", mpLeave);

  $("btn-view-lb").addEventListener("click", openGlobalBoard);
  $("btn-lb-close").addEventListener("click", closeGlobalBoard);
  $("btn-lb-submit").addEventListener("click", submitAndShow);
  $("lb-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAndShow();
  });
  document.querySelectorAll(".lb-tab").forEach((b) => {
    b.addEventListener("click", () => {
      lbTab = b.dataset.tab;
      document.querySelectorAll(".lb-tab").forEach((x) => x.classList.toggle("is-on", x === b));
      refreshFinalBoard();
    });
  });

  // on touch layouts the collapsed mini-map expands when tapped
  const miniQuery = window.matchMedia("(max-width: 720px), (hover: none) and (pointer: coarse)");
  const isMini = () => miniQuery.matches;

  function refreshMapSize() {
    if (!guessMap) return;
    const settle = () => {
      if (!guessMap) return;
      guessMap.invalidateSize();
      // only re-frame while the player hasn't touched the map yet
      if (!guessLatLng && !userAdjustedMap) fitKosovo();
    };
    settle();
    setTimeout(settle, 60);
    setTimeout(settle, 320);
  }

  $("guess-card").addEventListener("click", () => {
    const card = $("guess-card");
    if (!isMini() || card.classList.contains("open")) return;
    card.classList.add("open");
    refreshMapSize();
  });

  $("btn-close-map").addEventListener("click", (e) => {
    e.stopPropagation();
    $("guess-card").classList.remove("open");
    refreshMapSize();
  });

  miniQuery.addEventListener("change", refreshMapSize);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && screens.result.classList.contains("is-active")) nextRound();
    else if (e.key === "Enter" && screens.game.classList.contains("is-active") && guessLatLng) submitGuess();
  });

  // redraw the dot map whenever its box changes (orientation, font load, resize)
  if (window.ResizeObserver) {
    let raf = null;
    new ResizeObserver(() => {
      if (!screens.home.classList.contains("is-active")) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(drawDotMap);
    }).observe($("dotmap"));
  } else {
    window.addEventListener("resize", () => {
      if (screens.home.classList.contains("is-active")) drawDotMap();
    });
  }

  // ---------- boot ----------
  function boot(data) {
    locations = data;
    $("loc-count").textContent = locations.length.toLocaleString("en-US");
    drawDotMap();

    // opened via a live party invite?
    const partyMatch = location.hash.match(/^#party=([A-Za-z0-9]{4,8})$/);
    if (partyMatch && mpAvailable()) {
      pendingPartyCode = partyMatch[1].toUpperCase();
      $("home-kicker").textContent = "party invite";
      $("home-sub").textContent =
        `You've been invited to party room ${pendingPartyCode}. ` +
        `Everyone plays the same five spots at the same time, live scoreboard included.`;
      $("btn-play").textContent = "Join the party";
      $("btn-party").hidden = true;
      return;
    }
    if (partyMatch && !mpAvailable()) {
      $("home-sub").textContent =
        "This is a live party link, but live mode isn't enabled on this copy of the game. You can still play a regular round.";
      return;
    }

    // opened via a challenge link?
    challenge = parseChallenge();
    if (challenge) {
      $("home-kicker").textContent = "you've been challenged";
      $("home-sub").textContent = challenge.score
        ? `A friend scored ${fmtPts(challenge.score)} points on five specific spots in Kosovo. ` +
          `You'll play the exact same locations. Beat them.`
        : `A friend picked five spots in Kosovo for you. You'll play the exact same locations they did.`;
      $("btn-play").textContent = "Accept the challenge";
      $("btn-party").hidden = true;
    }
  }

  if (Array.isArray(window.KUJOM_LOCATIONS)) {
    // loaded via <script src="data/locations.js"> — works even from file://
    boot(window.KUJOM_LOCATIONS);
  } else {
    fetch("data/locations.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(boot)
      .catch((err) => {
        $("loc-count").textContent = "error loading locations";
        console.error("Could not load locations — check data/locations.js is present", err);
      });
  }
})();
