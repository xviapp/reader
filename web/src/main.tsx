import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { LanBook, LanBookIndex, LanDiscussion, LanDiscussionIndex, LanFolder, LanLiveReply, LanMessage, LanMessageIndex, LanPage, LanPassage, LanPassageIndex, LanSearchResult, LanSource } from '../../src/modules/reader/lan/contracts';
import { LanClient, type QueryState } from './client';
import { CopyText, ReaderImage, Reading } from './reading';
import './style.css';

const client = new LanClient();
const statusNames = { reading: '在读', unread: '未读', finished: '已读' };
type Section = 'library' | 'discussions' | 'favorites' | 'search';
type Selection = { kind: 'book' | 'passage' | 'discussion' | 'message'; id: string } | null;
interface Navigation { section: Section; bookId: string | null; selected: Selection }
const initial: Navigation = { section: 'library', bookId: null, selected: null };
const sectionNames: Record<Section, string> = { library: '书架', discussions: '全部讨论', favorites: '收藏', search: '搜索' };
const scrollPositions = new Map<string, number>();
type Go = (navigation: Navigation) => void;

function useQuery<T>(path: string, pagination: 'none' | 'forward' | 'history' = 'none') {
  const query = useMemo(() => client.query<T>(path, pagination), [path, pagination]);
  const state = useSyncExternalStore(query.subscribe, query.getSnapshot);
  return { ...state, loadMore: query.loadMore };
}
function useConnection() { return useSyncExternalStore(client.subscribe, client.getSnapshot); }
function path(name: string, params: Record<string, string | null> = {}) {
  const query = new URLSearchParams(); for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  return `/api/v1/${name}${query.size ? `?${query}` : ''}`;
}
function date(value: string) { return value ? new Date(value).toLocaleDateString('zh-CN') : ''; }
function QueryNotice({ data, error, loading }: QueryState<unknown>) {
  return error ? <p className="notice" role="status">{error}</p> : loading && !data ? <p className="empty" role="status">正在读取…</p> : null;
}
function More({ query, history = false }: { query: QueryState<LanPage<unknown>> & { loadMore(): void }; history?: boolean }) {
  const connection = useConnection();
  return <><QueryNotice {...query} />{query.data?.nextCursor ? <button className="load-more" disabled={query.loading || connection.phase !== 'online'} onClick={query.loadMore}>
    {query.loading ? '正在读取…' : history ? '加载更早消息' : '加载更多'}</button> : null}</>;
}
function Photo({ id, alt, compact = false }: { id: string | null; alt: string; compact?: boolean }) {
  const connection = useConnection();
  return id ? <ReaderImage key={id} url={client.mediaUrl(id)} alt={alt} online={connection.phase === 'online'} compact={compact} /> : null;
}
function ScrollPane({ name, className, children }: { name: string; className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current; if (!element) return;
    element.scrollTop = scrollPositions.get(name) ?? 0;
    return () => { if (scrollPositions.size > 100) scrollPositions.clear(); scrollPositions.set(name, element.scrollTop); };
  }, [name]);
  return <div ref={ref} className={className}>{children}</div>;
}

const ACCESS_CODE_LENGTH = 6;
const emptyAccessCode = () => Array.from({ length: ACCESS_CODE_LENGTH }, () => '');

