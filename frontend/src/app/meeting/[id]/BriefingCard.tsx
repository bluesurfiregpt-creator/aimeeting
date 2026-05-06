"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/api";

/**
 * Pre-meeting briefing card. Hides itself when there are no relevant
 * historical memories yet (server returns status='empty'). Visible only
 * before the meeting starts (caller controls mounting).
 */
export default function BriefingCard({ meetingId }: { meetingId: string }) {
  const [briefing, setBriefing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .getMeetingBriefing(meetingId)
      .then((r) => {
        if (!alive) return;
        setBriefing(r.briefing_md);
        setLoading(false);
      })
      .catch((e) => {
        console.warn("briefing failed", e);
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [meetingId]);

  if (loading) return null;          // don't flash an empty card
  if (!briefing) return null;        // no relevant memories yet — hide

  return (
    <section className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
      <header className="flex items-center gap-2">
        <span className="text-base">💡</span>
        <h2 className="text-sm font-medium text-amber-200">会前简报</h2>
        <span className="ml-2 text-xs text-amber-300/70">基于过往会议的长期记忆</span>
      </header>
      <article className="mt-3 max-w-none text-sm text-zinc-200">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h2: (p) => (
              <h3 {...p} className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wider text-amber-300" />
            ),
            ul: (p) => <ul {...p} className="my-1 list-disc space-y-1 pl-5" />,
            li: (p) => <li {...p} className="leading-relaxed text-zinc-200" />,
            p: (p) => <p {...p} className="my-1 leading-relaxed" />,
            strong: (p) => <strong {...p} className="font-semibold text-white" />,
          }}
        >
          {briefing}
        </ReactMarkdown>
      </article>
    </section>
  );
}
