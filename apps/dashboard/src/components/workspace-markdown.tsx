"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function WorkspaceMarkdown({ content }: { content: string }) {
  return (
    <div className="grid gap-4 text-[0.98rem] leading-7 text-[var(--dashboard-ink)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="m-0 text-[2rem] leading-[1.05] tracking-[-0.05em] text-[var(--dashboard-ink)]">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-8 text-[1.5rem] leading-[1.1] tracking-[-0.04em] text-[var(--dashboard-ink)]">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-6 text-[1.2rem] font-semibold text-[var(--dashboard-ink)]">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="m-0 text-[0.98rem] leading-7 text-[var(--dashboard-ink)]">
              {children}
            </p>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--dashboard-primary)] underline decoration-[rgba(0,38,27,0.25)] underline-offset-4"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="m-0 grid list-outside list-disc gap-2 pl-5 marker:text-[var(--dashboard-ink-soft)]">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="m-0 grid list-outside list-decimal gap-2 pl-5 marker:text-[var(--dashboard-ink-soft)]">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="m-0 rounded-2xl border-l-4 border-[var(--dashboard-primary-fixed)] bg-[rgba(220,230,224,0.35)] px-4 py-3 text-[var(--dashboard-ink-muted)]">
              {children}
            </blockquote>
          ),
          code: ({ children, className }) =>
            className ? (
              <code className={className}>{children}</code>
            ) : (
              <code className="rounded-md bg-[rgba(0,38,27,0.06)] px-1.5 py-0.5 text-[0.92em] text-[var(--dashboard-primary)]">
                {children}
              </code>
            ),
          pre: ({ children }) => (
            <pre className="m-0 overflow-x-auto rounded-[1.35rem] border border-[rgba(0,38,27,0.08)] bg-[rgba(243,244,244,0.96)] px-4 py-4 text-sm leading-6 text-[var(--dashboard-ink)]">
              {children}
            </pre>
          ),
          hr: () => <hr className="w-full border-0 border-t border-[rgba(0,38,27,0.08)]" />,
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-[1.2rem] border border-[rgba(0,38,27,0.08)]">
              <table className="min-w-full border-collapse bg-white text-left text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[rgba(220,230,224,0.42)] text-[var(--dashboard-ink)]">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-4 py-3 font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-t border-[rgba(0,38,27,0.06)] px-4 py-3 align-top">
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