function AccessCodeForm({ loading, onLogin }: { loading: boolean; onLogin(code: string): Promise<void> }) {
  const [digits, setDigits] = useState<string[]>(emptyAccessCode);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const submittedCodeRef = useRef('');
  const code = digits.join('');

  const focusInput = useCallback((index: number) => {
    inputsRef.current[index]?.focus();
  }, []);
  const applyDigits = useCallback((start: number, raw: string) => {
    const incoming = raw.replace(/\D/g, '').slice(0, ACCESS_CODE_LENGTH - start);
    setDigits((current) => {
      const next = current.slice();
      if (!incoming) {
        next[start] = '';
        return next;
      }
      for (let offset = 0; offset < incoming.length; offset++) next[start + offset] = incoming[offset] ?? '';
      return next;
    });
    if (incoming) focusInput(Math.min(start + incoming.length, ACCESS_CODE_LENGTH - 1));
  }, [focusInput]);
  const submit = useCallback(() => {
    if (code.length !== ACCESS_CODE_LENGTH || loading || submittedCodeRef.current === code) return;
    submittedCodeRef.current = code;
    void onLogin(code).finally(() => {
      setDigits((current) => {
        if (current.join('') !== code) return current;
        submittedCodeRef.current = '';
        return emptyAccessCode();
      });
    });
  }, [code, loading, onLogin]);

  useEffect(() => {
    if (code !== submittedCodeRef.current) submittedCodeRef.current = '';
  }, [code]);
  useEffect(() => {
    if (code.length === ACCESS_CODE_LENGTH && !loading) submit();
  }, [code, loading, submit]);
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || !/^\d$/.test(event.key)) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)) return;
      const firstEmpty = digits.findIndex((digit) => !digit);
      if (loading || firstEmpty < 0) return;
      event.preventDefault();
      applyDigits(firstEmpty, event.key);
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [applyDigits, digits, loading]);

  const inputKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      applyDigits(index, event.key);
    } else if (event.key === 'Backspace' && !digits[index] && index > 0) {
      event.preventDefault();
      applyDigits(index - 1, '');
      focusInput(index - 1);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      focusInput(index - 1);
    } else if (event.key === 'ArrowRight' && index < ACCESS_CODE_LENGTH - 1) {
      event.preventDefault();
      focusInput(index + 1);
    }
  };

  return <form className="login" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); submit(); }}>
    <span className="eyebrow">求知于卷，问道于天</span><h2>从手机，接着读。</h2>
    <p>在手机的「设置 → 局域网阅读」中查看本次访问码。</p>
    <fieldset className="code-fieldset">
      <legend className="code-label">6 位访问码</legend>
      <div className="code-inputs" role="group" aria-describedby="access-code-help">
        {digits.map((digit, index) => <div className="code-slot" key={index}>
          <label className="visually-hidden" htmlFor={`access-code-${index}`}>{index === 0 ? '6 位访问码' : `访问码第 ${index + 1} 位`}</label>
          <input ref={(element) => { inputsRef.current[index] = element; }} id={`access-code-${index}`} className="code-input" type="text" inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'} autoFocus={index === 0} pattern="[0-9]" maxLength={1} value={digit} disabled={loading}
            onChange={(event) => applyDigits(index, event.currentTarget.value)} onKeyDown={(event) => inputKeyDown(index, event)}
            onPaste={(event) => { const value = event.clipboardData.getData('text'); if (!value.replace(/\D/g, '')) return; event.preventDefault(); applyDigits(index, value); }} />
        </div>)}
      </div>
      <p id="access-code-help" className="code-help">直接输入数字，填满 6 位后自动验证</p>
    </fieldset>
    <button className="primary" disabled={code.length !== ACCESS_CODE_LENGTH || loading}>{loading ? '正在验证…' : '验证并阅读'}</button>
  </form>;
}

