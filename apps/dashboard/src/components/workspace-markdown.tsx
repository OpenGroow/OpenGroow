"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function WorkspaceMarkdown({ content }: { content: string }) {
  return (
    <div className="grid gap-4 text-base leading-7 text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="m-0 text-2xl tracking-tight text-foreground">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-8 text-xl tracking-tight text-foreground">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-6 text-lg font-semibold text-foreground">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="m-0 text-base leading-7 text-foreground">
              {children}
            </p>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline decoration-primary/40 underline-offset-4"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="m-0 grid list-outside list-disc gap-2 pl-5 marker:text-muted-foreground">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="m-0 grid list-outside list-decimal gap-2 pl-5 marker:text-muted-foreground">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="m-0 rounded-xl border-l-4 border-primary/30 bg-muted px-4 py-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          code: ({ children, className }) =>
            className ? (
              <code className={className}>{children}</code>
            ) : (
              <code className="rounded-md bg-muted px-1.5 py-0.5 text-[0.92em] text-primary">
                {children}
              </code>
            ),
          pre: ({ children }) => (
            <pre className="m-0 overflow-x-auto rounded-xl border border-border bg-muted px-4 py-4 text-sm leading-6 text-foreground">
              {children}
            </pre>
          ),
          hr: () => <hr className="w-full border-0 border-t border-border" />,
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="min-w-full border-collapse bg-card text-left text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted text-foreground">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-4 py-3 font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-t border-border px-4 py-3 align-top">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
