"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Outcome, Reason, ShelfStatus, Stance } from "@/lib/types";

/** What the backend heard, already checked against the form's options and carried SKUs. */
export interface VoiceFields {
  outcome: Outcome | null;
  molecules: string[];
  feedback: { molecule: string; stance: Stance; reason: Reason | null }[];
  /** pack_key is null when the rep didn't say which pack — they pick it on the form. */
  samples: { molecule: string; pack_key: string | null; quantity: number }[];
  shelf: { pack_key: string; status: ShelfStatus }[];
  order: { molecule: string; pack_key: string | null; quantity: number }[];
  next_visit_on: string | null;
}

const MAX_SECONDS = 180;

function recorderType(): { mime: string; ext: string } {
  // iPhone Safari records mp4; Chrome/Android record webm.
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.("audio/webm")) return { mime: "audio/webm", ext: "webm" };
  return { mime: "audio/mp4", ext: "m4a" };
}

export default function VoiceNote({
  accountId,
  onResult,
}: {
  accountId: number;
  onResult: (transcript: string, fields: VoiceFields) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function start() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Allow microphone access to record a voice note.");
      return;
    }
    const { mime, ext } = recorderType();
    const rec = new MediaRecorder(stream, MediaRecorder.isTypeSupported?.(mime) ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      const type = rec.mimeType || mime;
      upload(new Blob(chunks, { type }), type.includes("mp4") ? "m4a" : ext);
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
    setState("recording");
    timer.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) rec.state === "recording" && rec.stop();
        return s + 1;
      });
    }, 1000);
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  async function upload(blob: Blob, ext: string) {
    setState("working");
    try {
      const api = process.env.NEXT_PUBLIC_API_URL;
      if (!api) throw new Error("Voice notes aren't set up yet (NEXT_PUBLIC_API_URL is missing in Vercel).");
      const { data } = await supabase().auth.getSession();
      const form = new FormData();
      form.append("account_id", String(accountId));
      form.append("audio", blob, `note.${ext}`);
      const res = await fetch(`${api.replace(/\/$/, "")}/api/rep/voice-note`, {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Couldn't process the voice note (error ${res.status}).`);
      if (!body.transcript) throw new Error("Didn't catch anything — try again a bit closer to the phone.");
      onResult(body.transcript, body.fields);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't process the voice note.");
    } finally {
      setState("idle");
    }
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="space-y-2">
      {state === "idle" && (
        <button className="btn-secondary flex items-center justify-center gap-2" onClick={start}>
          <Mic size={20} /> Record visit
        </button>
      )}
      {state === "recording" && (
        <button
          className="flex min-h-[52px] w-full items-center justify-center gap-3 rounded-xl bg-red-600 font-semibold text-white active:scale-[0.99]"
          onClick={stop}
        >
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
          {mmss} · Tap to stop
          <Square size={16} fill="currentColor" />
        </button>
      )}
      {state === "working" && (
        <div className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-pharma-50 text-sm font-medium text-pharma-900">
          <Loader2 size={18} className="animate-spin" /> Listening to your note…
        </div>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