function App() {
  const connection = useConnection();
  const [nav, setNav] = useState(readHash);
  const [font, setFont] = useState(16);
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    void client.resume();
    const visible = () => { if (document.visibilityState === 'visible') client.recalibrate(); };
    const offline = () => client.networkLost(); const online = () => client.recalibrate(); const hash = () => setNav(readHash());
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('offline', offline); window.addEventListener('online', online); window.addEventListener('hashchange', hash);
    return () => {
      document.removeEventListener('visibilitychange', visible); window.removeEventListener('offline', offline);
      window.removeEventListener('online', online); window.removeEventListener('hashchange', hash); client.dispose();
    };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  useEffect(() => { client.setDiscussion(nav.selected?.kind === 'discussion' ? nav.selected.id : null); }, [nav.selected]);
  const go: Go = (next) => {
    setNav(next);
    const params = new URLSearchParams({ section: next.section });
    if (next.bookId) params.set('book', next.bookId);
    if (next.selected) { params.set('kind', next.selected.kind); params.set('id', next.selected.id); }
    window.location.assign(`#${params}`);
  };
  const needsCode = connection.phase === 'login' || connection.phase === 'ended';
  const login = useCallback((value: string) => client.login(value), []);
  return <div className={`app font-${font}`}>
    <aside className="sidebar"><div className="brand">偷<span>光</span></div><p className="caption">求知于卷，问道于天</p><span className="readonly">只读</span>
      <nav aria-label="阅读导航">{(Object.keys(sectionNames) as Section[]).map((section) => <button key={section} aria-current={nav.section === section ? 'page' : undefined}
        onClick={() => go({ section, bookId: null, selected: null })}>{sectionNames[section]}</button>)}</nav>
      <div className="preferences"><button onClick={() => setDark(!dark)}>{dark ? '浅色主题' : '深色主题'}</button>
        <label>字号 <select value={font} onChange={(event) => setFont(Number(event.target.value))}><option value="14">小</option><option value="16">标准</option><option value="20">大</option></select></label>
        <p>内容来自手机<br />更改请在手机中完成</p></div>
    </aside>
    <main><header className="topbar"><h1>{sectionNames[nav.section]}</h1><div className="connection" role="status" data-online={connection.phase === 'online'}>
      {connection.phase === 'online' ? '已连接 · 自动更新' : connection.phase === 'connecting' ? '正在连接手机' : connection.phase === 'login' ? '等待验证' : '连接不可用'}</div>
      {!needsCode ? <button className="quiet" onClick={() => { void client.logout(); }}>退出</button> : null}</header>
      {connection.message ? <p className="notice connection-notice" role="alert">{connection.message}</p> : null}
      {needsCode ? <AccessCodeForm loading={connection.loading} onLogin={login} /> : null}
      {connection.phase === 'full' ? <div className="empty"><button onClick={() => { void client.resume(); }}>重试连接</button></div> : null}
      {connection.phase !== 'login' && connection.phase !== 'full' ? <div className={`workspace ${nav.selected ? 'has-selection' : ''} ${needsCode ? 'stale' : ''}`}>
        <Collection nav={nav} go={go} />
        <div className="detail"><button className="back-list" onClick={() => go({ ...nav, selected: null })}>← 返回列表</button>
          {nav.selected ? <Detail key={`${nav.selected.kind}:${nav.selected.id}`} selected={nav.selected} nav={nav} go={go} />
            : <div className="reading-welcome"><span className="book-mark">阅</span><h2>翻开一页，慢慢读。</h2><p>从左侧选择书籍、摘录或讨论。</p></div>}</div>
      </div> : null}
    </main>
  </div>;
}

