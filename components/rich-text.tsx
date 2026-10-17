import type { ReactNode } from 'react';
import { safeLink } from '@/lib/content';

function inline(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g);
  return tokens.map((token,index) => {
    if (token.startsWith('**') && token.endsWith('**')) return <strong key={index}>{token.slice(2,-2)}</strong>;
    const link = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
    if (link) { const href = safeLink(link[2]); return href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer">{link[1]}</a> : <span key={index}>{link[1]}</span>; }
    return token;
  });
}
export function RichText({body}: {body:string}) {
  return <div className="reading-body">{body.replace(/\r\n?/g,'\n').split(/\n{2,}/).filter(Boolean).map((block,index) => {
    if (/^#{1,3} /.test(block)) return <h2 key={index}>{inline(block.replace(/^#{1,3} /,''))}</h2>;
    if (block.split('\n').every(line => /^- /.test(line))) return <ul key={index}>{block.split('\n').map((line,i)=><li key={i}>{inline(line.slice(2))}</li>)}</ul>;
    if (block.startsWith('> ')) return <blockquote key={index}>{inline(block.slice(2))}</blockquote>;
    return <p key={index}>{block.split('\n').map((line,i)=><span key={i}>{i>0 && <br/>}{inline(line)}</span>)}</p>;
  })}</div>;
}
