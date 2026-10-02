"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Rep } from "./types";

interface AuthState {
  loading: boolean;
  session: Session | null;
  rep: Rep | null;
  signOut: () => Promise<void>;
  /** Re-read the reps row (used right after login). */
  refreshRep: () => Promise<Rep | null>;
}

const Ctx = createContext<AuthState | null>(null);

async function loadRep(userId: string): Promise<Rep | null> {
  const { data } = await supabase()
    .from("reps")
    .select("id, name, email, role, active")
    .eq("id", userId)
    .maybeSingle();
  return (data as Rep | null) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [rep, setRep] = useState<Rep | null>(null);

  useEffect(() => {
    let alive = true;
    const sb = supabase();

    async function apply(s: Session | null) {
      const r = s ? await loadRep(s.user.id) : null;
      if (!alive) return;
      setRep(r);
      setSession(s);
      setLoading(false);
    }

    sb.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((event, s) => {
      // Defer to avoid awaiting Supabase calls inside the auth callback.
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        setTimeout(() => apply(s), 0);
      }
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    await supabase().auth.signOut();
    setSession(null);
    setRep(null);
  }, []);

  const refreshRep = useCallback(async () => {
    const { data } = await supabase().auth.getSession();
    const r = data.session ? await loadRep(data.session.user.id) : null;
    setRep(r);
    return r;
  }, []);

  return <Ctx.Provider value={{ loading, session, rep, signOut, refreshRep }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
