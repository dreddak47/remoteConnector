(function () {
  "use strict";

  var STORAGE_KEY = "rc_devices"; // [{id, name}], persisted indefinitely
  var POLL_MS = 6000;

  var viewDevices = document.getElementById("view-devices");
  var viewAdd = document.getElementById("view-add");
  var deviceList = document.getElementById("device-list");
  var emptyState = document.getElementById("empty-state");
  var addBtn = document.getElementById("add-btn");
  var emptyAddBtn = document.getElementById("empty-add-btn");
  var backBtn = document.getElementById("back-btn");

  var digits = Array.prototype.slice.call(document.querySelectorAll(".digit"));
  var form = document.getElementById("code-form");
  var connectBtn = document.getElementById("connect-btn");
  var msg = document.getElementById("msg");

  var pollTimer = null;

  // --- Local device storage ---

  function loadDevices() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveDevices(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {}
  }

  function rememberDevice(id, name) {
    var list = loadDevices();
    var existing = list.filter(function (d) { return d.id !== id; });
    existing.push({ id: id, name: name || "Mac" });
    saveDevices(existing);
    return existing;
  }

  // --- Devices view ---

  function renderDevices(devices, statusById) {
    deviceList.innerHTML = "";
    emptyState.hidden = devices.length !== 0;
    deviceList.hidden = devices.length === 0;

    devices.forEach(function (d) {
      var status = statusById && statusById[d.id];
      var online = !!(status && status.online);
      var name = (status && status.name) || d.name || "Mac";

      var li = document.createElement("li");
      li.className = "device-card" + (online ? " online" : " offline");
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", online ? "0" : "-1");

      var dot = document.createElement("span");
      dot.className = "status-dot";

      var info = document.createElement("div");
      info.className = "device-info";
      var nameEl = document.createElement("div");
      nameEl.className = "device-name";
      nameEl.textContent = name;
      var stateEl = document.createElement("div");
      stateEl.className = "device-state";
      stateEl.textContent = online ? "Online — tap to connect" : "Offline";
      info.appendChild(nameEl);
      info.appendChild(stateEl);

      li.appendChild(dot);
      li.appendChild(info);

      if (online) {
        li.addEventListener("click", function () { connectToDevice(d.id, name); });
        li.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") connectToDevice(d.id, name);
        });
      }

      deviceList.appendChild(li);
    });
  }

  function refreshStatuses() {
    var devices = loadDevices();
    if (devices.length === 0) {
      renderDevices(devices, null);
      return;
    }
    var ids = devices.map(function (d) { return d.id; }).join(",");
    fetch("/api/devices?ids=" + encodeURIComponent(ids))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var statusById = {};
        (data.devices || []).forEach(function (s) { statusById[s.id] = s; });
        renderDevices(devices, statusById);
      })
      .catch(function () {
        // Keep showing last-known list (as offline/unknown) on network errors.
        renderDevices(devices, null);
      });
  }

  function startPolling() {
    stopPolling();
    refreshStatuses();
    pollTimer = setInterval(function () {
      if (document.visibilityState === "visible") refreshStatuses();
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && viewDevices.hidden === false) {
      refreshStatuses();
    }
  });

  function connectToDevice(id, name) {
    fetch("/api/resolve-device?id=" + encodeURIComponent(id))
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok) {
          throw new Error(result.data && result.data.error ? result.data.error : "device is offline");
        }
        openControlPage(result.data);
      })
      .catch(function () {
        // Status likely just flipped to offline between poll and tap.
        refreshStatuses();
      });
  }

  function openControlPage(d) {
    var url = "http://" + d.lanIp + ":" + d.port + "/?token=" + encodeURIComponent(d.token);
    // Opens in a new tab rather than navigating away from this page, so the
    // device list stays alive behind it; the control page's "Back" button
    // closes that tab to return here.
    window.open(url, "_blank");
  }

  // --- View switching ---

  function showDevices() {
    viewAdd.hidden = true;
    viewDevices.hidden = false;
    resetCodeForm();
    startPolling();
  }

  function showAdd() {
    viewDevices.hidden = true;
    viewAdd.hidden = false;
    stopPolling();
    digits[0].focus();
  }

  addBtn.addEventListener("click", showAdd);
  emptyAddBtn.addEventListener("click", showAdd);
  backBtn.addEventListener("click", showDevices);

  // --- Add-device (code entry) ---

  function currentCode() {
    return digits.map(function (d) { return d.value; }).join("");
  }

  function updateButton() {
    connectBtn.disabled = currentCode().length !== 6;
  }

  function resetCodeForm() {
    digits.forEach(function (d) { d.value = ""; });
    updateButton();
    setMsg("", null);
    connectBtn.disabled = true;
    connectBtn.textContent = "Connect";
  }

  digits.forEach(function (input, i) {
    input.addEventListener("input", function () {
      input.value = input.value.replace(/[^0-9]/g, "").slice(0, 1);
      if (input.value && i < digits.length - 1) {
        digits[i + 1].focus();
      }
      updateButton();
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Backspace" && !input.value && i > 0) {
        digits[i - 1].focus();
      }
    });

    input.addEventListener("paste", function (e) {
      var text = (e.clipboardData || window.clipboardData).getData("text").replace(/[^0-9]/g, "");
      if (!text) return;
      e.preventDefault();
      for (var j = 0; j < digits.length; j++) {
        digits[j].value = text[j] || "";
      }
      updateButton();
      var next = Math.min(text.length, digits.length - 1);
      digits[next].focus();
    });
  });

  function setMsg(text, kind) {
    msg.textContent = text;
    msg.className = "msg" + (kind ? " " + kind : "");
    msg.hidden = !text;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var code = currentCode();
    if (code.length !== 6) return;

    connectBtn.disabled = true;
    connectBtn.textContent = "Connecting…";
    setMsg("", null);

    fetch("/api/resolve?code=" + encodeURIComponent(code))
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok) {
          throw new Error(result.data && result.data.error ? result.data.error : "connect failed");
        }
        var d = result.data;
        setMsg("Found " + (d.name || "Mac") + " — connecting…", "ok");
        if (d.deviceId) rememberDevice(d.deviceId, d.name);
        openControlPage(d);
        showDevices();
      })
      .catch(function (err) {
        setMsg(err.message === "code not found or expired"
          ? "That code has expired — check the current code on your Mac."
          : "Couldn't connect: " + err.message, "error");
        connectBtn.disabled = false;
        connectBtn.textContent = "Connect";
      });
  });

  // --- Init ---

  showDevices();
})();
