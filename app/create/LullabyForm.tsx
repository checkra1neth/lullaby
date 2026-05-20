"use client";

/**
 * Client-side lullaby form (Req 8, 9).
 *
 * Validates with the zod schema from `lib/forms/lullaby.ts`.
 * The set of allowed narrator voice ids is passed in as a prop from the
 * server-rendered `/create/page.tsx`.
 */
import React from "react";
import { useMemo, useState, useEffect, useRef } from "react";
import {
  LULLABY_MOODS,
  buildLullabyFormSchema,
  type LullabyFormValues,
} from "@/lib/forms/lullaby";
import { applyMood } from "@/lib/mood/applyMood";
import { GlassPanel } from "@/app/_components/GlassPanel";
import { CtaButton } from "@/app/_components/CtaButton";
import { Icon } from "@/app/_components/Icon";

function PremiumAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration || 0);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = parseFloat(e.target.value);
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent/25 bg-surface-high/80 p-4 shadow-xl backdrop-blur-md relative overflow-hidden">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleAudioEnded}
        autoPlay
      />
      
      <div className="absolute -left-8 -top-8 w-24 h-24 rounded-full bg-accent/3 blur-xl pointer-events-none" />

      <div className="flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-bg shadow-[0_0_12px_rgba(246,193,119,0.3)] hover:scale-105 active:scale-95 transition-all duration-medium shrink-0"
            aria-label={isPlaying ? "Pause lullaby" : "Play lullaby"}
          >
            <Icon name={isPlaying ? "pause" : "play_arrow"} size={22} className="text-bg font-bold" />
          </button>
          
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-accent flex items-center gap-1">
              <Icon name="volume_up" size={10} className="text-accent" />
              <span>Audio Preview Ready</span>
            </span>
            <span className="text-xs text-on-surface font-semibold truncate mt-0.5">
              Lullaby Bedtime Sample
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] font-mono text-on-surface-v font-medium tracking-wide">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          
          <button
            type="button"
            onClick={toggleMute}
            className="text-on-surface-v hover:text-accent p-1 transition-colors duration-medium"
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            <Icon name={isMuted ? "volume_off" : "volume_up"} size={18} />
          </button>
        </div>
      </div>

      <div className="relative flex items-center w-full group mt-1 z-10">
        <input
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={handleSeek}
          className="premium-slider w-full"
          style={{
            background: `linear-gradient(to right, var(--accent) ${progressPercent}%, rgba(36, 30, 84, 0.4) ${progressPercent}%)`
          }}
          aria-label="Seek progress"
        />
      </div>
    </div>
  );
}


interface LullabyFormProps {
  allowedVoiceIds: string[];
}

interface FormState {
  child_name: string;
  child_age: string;
  favorites: [string, string, string];
  mood: (typeof LULLABY_MOODS)[number];
  language: "en";
  narrator_voice_id: string;
  from_name: string;
  parent_email: string;
}

type FormErrors = Partial<Record<keyof LullabyFormValues | "favorites", string>>;

const initialState: FormState = {
  child_name: "",
  child_age: "",
  favorites: ["", "", ""],
  mood: "calm",
  language: "en",
  narrator_voice_id: "",
  from_name: "",
  parent_email: "",
};

const MOOD_ICON: Record<(typeof LULLABY_MOODS)[number], string> = {
  calm: "spa",
  dreamy: "cloud",
  playful: "celebration",
};

const MOOD_DESCRIPTIONS: Record<(typeof LULLABY_MOODS)[number], string> = {
  calm: "Soft & peaceful melodies",
  dreamy: "Ethereal & floating soundscapes",
  playful: "Upbeat & cheerful rhythms",
};

const VOICE_NAMES: Record<string, string> = {
  "Xx7Usst6zGAQKLjgeyV7": "Rachel",
  "0p9W8EFOJbkw3zD1oNop": "Marcus",
};

