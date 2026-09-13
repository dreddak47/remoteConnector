(function () {
  "use strict";

  var pad = document.getElementById("pad");
  var statusEl = document.getElementById("status");
  var statusLabel = statusEl.querySelector(".label");
  var endBtn = document.getElementById("end-session");
  var backBtn = document.getElementById("back-btn");
  var btnLeft = document.getElementById("btn-left");
  var btnRight = document.getElementById("btn-right");
  var btnScroll = document.getElementById("btn-scroll");
  var btnKeyboard = document.getElementById("btn-keyboard");
  var padHint = document.getElementById("pad-hint");
  var kbInput = document.getElementById("kb-input");
  var sensSlider = document.getElementById("sens-slider");
  var sensValue = document.getElementById("sens-value");

  var ws = null;
  var scrollMode = false;
  var kbMode = false;

  // Sensitivity multiplier applied to pointer movement deltas. The value is
  // also sent to the server, which applies a matching factor on its side.
  // Higher = faster cursor. Persisted across sessions.
  var sensitivity = loadSensitivity();

  function loadSensitivity() {
    try {
      var v = parseFloat(localStorage.getItem("sens"));
      if (v > 0) return v;
    } catch (e) {}
    return 2.0;
  }

  function saveSensitivity() {
    try { localStorage.setItem("sens", String(sensitivity)); } catch (e) {}
  }

  // --- WebSocket ---

  function token() {
    var p = new URLSearchParams(window.location.search);
    return p.get("token") || "";
  }

  function setStatus(state, label) {
    statusEl.className = "status status-" + state;
    statusLabel.textContent = label;
  }

  function connect() {
    var t = token();
    if (!t) {
      setStatus("disconnected", "No token");
      return;
    }
    var proto = window.location.protocol === "https:" ? "wss" : "ws";
    var url = proto + "://" + window.location.host + "/ws?token=" + encodeURIComponent(t);

    setStatus("connecting", "Connecting…");

    ws = new WebSocket(url);

    ws.onopen = function () {
      setStatus("connected", "Connected");
      endBtn.disabled = false;
    };

    ws.onclose = function () {
      setStatus("disconnected", "Disconnected");
      endBtn.disabled = true;
      ws = null;
      // Auto-reconnect after a short delay.
      setTimeout(connect, 1500);
    };

    ws.onerror = function () {
      if (ws) { try { ws.close(); } catch (e) {} }
    };
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // --- Pointer handling (batched via requestAnimationFrame) ---

  var activePointer = null;
  var pendingDx = 0;
  var pendingDy = 0;
  var rafScheduled = false;
  var lastX = 0;
  var lastY = 0;

  function flush() {
    rafScheduled = false;
    if (pendingDx === 0 && pendingDy === 0) return;
    var msg = scrollMode
      ? { type: "scroll", dx: pendingDx, dy: pendingDy }
      : { type: "move", dx: pendingDx, dy: pendingDy, sensitivity: sensitivity };
    pendingDx = 0;
    pendingDy = 0;
    send(msg);
  }

  function scheduleFlush() {
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(flush);
    }
  }

  function handlePointerDown(e) {
    if (!scratchTargetIsPad(e.target)) return;
    pad.setPointerCapture(e.pointerId);
    activePointer = e.pointerId;
    pendingDx = 0;
    pendingDy = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    if (scrollMode) pad.classList.add("mode-scroll");
    pad.classList.add("active");
    e.preventDefault();
  }

  function handlePointerMove(e) {
    if (e.pointerId !== activePointer) return;
    // movementX/movementY are unreliable on mobile (notably iOS Safari in
    // standalone/home-screen mode, where they can stay 0 for the whole
    // gesture), so track the delta from clientX/clientY ourselves instead.
    var dx = Math.round(e.clientX - lastX);
    var dy = Math.round(e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
    if (dx === 0 && dy === 0) return;
    pendingDx += dx;
    pendingDy += dy;
    scheduleFlush();
    e.preventDefault();
  }

  function handlePointerUp(e) {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    pad.classList.remove("active");
    flush();
    e.preventDefault();
  }

  function handlePointerCancel(e) {
    if (e.pointerId === activePointer) {
      activePointer = null;
      pad.classList.remove("active");
    }
  }

  // We only track pointers that start on the pad itself, so button taps and
  // the keyboard input are unaffected.
  function scratchTargetIsPad(el) {
    return el === pad;
  }

  // --- Tap-to-click detection ---

  var downTime = 0;
  var downX = 0;
  var downY = 0;

  pad.addEventListener("pointerdown", function (e) {
    downTime = Date.now();
    downX = e.clientX;
    downY = e.clientY;
  });

  pad.addEventListener("pointerup", function (e) {
    var dt = Date.now() - downTime;
    var dist = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (dt < 250 && dist < 8 && !scrollMode) {
      // Interpreted as a tap -> left click.
      send({ type: "click", button: "left", double: false });
    }
  });

  pad.addEventListener("pointerdown", handlePointerDown);
  pad.addEventListener("pointermove", handlePointerMove);
  pad.addEventListener("pointerup", handlePointerUp);
  pad.addEventListener("pointercancel", handlePointerCancel);
  pad.addEventListener("lostpointercapture", handlePointerCancel);

  // --- Buttons ---

  btnLeft.addEventListener("click", function () {
    send({ type: "click", button: "left", double: false });
  });

  btnRight.addEventListener("click", function () {
    send({ type: "click", button: "right", double: false });
  });

  btnScroll.addEventListener("click", function () {
    scrollMode = !scrollMode;
    btnScroll.classList.toggle("active", scrollMode);
    padHint.textContent = scrollMode ? "Drag to scroll" : "Drag to move";
    pad.classList.toggle("mode-scroll", scrollMode);
  });

  btnKeyboard.addEventListener("click", function () {
    kbMode = !kbMode;
    btnKeyboard.classList.toggle("active", kbMode);
    if (kbMode) {
      kbInput.value = "";
      kbInput.focus();
    } else {
      kbInput.blur();
    }
  });

  endBtn.addEventListener("click", function () {
    send({ type: "end" });
    if (ws) { try { ws.close(); } catch (e) {} }
  });

  // This page is normally opened via window.open() from the device-list
  // site, so window.close() is allowed on it. If it was opened directly
  // (bookmarked, typed URL) there's no opener and window.close() would
  // silently fail -- hide the button rather than show one that does nothing.
  if (window.opener) {
    backBtn.hidden = false;
    backBtn.addEventListener("click", function () {
      window.close();
    });
  }

  // --- Keyboard input ---

  kbInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      send({ type: "key", key: "enter" });
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      send({ type: "key", key: "backspace" });
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      kbMode = false;
      btnKeyboard.classList.remove("active");
      kbInput.blur();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      send({ type: "key", key: "tab" });
      return;
    }
    // Modifier + navigation keys get forwarded as single taps.
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" ||
        e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      send({ type: "key", key: mapKey(e.key) });
      return;
    }
  });

  kbInput.addEventListener("input", function (e) {
    // Send only the newly inserted characters as text.
    var val = kbInput.value;
    if (val.length > 0) {
      send({ type: "text", value: val });
      kbInput.value = "";
    }
  });

  kbInput.addEventListener("blur", function () {
    // Keep keyboard mode active only if explicitly toggled; blurring via the
    // "End" button should not re-summon it.
  });

  function mapKey(k) {
    var m = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
      Enter: "enter",
      Backspace: "backspace",
      Tab: "tab",
    };
    return m[k] || k;
  }

  // --- Init ---

  sensSlider.value = String(sensitivity);
  sensValue.textContent = sensitivity.toFixed(1) + "×";
  sensSlider.addEventListener("input", function () {
    sensitivity = parseFloat(sensSlider.value);
    sensValue.textContent = sensitivity.toFixed(1) + "×";
    saveSensitivity();
  });

  padHint.textContent = "Drag to move";
  connect();
})();