/* Lead Hunter: draw a QR code onto a <canvas> (uses the vendored qrcode-generator). */
(function (root) {
  const LH = (root.LH = root.LH || {});

  /** Returns false when the text is too long for a QR code. */
  LH.drawQr = (canvas, text, cssSize = 300) => {
    let qr;
    try {
      qr = root.qrcode(0, 'L'); // lowest error correction = biggest modules, easiest to scan off a screen
      qr.addData(String(text), 'Byte');
      qr.make();
    } catch {
      return false;
    }
    const n = qr.getModuleCount();
    const quiet = 4;
    const total = n + quiet * 2;
    const ratio = Math.max(1, Math.min(3, root.devicePixelRatio || 1));
    const cell = Math.max(1, Math.floor((cssSize * ratio) / total));
    const px = cell * total;
    canvas.width = px;
    canvas.height = px;
    canvas.style.width = `${Math.round(px / ratio)}px`;
    canvas.style.height = `${Math.round(px / ratio)}px`;
    canvas.dataset.qrText = String(text);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    return true;
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
