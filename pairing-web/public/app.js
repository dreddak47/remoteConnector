(function () {
  "use strict";

  var digits = Array.prototype.slice.call(document.querySelectorAll(".digit"));
  var form = document.getElementById("code-form");
  var connectBtn = document.getElementById("connect-btn");
  var msg = document.getElementById("msg");

  function currentCode() {
    return digits.map(function (d) { return d.value; }).join("");
  }

  function updateButton() {
    connectBtn.disabled = currentCode().length !== 6;
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
        // Top-level navigation to the Mac's own LAN server. This must be a
        // full page load (not fetched from here) so the WebSocket the
        // control app opens is same-origin plain http, not blocked as
        // mixed content from this https page.
        window.location.href = "http://" + d.lanIp + ":" + d.port + "/?token=" + encodeURIComponent(d.token);
      })
      .catch(function (err) {
        setMsg(err.message === "code not found or expired"
          ? "That code has expired — check the current code on your Mac."
          : "Couldn't connect: " + err.message, "error");
        connectBtn.disabled = false;
        connectBtn.textContent = "Connect";
      });
  });

  digits[0].focus();
  updateButton();
})();