function Collection({ nav, go }: { nav: Navigation; go: Go }) {
  const [status, setStatus] = useState(''); const [tab, setTab] = useState('passages'); const [folder, setFolder] = useState('');
  const [search, setSearch] = useState(''); const [needle, setNeedle] = useState(''); const [kind, setKind] = useState(''); const [scope, setScope] = useState('');
  useEffect(() => { const timer = setTimeout(() => setNeedle(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const name = `${nav.section}:${nav.bookId ?? ''}:${status}:${tab}:${folder}:${needle}:${kind}:${scope}`;
  return <ScrollPane name={name} className="collection">
    {nav.section === 'library' ? nav.bookId ? <><button className="quiet" onClick={() => go(initial)}>← 返回书架</button>
      <BookHeading id={nav.bookId} onOpen={() => go({ ...nav, selected: { kind: 'book', id: nav.bookId! } })} />
      <div className="tabs"><button aria-pressed={tab === 'passages'} onClick={() => setTab('passages')}>摘录</button><button aria-pressed={tab === 'discussions'} onClick={() => setTab('discussions')}>讨论</button></div>
      {tab === 'passages' ? <PassageList bookId={nav.bookId} nav={nav} go={go} /> : <DiscussionList params={{ bookId: nav.bookId }} nav={nav} go={go} />}</>
      : <><div className="list-heading"><h2>我的书籍</h2><label>阅读状态 <select value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">全部</option><option value="reading">在读</option><option value="unread">未读</option><option value="finished">已读</option></select></label></div><BookList status={status} go={go} /></> : null}
    {nav.section === 'discussions' ? <><h2>一起想过的问题</h2><Folders value={folder} onChange={setFolder} /><DiscussionList params={{ folderId: folder }} nav={nav} go={go} /></> : null}
    {nav.section === 'favorites' ? <><h2>值得再读的回答</h2><FavoriteList nav={nav} go={go} /></> : null}
    {nav.section === 'search' ? <><h2>在阅读中寻找</h2><label className="search-label">搜索内容<input type="search" placeholder="书名、摘录、问题或回答" maxLength={200} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div className="search-filters"><label>类型<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">全部</option><option value="book">书籍</option><option value="passage">摘录</option><option value="discussion">讨论</option><option value="message">消息</option></select></label>
        <BookScope value={scope} onChange={setScope} /></div>{needle ? <SearchList q={needle} kind={kind} scope={scope} nav={nav} go={go} /> : <p className="empty">输入关键词，查找书籍与阅读记录。</p>}</> : null}
  </ScrollPane>;
}
function BookHeading({ id, onOpen }: { id: string; onOpen(): void }) {
  const query = useQuery<LanBook>(path(`books/${id}`));
  return <><h2 className="book-heading"><button onClick={onOpen}>{query.data?.title ?? '书籍'}</button></h2><QueryNotice {...query} /></>;
}
function BookList({ status, go }: { status: string; go: Go }) {
  const query = useQuery<LanPage<LanBookIndex>>(path('books', { status }), 'forward');
  return <section aria-label="书籍列表">{query.data?.items.map((book) => <article className="book list-item" key={book.id}>
    <Photo id={book.coverId} alt={`${book.title}封面`} compact /><button className="item-main" onClick={() => go({ section: 'library', bookId: book.id, selected: { kind: 'book', id: book.id } })}>
      <span className="eyebrow">{statusNames[book.status]}</span><h3>{book.title}</h3><p>{book.authors.join(' / ') || '作者未填写'}</p>{book.progress !== null ? <div className="progress"><progress max={100} value={book.progress} aria-label={`${book.title}阅读进度`} /><span>{book.progress}%</span></div> : null}</button>
  </article>)}<Empty query={query} text="这里还没有书籍。在手机端添加后，书架会自动更新。" /><More query={query} /></section>;
}
function PassageList({ bookId, nav, go }: { bookId: string; nav: Navigation; go: Go }) {
  const query = useQuery<LanPage<LanPassageIndex>>(path(`books/${bookId}/passages`), 'forward');
  return <section aria-label="摘录列表">{query.data?.items.map((item) => <article className="list-item" data-selected={nav.selected?.id === item.id} key={item.id}>
    <Photo id={item.imageId} alt={`${item.title}摘录`} compact /><button className="item-main" onClick={() => go({ ...nav, selected: { kind: 'passage', id: item.id } })}>
      <span className="eyebrow">{item.pageLabel || '摘录'} · {date(item.createdAt)}</span><h3>{item.title || '未命名摘录'}</h3><p className="clamp">{item.summaryPreview || item.sourcePreview || '打开查看图片'}</p></button>
  </article>)}<Empty query={query} text="还没有摘录。" /><More query={query} /></section>;
}
function Folders({ value, onChange }: { value: string; onChange(value: string): void }) {
  const query = useQuery<readonly LanFolder[]>(path('folders'));
  return <label className="filter-label">文件夹<select value={value} onChange={(event) => onChange(event.target.value)}><option value="">全部讨论</option><option value="ungrouped">未分组</option>{query.data?.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>;
}
function DiscussionList({ params, nav, go }: { params: Record<string, string | null>; nav: Navigation; go: Go }) {
  const query = useQuery<LanPage<LanDiscussionIndex>>(path('discussions', params), 'forward');
  return <section aria-label="讨论列表">{query.data?.items.map((item) => <article key={item.id} className="list-item" data-selected={nav.selected?.id === item.id}>
    <button className="item-main" onClick={() => go({ ...nav, selected: { kind: 'discussion', id: item.id } })}>
      <span className="eyebrow">{item.bookTitle || '独立讨论'}{item.unread ? ' · 未读' : ''}</span><h3>{item.title}</h3><p className="clamp">{item.lastMessagePreview || (item.lastMessageStatus === 'pending' ? '正在生成回答…' : '暂无消息')}</p><time>{date(item.lastMessageAt)}</time></button>
  </article>)}<Empty query={query} text="这里还没有讨论。" /><More query={query} /></section>;
}
function FavoriteList({ nav, go }: { nav: Navigation; go: Go }) {
  const query = useQuery<LanPage<LanMessageIndex>>(path('favorites'), 'forward');
  return <>{query.data?.items.map((item) => <article key={item.id} className="list-item"><button className="item-main" onClick={() => go({ ...nav, selected: { kind: 'message', id: item.id } })}>
    <span className="eyebrow">{item.discussionTitle}</span><h3 className="clamp">{item.content || '回答暂不可用'}</h3><time>{date(item.updatedAt)}</time></button></article>)}<Empty query={query} text="手机中收藏的回答会出现在这里。" /><More query={query} /></>;
}
function BookScope({ value, onChange }: { value: string; onChange(value: string): void }) {
  const query = useQuery<LanPage<LanBookIndex>>(path('books', { limit: '100' }), 'forward');
  return <div><label>范围<select value={value} onChange={(event) => onChange(event.target.value)}><option value="">全部书籍</option>{query.data?.items.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}</select></label>
    {query.data?.nextCursor ? <button className="quiet" disabled={query.loading} onClick={query.loadMore}>更多书籍</button> : null}</div>;
}
function SearchList({ q, kind, scope, nav, go }: { q: string; kind: string; scope: string; nav: Navigation; go: Go }) {
  const query = useQuery<LanPage<LanSearchResult>>(path('search', { q, kind, bookId: scope }), 'forward');
  const names = { book: '书籍', passage: '摘录', discussion: '讨论', message: '消息' };
  return <section aria-label="搜索结果">{query.data?.items.map((item) => <article className="list-item" key={`${item.kind}:${item.id}`}>
    <Photo id={item.imageId} alt={item.title} compact /><button className="item-main" onClick={() => go({ ...nav, selected: { kind: item.kind, id: item.id } })}>
      <span className="eyebrow">{names[item.kind]}{item.match === 'source' ? ' · 命中原文' : ''}</span><h3>{item.title}</h3><p className="clamp">{item.snippet}</p><span className="muted">{item.subtitle}</span></button>
  </article>)}<Empty query={query} text="没有找到匹配内容。" /><More query={query} /></section>;
}
function Empty({ query, text }: { query: QueryState<LanPage<unknown>>; text: string }) {
  return query.data && !query.data.items.length && !query.loading ? <p className="empty">{text}</p> : null;
}

function Detail({ selected, nav, go }: { selected: NonNullable<Selection>; nav: Navigation; go: Go }) {
  if (selected.kind === 'discussion') return <DiscussionDetail id={selected.id} nav={nav} go={go} />;
  return <ScrollPane name={`detail:${selected.kind}:${selected.id}`} className="detail-scroll">
    {selected.kind === 'book' ? <BookDetail id={selected.id} nav={nav} go={go} /> : selected.kind === 'passage' ? <PassageDetail id={selected.id} nav={nav} go={go} /> : <MessageDetail id={selected.id} nav={nav} go={go} />}
  </ScrollPane>;
}
function BookDetail({ id, go }: { id: string; nav: Navigation; go: Go }) {
  const query = useQuery<LanBook>(path(`books/${id}`)); const book = query.data;
  return <><QueryNotice {...query} />{book ? <article className="reading-document"><span className="eyebrow">书籍 · {statusNames[book.status]}</span><h2>{book.title}</h2><p className="byline">{book.authors.join(' / ') || '作者未填写'}</p>
    <div className="book-metadata"><Photo id={book.coverId} alt={`${book.title}封面`} compact /><dl>{book.progress !== null ? <><dt>阅读进度</dt><dd>{book.progress}%</dd></> : null}<dt>出版</dt><dd>{[book.publisher, book.publishedAt].filter(Boolean).join(' · ') || '未填写'}</dd><dt>ISBN</dt><dd>{book.isbn || '未填写'}</dd></dl></div>
    <button className="primary" onClick={() => go({ section: 'library', bookId: id, selected: null })}>浏览 {book.passageCount} 条摘录 · {book.discussionCount} 个讨论</button>
    {book.summary ? <section><h3>关于这本书</h3><Reading text={book.summary} /></section> : null}{book.note ? <section><h3>我的笔记</h3><Reading text={book.note} /><CopyText text={book.note} /></section> : null}
  </article> : null}</>;
}
function PassageDetail({ id, nav, go }: { id: string; nav: Navigation; go: Go }) {
  const query = useQuery<LanPassage>(path(`passages/${id}`)); const item = query.data;
  return <><QueryNotice {...query} />{item ? <article className="reading-document"><button className="quiet" onClick={() => go({ section: 'library', bookId: item.bookId, selected: { kind: 'book', id: item.bookId } })}>← {item.bookTitle}</button>
    <span className="eyebrow">{item.pageLabel || '摘录'} · {date(item.createdAt)}</span><h2>{item.title || '未命名摘录'}</h2><Photo id={item.imageId} alt={`${item.title}原图`} />
    <section><h3>理解与摘要</h3>{item.summary ? <><Reading text={item.summary} /><CopyText text={item.summary} label="复制摘要" /></> : <p className="muted">{item.analysisStatus === 'running' ? '手机正在分析…' : item.analysisStatus === 'failed' || item.analysisStatus === 'interrupted' ? '分析未完成，请在手机查看' : '暂无摘要'}</p>}</section>
    {item.suggestedQuestions.length ? <section><h3>可以继续想一想</h3><ul>{item.suggestedQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul><CopyText text={item.suggestedQuestions.join('\n')} label="复制问题" /></section> : null}
    <details className="source-text"><summary>查看文本 · 版本 {item.sourceRevision}</summary><h3>整理文本</h3>{item.sourceText ? <><Reading text={item.sourceText} /><CopyText text={item.sourceText} /></> : <p>暂无整理文本</p>}
      <h3>识别原文</h3><pre className="plain-text">{item.rawSourceText || '暂无识别文本'}</pre><CopyText text={item.rawSourceText} label="复制识别原文" /></details>
    <section><h3>相关讨论</h3><DiscussionList params={{ passageId: id }} nav={nav} go={go} /></section>
  </article> : null}</>;
}
function Sources({ sources, nav, go }: { sources: readonly LanSource[]; nav: Navigation; go: Go }) {
  return sources.length ? <ul className="sources">{sources.map((source, index) => <li key={`${source.passageId}:${index}`}>
    {source.passageId && source.state !== 'unavailable' ? <button className="quiet" onClick={() => go({ ...nav, selected: { kind: 'passage', id: source.passageId! } })}>{source.title}</button> : <span>来源已不可用</span>}
    <span>{source.sourceRevision !== null ? `引用版本 ${source.sourceRevision}` : '引用版本未知'}{source.state === 'updated' ? ` · 原文已更新至 ${source.currentRevision}` : ''}</span>
  </li>)}</ul> : null;
}
function MessageDetail({ id, nav, go }: { id: string; nav: Navigation; go: Go }) {
  const query = useQuery<LanMessage>(path(`messages/${id}`));
  return <><QueryNotice {...query} />{query.data ? <article className="reading-document"><button className="quiet" onClick={() => go({ ...nav, selected: { kind: 'discussion', id: query.data!.discussionId } })}>← {query.data.discussionTitle}</button>
    <h2>{query.data.role === 'assistant' ? '阅读伙伴的回答' : '我的问题'}</h2><MessageBody message={query.data} /><Sources sources={query.data.sources} nav={nav} go={go} />
  </article> : null}</>;
}
function MessageBody({ message, live }: { message: LanMessageIndex; live?: LanLiveReply }) {
  const text = message.status === 'pending' ? live?.text || message.content : message.content;
  return <>{text ? message.status === 'pending' ? <pre className="plain-text live-text">{text}</pre> : <Reading text={text} /> : null}
    {message.status === 'pending' ? <p className="live-status">{live?.state === 'committing' ? '回答正在保存…' : live?.previewAvailable ? '生成中，尚未保存…' : '正在生成，实时预览暂不可用，完成后自动显示'}</p> : message.status !== 'completed' ? <p className="muted">回答未完成，请在手机中查看或重试。</p> : null}
    {text ? <CopyText text={text} label={message.hasMoreContent ? '复制当前片段' : '复制文本'} /> : null}</>;
}
function MessageSources({ id, nav, go }: { id: string; nav: Navigation; go: Go }) {
  const query = useQuery<LanMessage>(path(`messages/${id}`));
  return <><QueryNotice {...query} />{query.data ? <><MessageBody message={query.data} /><Sources sources={query.data.sources} nav={nav} go={go} /></> : null}</>;
}
function DiscussionDetail({ id, nav, go }: { id: string; nav: Navigation; go: Go }) {
  const discussion = useQuery<LanDiscussion>(path(`discussions/${id}`));
  const messages = useQuery<LanPage<LanMessageIndex>>(path(`discussions/${id}/messages`), 'history');
  const live = useQuery<readonly LanLiveReply[]>(path('live-replies', { discussionId: id }));
  const [expanded, setExpanded] = useState<string | null>(null); const [newContent, setNewContent] = useState(false);
  const viewport = useRef<HTMLDivElement>(null); const bottom = useRef(true); const previous = useRef({ height: 0, first: '', data: messages.data, live: live.data });
  const restored = useRef(false);
  useEffect(() => {
    const element = viewport.current;
    return () => { if (element) scrollPositions.set(`discussion:${id}`, element.scrollTop); };
  }, [id]);
  useLayoutEffect(() => {
    const element = viewport.current; if (!element) return;
    const first = messages.data?.items[0]?.id ?? '';
    const old = previous.current;
    if (!restored.current && messages.data) {
      const savedPosition = scrollPositions.get(`discussion:${id}`);
      element.scrollTop = savedPosition ?? element.scrollHeight;
      bottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
      restored.current = true;
    } else if (old.first && first && first !== old.first && messages.data?.items.some((item) => item.id === old.first)) element.scrollTop += element.scrollHeight - old.height;
    else if (bottom.current) element.scrollTop = element.scrollHeight;
    else if (old.data !== messages.data || old.live !== live.data) setNewContent(true);
    previous.current = { height: element.scrollHeight, first, data: messages.data, live: live.data };
  }, [messages.data, live.data, expanded, id]);
  return <><div className="discussion-scroll" ref={viewport} onScroll={() => {
    const element = viewport.current!; bottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    if (bottom.current) setNewContent(false);
  }}><article className="reading-document"><QueryNotice {...discussion} />{discussion.data ? <>
    <span className="eyebrow">{discussion.data.bookTitle || '独立讨论'}{discussion.data.unread ? ' · 手机中未读' : ''}</span><h2>{discussion.data.title}</h2>
    <Sources sources={discussion.data.sources} nav={nav} go={go} /><More query={messages} history />
    {messages.data?.items.map((message) => <article id={`message-${message.id}`} key={message.id} className={`message message-${message.role}`}>
      <div className="message-heading"><h3>{message.role === 'assistant' ? '阅读伙伴' : '我'}</h3><time>{date(message.createdAt)}</time>{message.favorite ? <span>已收藏</span> : null}</div>
      {expanded === message.id && message.status !== 'pending' ? <MessageSources id={message.id} nav={nav} go={go} /> : <MessageBody message={message} {...(live.data?.find((row) => row.messageId === message.id) ? { live: live.data.find((row) => row.messageId === message.id)! } : {})} />}
      {message.status !== 'pending' ? <button className="quiet" onClick={() => setExpanded(expanded === message.id ? null : message.id)}>{expanded === message.id ? '收起全文与来源' : message.hasMoreContent ? '展开全文与来源' : '查看引用来源'}</button> : null}
    </article>)}<Empty query={messages} text="讨论中暂无消息。" /></> : null}</article></div>
    {newContent ? <button className="new-content" onClick={() => { bottom.current = true; viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' }); setNewContent(false); }}>有更新 · 回到最新消息 ↓</button> : null}
  </>;
}
function readHash(): Navigation {
  const params = new URLSearchParams(location.hash.slice(1));
  const section = params.get('section'); const kind = params.get('kind'); const id = params.get('id'); const book = params.get('book');
  const validId = (value: string | null): value is string => !!value && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
  return { section: section && section in sectionNames ? section as Section : 'library', bookId: validId(book) ? book : null,
    selected: validId(id) && ['book', 'passage', 'discussion', 'message'].includes(kind ?? '') ? { kind: kind as NonNullable<Selection>['kind'], id } : null };
}

createRoot(document.getElementById('root')!).render(<App />);
