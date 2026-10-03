// Yalnız uygulama paketinde (tools/build-app.mjs ekler), main.js'ten önce çalışır.
// Mac olmadan cihazdaki hataları görmek için konsolu ve yakalanmamış hataları bellekte tutar.
// Logoya 2 saniye içinde 5 kez dokununca kayıt açılır; "Kopyala" panoya alır.
(() => {
  const MAX = 400;
  const lines = [];

  const text = (a) => {
    if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ''}`;
    if (a && typeof a === 'object') {
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    }
    return String(a);
  };
  const add = (level, args) => {
    lines.push(`${new Date().toISOString().slice(11, 23)} ${level} ${args.map(text).join(' ')}`);
    if (lines.length > MAX) lines.shift();
  };

  // Capacitor da konsolu sarar (Xcode/logcat'e iletir); onunkini çağırmaya devam ediyoruz.
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      add(level, args);
      original(...args);
    };
  }
  addEventListener('error', (e) => add('error', [e.message, `${e.filename}:${e.lineno}:${e.colno}`]));
  addEventListener('unhandledrejection', (e) => add('error', ['unhandledrejection', e.reason]));

  // Platform yetenekleri: CI'daki simülatör çıktısında ve kayıt panelinin başında görünür.
  addEventListener('load', () => {
    console.info(
      '[sonik-diag]',
      JSON.stringify({
        platform: window.Capacitor?.getPlatform?.() ?? 'web',
        ua: navigator.userAgent,
        secureContext: window.isSecureContext,
        getUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
        audioWorklet: typeof AudioWorkletNode === 'function',
        imageDecoder: typeof ImageDecoder === 'function',
        webCrypto: Boolean(crypto.subtle),
        screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
      }),
    );
  });

  const button = (label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };

  const open = () => {
    document.querySelector('.app-log')?.remove();
    const box = document.createElement('div');
    box.className = 'app-log';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Uygulama kaydı');
    const pre = document.createElement('pre');
    pre.textContent = lines.join('\n') || '(kayıt yok)';
    const title = document.createElement('strong');
    title.textContent = `Kayıt · ${lines.length} satır`;
    const copy = button('Kopyala', async () => {
      try {
        await navigator.clipboard.writeText(pre.textContent);
        copy.textContent = 'Kopyalandı';
      } catch {
        getSelection().selectAllChildren(pre);
      }
    });
    const bar = document.createElement('div');
    bar.className = 'app-log-bar';
    bar.append(title, copy, button('Kapat', () => box.remove()));
    box.append(bar, pre);
    document.body.append(box);
    pre.scrollTop = pre.scrollHeight;
  };

  let taps = [];
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('.brand .logo')) return;
    const now = Date.now();
    taps = taps.filter((t) => now - t < 2000).concat(now);
    if (taps.length >= 5) {
      taps = [];
      open();
    }
  });
})();
