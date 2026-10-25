// Tempo tap-to-talk page. Talks to the ElevenLabs "Tempo" agent with a short-lived token from token_server.py.
// The phone key arrives once in the link's #fragment, is kept on this phone only, and is sent as a header
// when asking the laptop for a token. No ElevenLabs key ever reaches this page.
(() => {
  "use strict";
  const { Conversation } = window.ElevenLabsClient;
  const $ = (id) => document.getElementById(id);
  const talk = $("talk"), statusEl = $("status"), captions = $("captions"), banner = $("banner"), connEl = $("conn");
  const typeform = $("typeform"), typed = $("typed");

  const WEBRTC_WAIT_MS = 4000;  // venue Wi-Fi that blocks WebRTC: fall back to WebSocket after this
  const KEY_STORE = "tempoPhoneKey", LANG_STORE = "tempoLang";
  // Only the language is overridden per call. Per-language greetings belong in the agent's language_presets
  // (owned by the voice-setup session); a first_message override here was rejected by ElevenLabs (1008).

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: key lives for this tab only */ } },
  };

  // ---------- phone key from the link ----------
  let phoneKey = null;
  const m = location.hash.match(/[#&]k=([A-Za-z0-9_-]{16,})/);
  if (m) {
    phoneKey = m[1];
    store.set(KEY_STORE, phoneKey);
    history.replaceState(null, "", location.pathname);  // keep the key out of screenshots and the address bar
  } else {
    phoneKey = store.get(KEY_STORE);
  }

  // ---------- small UI helpers ----------
  function showBanner(text, kind = "err") {
    banner.textContent = text;
    banner.className = `banner ${kind}`;
  }
  function hideBanner() { banner.className = "banner hidden"; }
  function setState(state, label, status) {
    talk.dataset.state = state;
    talk.textContent = label;
    if (status !== undefined) statusEl.textContent = status;
  }
  function addLine(role, text) {
    const div = document.createElement("div");
    div.className = `line ${role}`;
    div.textContent = text;
    captions.appendChild(div);
    div.scrollIntoView({ block: "end", behavior: "smooth" });
    return div;
  }

  // ---------- where are we running? ----------
  const ua = navigator.userAgent;
  const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|GSA\/|Snapchat|LinkedInApp/i.test(ua);
  const standalone = window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  if (!window.isSecureContext) {
    showBanner("This page must be opened with https:// for the microphone to work.");
  } else if (inApp) {
    showBanner("Open this link in Safari (tap ••• or the compass icon → Open in Safari). The microphone doesn't work inside this app.", "warn");
  } else if (standalone) {
    showBanner("For the microphone, open this in a normal Safari tab rather than from the Home Screen icon.", "warn");
  } else if (!phoneKey) {
    showBanner("This page needs your personal Kairos link. Open the link you were sent once, on this phone.");
  }

  // ---------- language chips ----------
  let lang = store.get(LANG_STORE) || "en";
  const chips = [...document.querySelectorAll(".chip")];
  function paintChips() { chips.forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.lang === lang))); }
  chips.forEach((c) => c.addEventListener("click", () => {
    if (conv) return;  // language is fixed for a call; change it between calls
    lang = c.dataset.lang;
    store.set(LANG_STORE, lang);
    paintChips();
  }));
  paintChips();

  // ---------- tokens ----------
  async function getCredential(mode) {
    const r = await fetch("token", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Tempo-Phone-Key": phoneKey || "" },
      body: JSON.stringify({ mode }),
      cache: "no-store",
    });
    let body = {};
    try { body = await r.json(); } catch { /* not JSON: tunnel or laptop problem */ }
    if (!r.ok) throw new Error(body.error || `The laptop said ${r.status}.`);
    return body;
  }

  // ---------- the call ----------
  let conv = null, attempt = 0, toolLine = null, pendingText = null, connectedVia = "";

  function callbacks(myAttempt) {
    const mine = () => myAttempt === attempt;
    return {
      onConnect: () => {
        if (!mine()) return;
        hideBanner();
        connEl.textContent = connectedVia;
        setState("listening", "Stop", "Listening… just speak.");
        if (pendingText) { conv?.sendUserMessage(pendingText); pendingText = null; }
        if (pendingResult) { conv?.sendContextualUpdate(pendingResult); pendingResult = null; }
      },
      onDisconnect: (details) => {
        if (!mine()) return;
        conv = null;
        connEl.textContent = "voice";
        const why = details && details.reason;
        setState("idle", "Tap to talk",
          why === "error" ? "The call dropped. Tap to try again." :
          why === "agent" ? "Kairos ended the call. Tap to talk again." : "Call ended. Tap to talk again.");
        if (why === "error" && details.message) showBanner(details.message);
      },
      onError: (message) => { if (mine()) showBanner(String(message || "Something went wrong.")); },
      onModeChange: ({ mode }) => {
        if (!mine() || !conv) return;
        if (mode === "speaking") setState("speaking", "Stop", "Kairos is speaking… (you can interrupt)");
        else setState("listening", "Stop", "Listening… just speak.");
      },
      onMessage: (p) => {
        if (!mine() || !p || !p.message) return;
        const role = p.role || (p.source === "ai" ? "agent" : "user");
        addLine(role === "agent" ? "agent" : "user", p.message);
      },
      onAgentToolRequest: (t) => {
        if (!mine()) return;
        if (t && t.tool_name === "phone_task") {
          toolLine = addLine("tool", "Working on your phone… you'll see it move, then it comes back here.");
          return;
        }
        toolLine = addLine("tool", `Checking your hub… (${(t && t.tool_name) || "tool"})`);
      },
      onAgentToolResponse: (t) => {
        if (!mine()) return;
        const failed = t && (t.is_error === true);
        if (t && t.tool_name === "phone_task") {
          if (toolLine) { toolLine.textContent = failed ? "The phone task didn't start." : "Phone task handed over."; toolLine = null; }
          if (!failed) checkPhoneTask(true);
          return;
        }
        const text = failed ? "The hub didn't answer." : "Hub answered.";
        if (toolLine) { toolLine.textContent = text; toolLine = null; } else addLine("tool", text);
      },
    };
  }

  // ---------- phone tasks (the local model acting on this iPhone through iCTRL) ----------
  // The webhook answers within 20 s. If the task was still running then, its result reaches the voice
  // agent here, as a contextual update, once it finishes (or on the next call if this one dropped while
  // the phone was busy in another app).
  let watchedTask = null, pendingResult = null, pollTimer = null;

  async function latestPhoneTask() {
    const r = await fetch("phone-task/latest", { headers: { "X-Tempo-Phone-Key": phoneKey || "" }, cache: "no-store" });
    return r.ok ? r.json() : null;
  }

  function deliver(task) {
    const steps = (task.steps || []).join(" → ");
    if (steps) addLine("tool", `Phone: ${steps}`);
    const update = `Phone task result: ${task.answer || "it didn't finish."}`;
    if (conv) conv.sendContextualUpdate(update);
    else { pendingResult = update; statusEl.textContent = "Your phone task finished. Tap to hear the result."; }
  }

  async function checkPhoneTask(justAnswered) {
    clearTimeout(pollTimer);
    let task;
    try { task = await latestPhoneTask(); } catch { task = null; }
    if (!task || task.status === "none") return;
    if (justAnswered) {
      // Already finished when the tool answered -> the agent got the answer in the tool reply itself.
      if (task.status !== "running") return;
      watchedTask = task.id;
    }
    if (task.id !== watchedTask) return;
    if (task.status === "running") { pollTimer = setTimeout(() => checkPhoneTask(false), 1500); return; }
    watchedTask = null;
    deliver(task);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && watchedTask) checkPhoneTask(false);
  });

  function sessionOptions(extra) {
    const overrides = lang === "en" ? undefined : { agent: { language: lang } };
    return { ...extra, ...(overrides ? { overrides } : {}), libsampleratePath: "vendor/libsamplerate.worklet.js" };
  }

  function withTimeout(promise, ms) {
    let t;
    return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error("timeout")), ms); })])
      .finally(() => clearTimeout(t));
  }

  async function start() {
    if (!phoneKey) { showBanner("This page needs your personal Kairos link. Open the link you were sent once, on this phone."); return; }
    hideBanner();
    const myAttempt = ++attempt;
    setState("connecting", "Connecting…", "Connecting… allow the microphone if asked.");
    try {
      // Ask for the mic first, inside the tap, so iOS shows its prompt now and the 4 s WebRTC wait
      // below doesn't include the time someone spends reading the prompt.
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch (e) {
      if (myAttempt !== attempt) return;
      setState("idle", "Tap to talk", "");
      if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) {
        showBanner("Microphone blocked. Tap “aA” in Safari's address bar → Website Settings → Microphone → Allow, then reload. (Or Settings → Apps → Safari → Microphone.)");
      } else if (e && e.name === "NotFoundError") {
        showBanner("No microphone found on this device.");
      } else {
        showBanner("Couldn't start the microphone: " + (e && e.message ? e.message : e));
      }
      return;
    }

    // 1) WebRTC (best audio). 2) If that hasn't connected in 4 s, WebSocket.
    try {
      const { token } = await getCredential("webrtc");
      if (myAttempt !== attempt) return;
      connectedVia = "voice · WebRTC";
      const p = Conversation.startSession(sessionOptions({ conversationToken: token, connectionType: "webrtc", ...callbacks(myAttempt) }));
      p.then((c) => { if (myAttempt !== attempt) c.endSession(); });  // late connection after we gave up on it
      conv = await withTimeout(p, WEBRTC_WAIT_MS);
      return;
    } catch (e) {
      if (myAttempt !== attempt) return;
      if (e && e.message !== "timeout" && /laptop|link|calls|tries|set up|ElevenLabs said/i.test(e.message)) {
        setState("idle", "Tap to talk", "");
        showBanner(e.message);
        return;
      }
      // WebRTC failed or was slow: fall through to WebSocket.
    }
    const wsAttempt = ++attempt;  // anything the WebRTC attempt still does is now ignored
    try {
      setState("connecting", "Connecting…", "Trying another way to connect…");
      const { signed_url } = await getCredential("websocket");
      if (wsAttempt !== attempt) return;
      connectedVia = "voice · WebSocket";
      conv = await Conversation.startSession(sessionOptions({ signedUrl: signed_url, connectionType: "websocket", ...callbacks(wsAttempt) }));
    } catch (e) {
      if (wsAttempt !== attempt) return;
      conv = null;
      setState("idle", "Tap to talk", "");
      showBanner("Couldn't connect: " + (e && e.message ? e.message : e) + ". Check the Wi-Fi, or try your phone's mobile data.");
    }
  }

  async function stop() {
    const c = conv;
    attempt++;
    conv = null;
    setState("idle", "Tap to talk", "Call ended. Tap to talk again.");
    connEl.textContent = "voice";
    if (c) { try { await c.endSession(); } catch { /* already closed */ } }
  }

  talk.addEventListener("click", () => {
    if (talk.dataset.state === "idle") start();
    else stop();
  });

  typeform.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = typed.value.trim();
    if (!text) return;
    typed.value = "";
    if (conv) {
      conv.sendUserMessage(text);
      addLine("user", text);
    } else {
      pendingText = text;  // start a call, then send this as soon as it connects
      addLine("user", text);
      if (talk.dataset.state === "idle") start();
    }
  });

  // ---------- "Tempo's agents" box: typed or keyboard-dictated requests, no voice call needed ----------
  // Goes straight to the Mac's agents (auto: laptop / phone / database / several in parallel). The answer is
  // read aloud with the phone's own speech, so this path doesn't use ElevenLabs.
  const agentform = $("agentform"), agentask = $("agentask"), agentstatus = $("agentstatus");
  function speak(text) {
    try { const u = new SpeechSynthesisUtterance(text); u.lang = lang === "cy" ? "cy-GB" : lang === "te" ? "te-IN" : "en-GB"; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* no speech: text is on screen */ }
  }
  async function waitForResult(id) {
    for (let i = 0; i < 60; i++) {  // the page may have been in the background while the phone agent worked
      const t = await latestPhoneTask().catch(() => null);
      if (t && t.id === id && t.status !== "running") return t;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
  }
  agentform.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const task = agentask.value.trim();
    if (!task || !phoneKey) { if (!phoneKey) showBanner("This page needs your personal Kairos link."); return; }
    agentask.blur();
    agentstatus.textContent = "Working on it… (if it's a phone task, you'll see the phone move, then come back here)";
    let res = null;
    try {
      const r = await fetch("phone-task", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Tempo-Phone-Key": phoneKey },
        body: JSON.stringify({ task, device: "auto", wait: 50 }) });
      res = await r.json();
      if (!r.ok) throw new Error(res.error || r.status);
    } catch (e) {
      const t = await latestPhoneTask().catch(() => null);  // the reply may have been lost while backgrounded
      res = t && t.task === task ? { status: t.status, task_id: t.id, answer: t.answer } : { status: "error", answer: "Couldn't reach Kairos: " + (e.message || e) };
    }
    if (res.status === "running") {
      agentstatus.textContent = "Still working…";
      const t = await waitForResult(res.task_id);
      res = t ? { status: t.status, answer: t.answer, steps: t.steps } : { status: "error", answer: "It's taking too long. Try again." };
    }
    const t = await latestPhoneTask().catch(() => null);
    const steps = t && t.answer === res.answer && t.steps ? "\n" + t.steps.join(" → ") : "";
    agentstatus.textContent = (res.answer || res.message || "No answer.") + steps;
    speak(res.answer || res.message || "No answer.");
    agentask.value = "";
  });

  // ---------- "Read a letter": photo -> the laptop's letter reader agent -> spoken explanation ----------
  // The photo is shrunk here (max 1600 px, JPEG) so it crosses venue Wi-Fi quickly, posted as base64 JSON to
  // /voice/agents/document/interpret (phone key), and never shown or kept. Audio comes back when Gemini's voice
  // is available; otherwise the phone reads the text with its own voice.
  const letterfile = $("letterfile"), letterlang = $("letterlang"), dialect = $("dialect"), lettersteps = $("lettersteps");
  const letterresult = $("letterresult"), lettertext = $("lettertext"), letterwarn = $("letterwarn"), letterfacts = $("letterfacts");
  const letterplay = $("letterplay"), letterstop = $("letterstop"), letterask = $("letterask"), letterq = $("letterq"), letteranswer = $("letteranswer");
  const LETTER_LANGS = [["en-GB", "English"], ["cy", "Cymraeg"], ["te", "తెలుగు"], ["hi", "हिन्दी"], ["ur", "اردو"], ["pa", "ਪੰਜਾਬੀ"],
    ["bn", "বাংলা"], ["gu", "ગુજરાતી"], ["ta", "தமிழ்"], ["pl", "Polski"], ["ro", "Română"], ["ar", "العربية"], ["zh", "中文"],
    ["es", "Español"], ["pt", "Português"], ["fr", "Français"], ["so", "Soomaali"], ["uk", "Українська"]];
  const LETTER_LANG_STORE = "tempoLetterLang", DIALECT_STORE = "tempoDialect";
  LETTER_LANGS.forEach(([code, label]) => { const o = document.createElement("option"); o.value = code; o.textContent = label; letterlang.appendChild(o); });
  letterlang.value = store.get(LETTER_LANG_STORE) || (lang === "en" ? "en-GB" : lang);
  if (!letterlang.value) letterlang.value = "en-GB";
  dialect.value = store.get(DIALECT_STORE) || "";
  letterlang.addEventListener("change", () => store.set(LETTER_LANG_STORE, letterlang.value));
  dialect.addEventListener("change", () => store.set(DIALECT_STORE, dialect.value.trim()));
  chips.forEach((c) => c.addEventListener("click", () => { if (!store.get(LETTER_LANG_STORE)) letterlang.value = lang === "en" ? "en-GB" : lang; }));

  let currentJob = null, currentAudio = null, speechLang = "en-GB", mainAudio = null;

  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 1600, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that photo. Try again.")); };
      img.src = url;
    });
  }
  function stopSpeaking() {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    try { speechSynthesis.cancel(); } catch { /* no speech */ }
  }
  function speakResult(text, audio, langTag) {
    stopSpeaking();
    if (audio && audio.audio_b64) {
      currentAudio = new Audio(`data:${audio.mime || "audio/wav"};base64,${audio.audio_b64}`);
      currentAudio.play().catch(() => { lettersteps.textContent = "Tap ▶ to hear it."; });
      return;
    }
    try { const u = new SpeechSynthesisUtterance(text); u.lang = langTag || "en-GB"; u.rate = 0.95; speechSynthesis.speak(u); } catch { /* text is on screen */ }
  }
  // The tunnel's older rule forwards only two POST paths, so a POST to agents/... can come back as a bare 404 from
  // ngrok (not our JSON). Then the same call goes in an envelope through phone-task, which the laptop unwraps.
  let viaEnvelope = false;
  async function agentsFetch(path, opts) {
    const headers = { "Content-Type": "application/json", "X-Tempo-Phone-Key": phoneKey || "", ...(opts && opts.headers) };
    const isPost = !!(opts && opts.method === "POST");
    const direct = () => fetch("agents/" + path, { cache: "no-store", ...opts, headers });
    const envelope = () => fetch("phone-task", { method: "POST", cache: "no-store", headers,
      body: JSON.stringify({ agent_path: "/agents/" + path, payload: opts && opts.body ? JSON.parse(opts.body) : {} }) });
    const parse = async (r) => { try { return await r.clone().json(); } catch { return {}; } };
    let r = await (isPost && viaEnvelope ? envelope() : direct());
    let body = await parse(r);
    if (isPost && !viaEnvelope && r.status === 404 && !body.error && !body.detail) {
      viaEnvelope = true;
      r = await envelope();
      body = await parse(r);
    }
    if (!r.ok) throw new Error(body.error || (body.detail && (body.detail.message || body.detail)) || `The laptop said ${r.status}.`);
    return body;
  }
  function showSteps(job) { lettersteps.textContent = (job.steps || []).slice(-4).map((s) => "· " + s).join("\n"); }
  async function waitForJob(job) {
    while (job.status === "running" || job.status === "queued") {
      showSteps(job);
      await new Promise((r) => setTimeout(r, 1200));
      job = await agentsFetch("jobs/" + job.id);
    }
    return job;
  }
  function showResult(job) {
    const res = job.result, ex = res.explanation, doc = res.document;
    currentJob = job.id;
    mainAudio = res.audio || null;
    speechLang = ex.speech_lang || "en-GB";
    lettertext.textContent = ex.text;
    lettertext.setAttribute("lang", ex.language || "en");
    letterfacts.textContent = `${doc.document_type.replace("_", " ")} from ${doc.sender.name || "?"}` +
      (doc.money && doc.money.you_owe > 0 ? ` · to pay: ${doc.money.currency || "£"} ${doc.money.you_owe}` : "") +
      (doc.deadline && doc.deadline.date ? ` · by ${doc.deadline.date}` : "") +
      (res.memory && res.memory.saved ? " · remembered" : "");
    if (res.safety && (res.safety.level === "medium" || res.safety.level === "high")) {
      letterwarn.textContent = "⚠ " + res.safety.notice; letterwarn.className = "banner warn";
    } else letterwarn.className = "banner warn hidden";
    letteranswer.className = "big hidden";
    letterresult.className = "";
    showSteps(job);
    speakResult(ex.text, res.audio, speechLang);
    letterresult.scrollIntoView({ block: "start", behavior: "smooth" });
    if (conv) conv.sendContextualUpdate(`The user just photographed a letter. Kairos's letter reader explained it as: "${ex.text}". ` +
      `Facts: ${doc.document_type} from ${doc.sender.name}; ${doc.summary_plain}. They may ask you about it; answer only from these facts.`);
  }
  letterfile.addEventListener("change", async () => {
    const file = letterfile.files && letterfile.files[0];
    letterfile.value = "";
    if (!file) return;
    if (!phoneKey) { showBanner("This page needs your personal Kairos link."); return; }
    stopSpeaking();
    letterresult.className = "hidden";
    lettersteps.textContent = "· Reading your letter…";
    try {
      const image = await shrink(file);
      // The tunnel caps a request at 64 KB, so a photo goes up in slices (the laptop joins them), then one small
      // request asks for the reading. A tiny photo goes in one go.
      const b64 = image.split(",")[1];
      const SLICE = 60000;
      const ask = { mime: "image/jpeg", language: letterlang.value, dialect: dialect.value.trim(), speak: true, wait: 50 };
      if (b64.length <= SLICE) {
        ask.image = b64;
      } else {
        const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        const total = Math.ceil(b64.length / SLICE);
        for (let i = 0; i < total; i++) {
          lettersteps.textContent = `· Sending the photo… ${i + 1}/${total}`;
          await agentsFetch(`uploads/${id}/${i}`, { method: "POST", body: JSON.stringify({ data: b64.slice(i * SLICE, (i + 1) * SLICE), total, mime: "image/jpeg" }) });
        }
        ask.upload_id = id;
      }
      lettersteps.textContent = "· Reading your letter…";
      let job = await agentsFetch("document/interpret", { method: "POST", body: JSON.stringify(ask) });
      job = await waitForJob(job);
      if (job.status !== "done") throw new Error(job.error || "The letter reader couldn't finish.");
      showResult(job);
    } catch (e) {
      lettersteps.textContent = "";
      showBanner("Letter: " + (e && e.message ? e.message : e));
    }
  });
  letterplay.addEventListener("click", () => {
    const answering = !letteranswer.className.includes("hidden") && letteranswer.dataset.audio !== undefined;
    const text = answering ? letteranswer.textContent : lettertext.textContent;
    const audio = answering ? (letteranswer.dataset.audio ? JSON.parse(letteranswer.dataset.audio) : null) : mainAudio;
    speakResult(text, audio, speechLang);
  });
  letterstop.addEventListener("click", stopSpeaking);
  letterask.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const q = letterq.value.trim();
    if (!q || !currentJob) return;
    letterq.value = ""; letterq.blur();
    letteranswer.textContent = "…"; letteranswer.className = "big"; delete letteranswer.dataset.audio;
    try {
      const a = await agentsFetch(`document/${currentJob}/ask`, { method: "POST", body: JSON.stringify({ question: q, speak: true }) });
      letteranswer.textContent = a.answer;
      letteranswer.dataset.audio = a.audio ? JSON.stringify(a.audio) : "";
      speakResult(a.answer, a.audio, a.speech_lang || speechLang);
      if (conv) conv.sendContextualUpdate(`About the letter, the user asked "${q}" and the letter reader answered: "${a.answer}".`);
    } catch (e) {
      letteranswer.textContent = "Couldn't answer: " + (e && e.message ? e.message : e);
    }
  });

  window.addEventListener("pagehide", () => { if (conv) conv.endSession(); stopSpeaking(); });
})();
