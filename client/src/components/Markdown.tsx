import { Fragment, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '../markdown';

const renderInline = (nodes: readonly Inline[]): ReactNode =>
  nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={index}>{node.value}</Fragment>;
      case 'strong':
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case 'em':
        return <em key={index}>{renderInline(node.children)}</em>;
      case 'code':
        return <code key={index}>{node.value}</code>;
      case 'link':
        return (
          <a key={index} href={node.href} target="_blank" rel="noreferrer noopener">
            {renderInline(node.children)}
          </a>
        );
    }
  });

const renderBlock = (block: Block, index: number): ReactNode => {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(6, block.level + 2)}` as 'h3';
      return <Tag key={index}>{renderInline(block.children)}</Tag>;
    }
    case 'paragraph':
      return <p key={index}>{renderInline(block.children)}</p>;
    case 'code':
      return (
        <pre key={index}>
          <code>{block.value}</code>
        </pre>
      );
    case 'quote':
      return <blockquote key={index}>{renderInline(block.children)}</blockquote>;
    case 'list': {
      const items = block.items.map((item, itemIndex) => (
        <li key={itemIndex}>{renderInline(item)}</li>
      ));
      return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
    }
  }
};

interface MarkdownProps {
  readonly text: string;
  readonly className?: string;
}

/** Render a safe Markdown subset (see `../markdown`) as escaped React elements. */
export function Markdown({ text, className }: MarkdownProps) {
  const blocks = parseMarkdown(text);
  return (
    <div className={className ? `md-body ${className}` : 'md-body'}>
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}
