import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react';

const Markdown = lazy(() => import('./markdown'));

export const Reading = memo(function Reading({ text }: { text: string }) {
  return <Suspense fallback={<pre className="plain-text">{text}</pre>}><Markdown text={text} /></Suspense>;
});

export function CopyText({ text, label = '复制文本' }: { text: string; label?: string }) {
  const [fallback, setFallback] = useState(false);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (fallback) { input.current?.focus(); input.current?.select(); } }, [fallback]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1800); return () => clearTimeout(timer); }, [copied]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { setFallback(true); }
  };
  return <><button className="quiet" disabled={!text} onClick={() => { void copy(); }}>{copied ? '已复制' : label}</button>
    {fallback ? <div className="modal" role="dialog" aria-modal="true" aria-label="手动复制" onKeyDown={(event) => { if (event.key === 'Escape') setFallback(false); }}>
      <div className="copy-panel"><h2>复制所选文本</h2><p>按 Ctrl+C / ⌘C，或长按选区复制。</p>
        <textarea ref={input} aria-label="待复制文本" value={text} readOnly />
        <button autoFocus onClick={() => setFallback(false)}>关闭</button></div>
    </div> : null}</>;
}

let imageReads = 0;
const imageQueue: (() => void)[] = [];
async function imageBlob(url: string, signal: AbortSignal): Promise<Blob> {
  if (imageReads >= 2) await new Promise<void>((resolve) => imageQueue.push(resolve));
  imageReads++;
  try {
    signal.throwIfAborted();
    const response = await fetch(url, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error('Image unavailable');
    return await response.blob();
  } finally { imageReads--; imageQueue.shift()?.(); }
}

export function ReaderImage({ url, alt, online, compact = false }: { url: string; alt: string; online: boolean; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState<{ url: string; blob: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [scale, setScale] = useState(100);
  const loadedUrl = loaded?.url;
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: '150px' });
    if (ref.current) observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!online || !visible || loadedUrl === url) return;
    const abort = new AbortController();
    void imageBlob(url, abort.signal).then((blob) => {
      if (!abort.signal.aborted) { setLoaded({ url, blob: URL.createObjectURL(blob) }); setFailed(false); }
    }).catch(() => { if (!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  }, [url, online, visible, loadedUrl]);
  useEffect(() => { return () => { if (loaded) URL.revokeObjectURL(loaded.blob); }; }, [loaded]);
  const src = loaded?.url === url ? loaded.blob : null;
  return <div ref={ref} className={compact ? 'thumbnail' : 'passage-image'}>
    {src ? <button className="image-button" onClick={() => setZoom(true)} aria-label={`放大${alt}`}><img src={src} alt={alt} /></button>
      : <span className="image-placeholder">{failed ? '图片不可用' : online ? '图片加载中' : '等待连接'}</span>}
    {zoom && src ? <div className="modal image-modal" role="dialog" aria-modal="true" aria-label={alt} onKeyDown={(event) => { if (event.key === 'Escape') setZoom(false); }}>
      <div className="zoom-controls"><label>缩放 <input type="range" min="50" max="300" step="25" value={scale} onChange={(event) => setScale(Number(event.target.value))} />{scale}%</label><button autoFocus onClick={() => setZoom(false)}>关闭图片</button></div>
      <img src={src} alt={alt} style={{ width: `${scale}%`, maxWidth: 'none' }} />
    </div> : null}
  </div>;
}
