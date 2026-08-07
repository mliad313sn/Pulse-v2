"use client";

// The 20-second update flow: pick a mood chip, type one sentence, Post.
// Optional "More" disclosure for accomplishment / next step / support required.
// Updates are append-only and ONLINE-ONLY (no outbox) — the composer disables
// itself offline with an OfflineHint.

import { useState, type FormEvent, type ReactNode } from "react";
import { useApp } from "@/lib/store";
import type { UpdateMood } from "@/lib/types";
import { cn, UPDATE_MOOD_META, UPDATE_MOODS, UPDATE_TEXT_MAX } from "@/lib/utils";
import { OfflineHint, TextArea, TextInput } from "./Dialog";
import { AlertIcon, AlertOctagonIcon, ArrowUpIcon, ChevronDownIcon, MinusIcon } from "./Icons";

const MOOD_ICONS: Record<UpdateMood, (props: { className?: string }) => ReactNode> = {
  POSITIVE: ArrowUpIcon,
  NEUTRAL: MinusIcon,
  CONCERN: AlertIcon,
  CRITICAL: AlertOctagonIcon,
};

export default function UpdateComposer({ projectId }: { projectId: string }) {
  const { createUpdate, canWrite, online } = useApp();
  const [mood, setMood] = useState<UpdateMood>("NEUTRAL");
  const [text, setText] = useState("");
  const [more, setMore] = useState(false);
  const [accomplishment, setAccomplishment] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [supportRequired, setSupportRequired] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  // Writers only — VIEWER accounts never see the composer (server enforces too).
  if (!canWrite) return null;

  const remaining = UPDATE_TEXT_MAX - text.length;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setError(null);
    setPosting(true);
    const res = await createUpdate({
      projectId,
      mood,
      text: trimmed,
      accomplishment: accomplishment.trim() || null,
      nextStep: nextStep.trim() || null,
      supportRequired: supportRequired.trim() || null,
    });
    setPosting(false);
    if (res.ok) {
      setText("");
      setAccomplishment("");
      setNextStep("");
      setSupportRequired("");
      setMore(false);
      setMood("NEUTRAL");
    } else if (res.code !== "OFFLINE") {
      setError(res.message || "Update not posted — try again.");
    }
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
    >
      {/* Mood chips */}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Update mood">
        {UPDATE_MOODS.map((m) => {
          const meta = UPDATE_MOOD_META[m];
          const Icon = MOOD_ICONS[m];
          const active = mood === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setMood(m)}
              className={cn(
                "flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition",
                active ? meta.selected : meta.chip,
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {meta.label}
            </button>
          );
        })}
      </div>

      {/* One sentence */}
      <div className="mt-3">
        <label htmlFor={`update-text-${projectId}`} className="sr-only">
          What happened? One sentence.
        </label>
        <TextInput
          id={`update-text-${projectId}`}
          value={text}
          maxLength={UPDATE_TEXT_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder="What happened? One sentence."
        />
        <p
          className={cn(
            "mt-1 text-right text-xs tabular-nums",
            remaining <= 40 ? "text-amber-600 dark:text-amber-400" : "text-slate-400",
          )}
        >
          {text.length}/{UPDATE_TEXT_MAX}
        </p>
      </div>

      {/* More disclosure */}
      <button
        type="button"
        onClick={() => setMore((v) => !v)}
        aria-expanded={more}
        className="flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700/60"
      >
        <ChevronDownIcon className={cn("h-4 w-4 transition", more && "rotate-180")} />
        More
      </button>
      {more && (
        <div className="mt-2 space-y-3">
          <div>
            <label htmlFor={`update-acc-${projectId}`} className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Accomplishment
            </label>
            <TextArea
              id={`update-acc-${projectId}`}
              rows={2}
              maxLength={UPDATE_TEXT_MAX}
              value={accomplishment}
              onChange={(e) => setAccomplishment(e.target.value)}
              placeholder="What got done?"
            />
          </div>
          <div>
            <label htmlFor={`update-next-${projectId}`} className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Next step
            </label>
            <TextArea
              id={`update-next-${projectId}`}
              rows={2}
              maxLength={UPDATE_TEXT_MAX}
              value={nextStep}
              onChange={(e) => setNextStep(e.target.value)}
              placeholder="What happens next?"
            />
          </div>
          <div>
            <label htmlFor={`update-support-${projectId}`} className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Support required
            </label>
            <TextArea
              id={`update-support-${projectId}`}
              rows={2}
              maxLength={UPDATE_TEXT_MAX}
              value={supportRequired}
              onChange={(e) => setSupportRequired(e.target.value)}
              placeholder="Anything you need unblocked?"
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <OfflineHint show={!online} what="Posting an update" />
        <button
          type="submit"
          disabled={!online || posting || text.trim().length === 0}
          className="ml-auto flex min-h-[44px] items-center rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {posting ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}
