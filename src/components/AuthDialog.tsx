import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

export function AuthDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [message, setMessage] = useState("");
  if (!open) return null;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMessage("Please wait…");
    const result = mode === "signup" ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) setMessage(result.error.message); else if (mode === "signup" && !result.data.session) setMessage("Check your email to confirm your account."); else { setMessage("Signed in."); onClose(); }
  }
  async function google() { const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin }); if (result.error) setMessage(result.error.message); }
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-overlay p-4 backdrop-blur-sm"><div className="glass-panel w-full max-w-md p-6"><div className="flex items-center justify-between"><div><p className="eyebrow">YOUR WORKSPACE</p><h2 className="font-display text-2xl font-semibold">{mode === "signin" ? "Welcome back" : "Create your account"}</h2></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X /></Button></div><Button variant="outline" className="mt-6 w-full" onClick={google}>Continue with Google</Button><div className="my-5 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border"/>or use email<span className="h-px flex-1 bg-border"/></div><form className="space-y-3" onSubmit={submit}><input className="field" type="email" placeholder="Email address" required value={email} onChange={e=>setEmail(e.target.value)}/><input className="field" type="password" placeholder="Password (minimum 6 characters)" minLength={6} required value={password} onChange={e=>setPassword(e.target.value)}/><Button className="w-full" type="submit">{mode === "signin" ? "Sign in" : "Create account"}</Button></form>{message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}<button className="mt-5 w-full text-sm font-semibold text-primary" onClick={()=>{setMode(mode === "signin" ? "signup" : "signin");setMessage("")}}>{mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}</button></div></div>;
}
