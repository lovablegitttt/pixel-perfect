import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

// Known disposable / temporary mail providers — blocked at sign-up.
const BLOCKED_DOMAINS = new Set([
  "10minutemail.com", "10minutemail.net", "20minutemail.com", "33mail.com",
  "anonbox.net", "byom.de", "dispostable.com", "disposablemail.com",
  "emailondeck.com", "fakeinbox.com", "fakemail.net", "getairmail.com",
  "getnada.com", "guerrillamail.com", "guerrillamail.info", "guerrillamail.biz",
  "grr.la", "sharklasers.com", "spam4.me", "inboxbear.com", "inboxkitten.com",
  "mail-temp.com", "mail7.io", "mailcatch.com", "maildrop.cc", "mailinator.com",
  "mailnesia.com", "mailsac.com", "mintemail.com", "moakt.com", "mohmal.com",
  "mytemp.email", "nada.email", "temp-mail.io", "temp-mail.org", "tempmail.com",
  "tempmail.net", "tempmail.plus", "tempmailo.com", "tempinbox.com",
  "tempr.email", "throwawaymail.com", "trashmail.com", "trashmail.de",
  "yopmail.com", "yopmail.fr", "yopmail.net", "dropmail.me", "emailfake.com",
  "fakemailgenerator.com", "luxusmail.org", "linshiyouxiang.net", "burnermail.io",
  "spambog.com", "mailpoof.com", "minuteinbox.com", "tmail.ws", "vomoto.com",
  "wegwerfmail.de", "einrot.com", "cuvox.de", "armyspy.com", "teleworm.us",
  "rhyta.com", "jourrapide.com", "dayrep.com", "superrito.com", "gustr.com",
  "fleckens.hu", "harakirimail.com", "instantemailaddress.com", "tempsky.com",
]);

const SUSPICIOUS_PATTERNS = [/temp.?mail/i, /throwaway/i, /trash.?mail/i, /fake.?mail/i, /disposable/i, /minutemail/i, /burner/i, /guerrilla/i, /mailinator/i, /yopmail/i];

function validateEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return "Please enter a valid email address.";
  const domain = email.split("@")[1] ?? "";
  if (BLOCKED_DOMAINS.has(domain)) return "Temporary email addresses are not allowed. Please use your real email.";
  if (SUSPICIOUS_PATTERNS.some((p) => p.test(domain))) return "Temporary email addresses are not allowed. Please use your real email.";
  return null;
}

export function AuthDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const emailError = validateEmail(email);
    if (emailError) { setMessage(emailError); return; }
    if (mode === "signup") {
      const name = username.trim();
      if (name.length < 3 || !/^[a-zA-Z0-9_.]+$/.test(name)) {
        setMessage("Username must be at least 3 characters (letters, numbers, _ or . only).");
        return;
      }
    }
    setLoading(true);
    setMessage("Please wait…");
    const clean = email.trim().toLowerCase();
    const result =
      mode === "signup"
        ? await supabase.auth.signUp({
            email: clean,
            password,
            options: {
              emailRedirectTo: window.location.origin,
              data: { full_name: username.trim(), username: username.trim() },
            },
          })
        : await supabase.auth.signInWithPassword({ email: clean, password });
    setLoading(false);
    if (result.error) setMessage(result.error.message);
    else if (mode === "signup" && !result.data.session) setMessage("Check your email to confirm your account.");
    else { setMessage("Signed in."); onClose(); }
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-overlay p-4 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-md p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="eyebrow">YOUR WORKSPACE</p>
            <h2 className="font-display text-2xl font-semibold">{mode === "signin" ? "Welcome back" : "Create your account"}</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X /></Button>
        </div>

        <form className="mt-6 space-y-3" onSubmit={submit}>
          {mode === "signup" && (
            <input
              className="field"
              type="text"
              placeholder="Username"
              autoComplete="username"
              minLength={3}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}
          <input className="field" type="email" placeholder="Email address" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="field" type="password" placeholder="Password (minimum 6 characters)" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button className="w-full" type="submit" disabled={loading}>{mode === "signin" ? "Sign in" : "Sign up"}</Button>
        </form>

        {mode === "signup" && (
          <p className="mt-3 text-xs text-muted-foreground">Temporary or disposable email addresses are not accepted.</p>
        )}
        {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}

        <button className="mt-5 w-full text-sm font-semibold text-primary" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>
          {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
