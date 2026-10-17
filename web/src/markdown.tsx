import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export default function FormattedText({ text }: { text: string }) {
  return <div className="prose"><Markdown skipHtml remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[[rehypeKatex, { trust: false, strict: 'ignore', maxExpand: 200, maxSize: 20 }]]}
    components={{
      img: ({ alt }) => <span className="muted">〔外部图片：{alt || '未加载'}〕</span>,
      a: ({ href, children }) => /^(https?:|mailto:)/i.test(href ?? '')
        ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    }}>{text}</Markdown></div>;
}