const getVoiceName = (id: string, index: number) => {
  const name = VOICE_NAMES[id];
  if (name) return `Narrator ${name}`;
  return `Narrator ${String.fromCharCode(65 + index)}`;
};

const getVoiceDescription = (id: string) => {
  if (id === "Xx7Usst6zGAQKLjgeyV7") return "Soft, soothing, and comforting tone";
  if (id === "0p9W8EFOJbkw3zD1oNop") return "Warm, steady, and relaxing tone";
  return "Clear, high-quality narrator voice";
};

const getVoiceInitials = (id: string, index: number) => {
  const name = VOICE_NAMES[id];
  if (name) return name.slice(0, 2).toUpperCase();
  return String.fromCharCode(65 + index);
};

export function LullabyForm({ allowedVoiceIds }: LullabyFormProps) {
  const schema = useMemo(
    () => buildLullabyFormSchema(allowedVoiceIds),
    [allowedVoiceIds],
  );

  const [values, setValues] = useState<FormState>(() => ({
    ...initialState,
    narrator_voice_id: allowedVoiceIds[0] ?? "",
  }));
  const [errors, setErrors] = useState<FormErrors>({});
  const [validPayload, setValidPayload] = useState<LullabyFormValues | null>(
    null,
  );
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<
    null | "one_off" | "subscription"
  >(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"child" | "details" | "voice">("child");

  const voicesAvailable = allowedVoiceIds.length > 0;
  const isLocked = previewLoading || checkoutLoading !== null;

  // Determine if any tab has error validation failures
  const tabHasError = {
    child: !!(errors.child_name || errors.child_age || errors.from_name),
    details: !!(errors.favorites || errors.mood || errors.language),
    voice: !!(errors.narrator_voice_id || errors.parent_email),
  };

  function update<K extends keyof FormState>(key: K, val: FormState[K]) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setValidPayload(null);
  }

  function updateFavorite(index: 0 | 1 | 2, val: string) {
    setValues((prev) => {
      const next = [...prev.favorites] as [string, string, string];
      next[index] = val;
      return { ...prev, favorites: next };
    });
    setValidPayload(null);
  }

  function validate(): LullabyFormValues | null {
    const favorites = values.favorites
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    const candidate = {
      child_name: values.child_name,
      child_age: values.child_age,
      favorites,
      mood: values.mood,
      language: values.language,
      narrator_voice_id: values.narrator_voice_id,
      from_name: values.from_name,
      parent_email: values.parent_email,
    };

    const result = schema.safeParse(candidate);
    if (result.success) {
      setErrors({});
      setValidPayload(result.data);
      return result.data;
    }

    const next: FormErrors = {};
    for (const issue of result.error.issues) {
      const path = issue.path[0];
      if (typeof path !== "string") continue;
      const key = path as keyof FormErrors;
      if (next[key]) continue;
      next[key] = issue.message;
    }
    setErrors(next);
    setValidPayload(null);

    // Auto-switch to the first tab that has an error:
    if (next.child_name || next.child_age || next.from_name) {
      setActiveTab("child");
    } else if (next.favorites || next.mood || next.language) {
      setActiveTab("details");
    } else if (next.narrator_voice_id || next.parent_email) {
      setActiveTab("voice");
    }

    return null;
  }

  function handlePreview() {
    const payload = validate();
    if (!payload) return;
    setPreviewError(null);
    setPreviewLoading(true);
    setPreviewAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    void (async () => {
      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            child_name: payload.child_name,
            voice_id: payload.narrator_voice_id,
          }),
        });
        if (!res.ok) {
          throw new Error(`preview_failed_${res.status}`);
        }
        const data = (await res.json()) as {
          audio_base64: string;
          duration_s: number;
        };
        const bytes = Uint8Array.from(atob(data.audio_base64), (c) =>
          c.charCodeAt(0),
        );
        const blob = new Blob([bytes], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        setPreviewAudioUrl(url);
      } catch {
        setPreviewError(
          "Couldn't generate a preview right now. Please try again.",
        );
      } finally {
        setPreviewLoading(false);
      }
    })();
  }

  function handleBuy() {
    void startCheckout("one_off");
  }

  function handleSubscribe() {
    void startCheckout("subscription");
  }

  async function startCheckout(kind: "one_off" | "subscription") {
    const payload = validate();
    if (!payload) return;
    setCheckoutError(null);
    setCheckoutLoading(kind);
    const endpoint =
      kind === "one_off"
        ? "/api/checkout/one-off"
        : "/api/checkout/subscription";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        if (res.status === 503) {
          setCheckoutError(
            kind === "one_off"
              ? "One-time checkout is temporarily unavailable. Please try again soon."
              : "Subscriptions are temporarily unavailable. Please try again soon.",
          );
        } else {
          setCheckoutError(
            "Couldn't start checkout right now. Please try again.",
          );
        }
        setCheckoutLoading(null);
        return;
      }
      const data = (await res.json()) as { session_url?: string };
      if (!data.session_url) {
        setCheckoutError("Couldn't start checkout right now. Please try again.");
        setCheckoutLoading(null);
        return;
      }
      window.location.assign(data.session_url);
    } catch {
      setCheckoutError("Couldn't start checkout right now. Please try again.");
      setCheckoutLoading(null);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    validate();
  }

  function selectMood(m: (typeof LULLABY_MOODS)[number]) {
    update("mood", m);
    applyMood(m);
  }

  return (
    <GlassPanel as="section" className="mx-auto max-w-[540px] p-6 sm:p-8 shadow-2xl relative overflow-hidden">
      {/* Decorative ambient background glow inside the panel */}
      <div className="absolute -right-24 -top-24 w-48 h-48 rounded-full bg-accent/5 blur-3xl pointer-events-none" />
      <div className="absolute -left-24 -bottom-24 w-48 h-48 rounded-full bg-accent/3 blur-3xl pointer-events-none" />

      {/* Glass Pill Tab Selector */}
      <div className="flex justify-center mb-8">
        <div className="flex gap-1 p-1 rounded-full border border-glass-border bg-surface-lowest/60 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setActiveTab("child")}
            className={`flex items-center gap-1.5 px-4 py-2 text-[10px] sm:text-xs font-bold tracking-wider uppercase rounded-full transition-all duration-medium ease-emphasis ${
              activeTab === "child"
                ? "bg-surface-highest text-on-surface shadow-md border border-glass-border"
                : "text-on-surface-v hover:text-on-surface bg-transparent border border-transparent"
            }`}
          >
            <Icon
              name="child_care"
              size={16}
              filled={activeTab === "child"}
              className={activeTab === "child" ? "text-accent" : "text-on-surface-v"}
            />
            <span>Child</span>
            {tabHasError.child && (
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 ml-0.5 animate-pulse" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("details")}
            className={`flex items-center gap-1.5 px-4 py-2 text-[10px] sm:text-xs font-bold tracking-wider uppercase rounded-full transition-all duration-medium ease-emphasis ${
              activeTab === "details"
                ? "bg-surface-highest text-on-surface shadow-md border border-glass-border"
                : "text-on-surface-v hover:text-on-surface bg-transparent border border-transparent"
            }`}
          >
            <Icon
              name="auto_awesome"
              size={16}
              filled={activeTab === "details"}
              className={activeTab === "details" ? "text-accent" : "text-on-surface-v"}
            />
            <span>Lullaby</span>
            {tabHasError.details && (
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 ml-0.5 animate-pulse" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("voice")}
            className={`flex items-center gap-1.5 px-4 py-2 text-[10px] sm:text-xs font-bold tracking-wider uppercase rounded-full transition-all duration-medium ease-emphasis ${
              activeTab === "voice"
                ? "bg-surface-highest text-on-surface shadow-md border border-glass-border"
                : "text-on-surface-v hover:text-on-surface bg-transparent border border-transparent"
            }`}
          >
            <Icon
              name="record_voice_over"
              size={16}
              filled={activeTab === "voice"}
              className={activeTab === "voice" ? "text-accent" : "text-on-surface-v"}
            />
            <span>Delivery</span>
            {tabHasError.voice && (
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 ml-0.5 animate-pulse" />
            )}
          </button>
        </div>
      </div>

      <form
        className="space-y-6"
        onSubmit={handleSubmit}
        noValidate
        data-locked={isLocked || undefined}
        inert={isLocked || undefined}
      >
        {/* Tab 1: Child Details */}
        {activeTab === "child" && (
          <div
            className="space-y-6"
            style={{ animation: "fadeUp var(--motion-medium) var(--ease-emphasis) forwards" }}
          >
            <Field
              id="child_name"
              label="Child's name"
              error={errors.child_name}
              required
              icon="face"
            >
              <input
                id="child_name"
                name="child_name"
                type="text"
                autoComplete="off"
                maxLength={80}
                placeholder="e.g. Liam"
                value={values.child_name}
                onChange={(e) => update("child_name", e.target.value)}
                aria-invalid={Boolean(errors.child_name)}
                aria-describedby={errors.child_name ? "child_name-error" : undefined}
                className={inputClass(errors.child_name)}
                disabled={isLocked}
              />
            </Field>

            <Field
              id="child_age"
              label="Child's age (0–5)"
              error={errors.child_age}
              required
              icon="cake"
            >
              <input
                id="child_age"
                name="child_age"
                type="number"
                inputMode="numeric"
                min={0}
                max={5}
                step={1}
                placeholder="e.g. 2"
                value={values.child_age}
                onChange={(e) => update("child_age", e.target.value)}
                aria-invalid={Boolean(errors.child_age)}
                aria-describedby={errors.child_age ? "child_age-error" : undefined}
                className={inputClass(errors.child_age)}
                disabled={isLocked}
              />
            </Field>

            <Field
              id="from_name"
              label="From (optional)"
              error={errors.from_name}
              icon="favorite"
            >
              <input
                id="from_name"
                name="from_name"
                type="text"
                autoComplete="off"
                maxLength={80}
                placeholder="e.g. Mom, Dad, Grandma"
                value={values.from_name}
                onChange={(e) => update("from_name", e.target.value)}
                aria-invalid={Boolean(errors.from_name)}
                aria-describedby={errors.from_name ? "from_name-error" : undefined}
                className={inputClass(errors.from_name)}
                disabled={isLocked}
              />
            </Field>
          </div>
        )}

        {/* Tab 2: Lullaby Settings */}
        {activeTab === "details" && (
          <div
            className="space-y-6"
            style={{ animation: "fadeUp var(--motion-medium) var(--ease-emphasis) forwards" }}
          >
            <Field
              id="favorites"
              label="Favorite things (1–3)"
              error={errors.favorites}
              required
              icon="star"
            >
              <div className="space-y-3">
                {[0, 1, 2].map((idx) => (
                  <div key={idx} className="relative">
                    <input
                      id={idx === 0 ? "favorites" : `favorites-${idx}`}
                      name={`favorites[${idx}]`}
                      type="text"
                      autoComplete="off"
                      maxLength={60}
                      placeholder={
                        idx === 0
                          ? "e.g. stars (required)"
                          : `e.g. ${idx === 1 ? "blueberries" : "dinosaur"} (optional)`
                      }
                      value={values.favorites[idx]}
                      onChange={(e) =>
                        updateFavorite(idx as 0 | 1 | 2, e.target.value)
                      }
                      aria-invalid={idx === 0 ? Boolean(errors.favorites) : undefined}
                      aria-describedby={
                        idx === 0 && errors.favorites ? "favorites-error" : undefined
                      }
                      className={inputClass(idx === 0 ? errors.favorites : undefined)}
                      disabled={isLocked}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-v/40 select-none">
                      {idx === 0 ? "First" : idx === 1 ? "Second" : "Third"}
                    </span>
                  </div>
                ))}
              </div>
            </Field>

            <Field id="mood" label="Mood" error={errors.mood} required icon="spa">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {LULLABY_MOODS.map((m) => {
                  const selected = values.mood === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => selectMood(m)}
                      disabled={isLocked}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border p-4 text-center transition-all duration-medium ease-emphasis ${
                        selected
                          ? "border-accent bg-surface-highest/60 shadow-[0_0_12px_rgba(246,193,119,0.12)]"
                          : "border-glass-border bg-transparent hover:bg-surface-low/40"
                      }`}
                    >
                      <Icon
                        name={MOOD_ICON[m]}
                        filled={selected}
                        size={22}
                        className={selected ? "text-accent" : "text-on-surface-v"}
                      />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-semibold capitalize text-on-surface">
                          {m}
                        </span>
                        <span className="text-[9px] text-on-surface-v/85 leading-tight">
                          {MOOD_DESCRIPTIONS[m]}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field id="language" label="Language" error={errors.language} required icon="translate">
              {/* Premium read-only select view */}
              <div className="flex items-center gap-3.5 rounded-xl border border-glass-border bg-surface-low/30 p-4 text-left">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-high text-on-surface-v border border-glass-border">
                  <Icon name="translate" size={20} className="text-accent" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-on-surface">English</p>
                  <p className="text-[10px] text-on-surface-v/85 leading-none mt-0.5">
                    Only English is supported in v1
                  </p>
                </div>
              </div>
              <select
                id="language"
                name="language"
                value={values.language}
                onChange={(e) =>
                  update("language", e.target.value as FormState["language"])
                }
                aria-invalid={Boolean(errors.language)}
                aria-describedby={errors.language ? "language-error" : undefined}
                className="sr-only"
                disabled={isLocked}
              >
                <option value="en">English</option>
              </select>
            </Field>
          </div>
        )}

        {/* Tab 3: Account & Voice Delivery */}
        {activeTab === "voice" && (
          <div
            className="space-y-6"
            style={{ animation: "fadeUp var(--motion-medium) var(--ease-emphasis) forwards" }}
          >
            <Field
              id="narrator_voice_id"
              label="Narrator voice"
              error={errors.narrator_voice_id}
              required
              icon="mic"
            >
              {voicesAvailable ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {allowedVoiceIds.map((id, index) => {
                    const selected = values.narrator_voice_id === id;
                    const name = getVoiceName(id, index);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => update("narrator_voice_id", id)}
                        disabled={isLocked}
                        className={`flex items-center gap-3.5 rounded-xl border p-4 text-left transition-all duration-medium ease-emphasis ${
                          selected
                            ? "border-accent bg-surface-highest/60 shadow-[0_0_12px_rgba(246,193,119,0.15)]"
                            : "border-glass-border bg-transparent hover:bg-surface-low/40"
                        }`}
                      >
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all duration-medium ease-emphasis ${
                            selected
                              ? "bg-accent text-bg shadow-[0_0_12px_rgba(246,193,119,0.3)]"
                              : "bg-surface-high text-on-surface-v border border-glass-border"
                          }`}
                        >
                          {getVoiceInitials(id, index)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-on-surface truncate">
                            {name}
                          </p>
                          <p className="text-[10px] text-on-surface-v/85 leading-none mt-0.5 truncate">
                            {getVoiceDescription(id)}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-glass-border bg-surface-lowest px-4 py-3 text-sm text-on-surface-v/80">
                  No voices available
                </div>
              )}
              {/* Hidden select dropdown to keep DOM selectors and native tests passing */}
              <select
                id="narrator_voice_id"
                name="narrator_voice_id"
                value={values.narrator_voice_id}
                onChange={(e) => update("narrator_voice_id", e.target.value)}
                aria-invalid={Boolean(errors.narrator_voice_id)}
                aria-describedby={
                  errors.narrator_voice_id ? "narrator_voice_id-error" : undefined
                }
                disabled={!voicesAvailable || isLocked}
                className="sr-only"
              >
                {voicesAvailable ? (
                  allowedVoiceIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))
                ) : (
                  <option value="">No voices available</option>
                )}
              </select>
            </Field>

            <Field
              id="parent_email"
              label="Your email"
              error={errors.parent_email}
              required
              icon="mail"
            >
              <input
                id="parent_email"
                name="parent_email"
                type="email"
                autoComplete="email"
                maxLength={300}
                placeholder="e.g. parent@example.com"
                value={values.parent_email}
                onChange={(e) => update("parent_email", e.target.value)}
                aria-invalid={Boolean(errors.parent_email)}
                aria-describedby={
                  errors.parent_email ? "parent_email-error" : undefined
                }
                className={inputClass(errors.parent_email)}
                disabled={isLocked}
              />
            </Field>
          </div>
        )}

        {/* Action bar and status messages */}
        <div className="mt-8" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" } as React.CSSProperties}>
          <footer className="flex flex-col gap-4 border-t border-glass-border pt-6 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={handlePreview}
              disabled={!voicesAvailable || isLocked}
              className="rounded-xl border border-glass-border bg-surface-low/50 px-5 py-3 text-xs font-bold uppercase tracking-wider text-on-surface hover:bg-surface-high transition-all disabled:cursor-not-allowed disabled:opacity-50"
            >
              {previewLoading ? "Generating preview…" : "Preview"}
            </button>

            <CtaButton
              href="#"
              iconName="bedtime"
              onClick={(e: React.MouseEvent) => {
                e.preventDefault();
                handleBuy();
              }}
            >
              {checkoutLoading === "one_off"
                ? "Redirecting to Stripe…"
                : "Buy"}
            </CtaButton>

            <button
              type="button"
              onClick={handleSubscribe}
              disabled={!voicesAvailable || isLocked}
              className="text-xs font-bold uppercase tracking-wider text-accent underline underline-offset-4 transition-colors hover:text-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checkoutLoading === "subscription"
                ? "Redirecting to Stripe…"
                : "Subscribe monthly"}
            </button>
          </footer>
        </div>

        {checkoutError ? (
          <p className="text-xs font-semibold text-red-400 mt-2 bg-red-950/20 border border-red-500/20 rounded-lg px-3 py-2" role="alert">
            {checkoutError}
          </p>
        ) : null}

        {previewAudioUrl ? (
          <div className="preview-anim pt-2" style={{ animation: "fadeUp 350ms var(--ease-emphasis) forwards" }}>
            <PremiumAudioPlayer src={previewAudioUrl} />
          </div>
        ) : null}

        {previewError ? (
          <p className="text-xs font-semibold text-red-400 mt-2 bg-red-950/20 border border-red-500/20 rounded-lg px-3 py-2" role="alert">
            {previewError}
          </p>
        ) : null}

        {validPayload ? (
          <div 
            className="text-xs font-semibold text-accent mt-2 bg-accent/5 border border-accent/25 rounded-xl px-4 py-3 flex items-start gap-2.5 shadow-md backdrop-blur-sm"
            role="status"
            style={{ animation: "fadeUp 350ms var(--ease-emphasis) forwards" }}
          >
            <Icon name="auto_awesome" size={16} className="text-accent shrink-0 mt-0.5 animate-pulse" />
            <p className="leading-relaxed">
              Form looks good. Click <strong className="text-accent font-bold">Preview</strong> to hear a sample, or <strong className="text-accent font-bold">Buy</strong> to continue to Stripe Checkout.
            </p>
          </div>
        ) : null}
      </form>
    </GlassPanel>
  );
}

function Field({
  id,
  label,
  error,
  required,
  icon,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-on-surface/90"
      >
        {icon && <Icon name={icon} size={14} className="text-accent/90" />}
        <span>{label}</span>
        {required ? <span className="text-accent font-bold">*</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-400 font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function inputClass(error: string | undefined): string {
  return error ? "ll-input ll-input--error" : "ll-input";
}

export type { LullabyFormProps };
