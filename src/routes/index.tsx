import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Aperture, LogIn, LogOut, Sparkles, WalletCards } from "lucide-react";
import ScreenshotEditor from "@/components/ScreenshotEditor";
import { AuthDialog } from "@/components/AuthDialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { confirmRazorpayPayment, consumeCredit, createRazorpayOrder, getAccount } from "@/lib/billing.functions";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadRazorpay() {
  return new Promise<boolean>((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ScreenshotGuru — Screenshot Text Editor" },
      { name: "description", content: "Upload a screenshot, click any detected word and edit it with matching fonts and colors." },
      { property: "og:title", content: "ScreenshotGuru — Screenshot Text Editor" },
      { property: "og:description", content: "Edit the text inside any screenshot right in your browser." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Studio,
});

function Studio() {
  const [user, setUser] = useState<Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"]>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [notice, setNotice] = useState("");

  const accountFn = useServerFn(getAccount);
  const consumeFn = useServerFn(consumeCredit);
  const orderFn = useServerFn(createRazorpayOrder);
  const confirmFn = useServerFn(confirmRazorpayPayment);

  async function refresh() {
    try {
      const a = await accountFn();
      setBalance(a.balance);
    } catch {
      setBalance(null);
    }
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user) void refresh();
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => {
      setUser(s?.user ?? null);
      if (s?.user) void refresh();
      else setBalance(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function authorizeExport() {
    if (!user) {
      setAuthOpen(true);
      setNotice("Sign in to use your free export credit.");
      return false;
    }
    try {
      const r = await consumeFn();
      setBalance(r.balance);
      return true;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "You need a credit to export.");
      return false;
    }
  }

  async function buy() {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    setNotice("Opening secure checkout…");
    try {
      const o = await orderFn();
      if (!(await loadRazorpay()) || !window.Razorpay) throw new Error("Checkout could not load.");
      new window.Razorpay({
        key: o.keyId,
        amount: o.amount,
        currency: o.currency,
        name: "ScreenshotGuru",
        description: "10 screenshot export credits",
        order_id: o.orderId,
        handler: async (r: unknown) => {
          const p = r as { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
          await confirmFn({ data: { orderId: p.razorpay_order_id, paymentId: p.razorpay_payment_id, signature: p.razorpay_signature } });
          await refresh();
          setNotice("Payment successful — 10 credits added.");
        },
        theme: { color: "#168BFF" },
      }).open();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Checkout unavailable.");
    }
  }

  return (
    <div className="studio-page">
      <header className="studio-header">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="brand-mark">
            <Aperture className="size-5" />
          </span>
          <span className="font-display text-xl font-bold">ScreenshotGuru</span>
        </Link>
        <div className="header-actions">
          <span className="credit-pill">
            <WalletCards className="size-4" />
            {balance === null ? "1 free export" : `${balance} credits`}
          </span>
          <Button variant="outline" onClick={user ? () => supabase.auth.signOut() : () => setAuthOpen(true)}>
            {user ? (
              <>
                <LogOut />
                Sign out
              </>
            ) : (
              <>
                <LogIn />
                Sign in
              </>
            )}
          </Button>
          <Button onClick={buy}>Get 10 credits · ₹99</Button>
        </div>
      </header>

      <main className="studio-main mx-auto w-full max-w-5xl px-4 pb-10">
        <div className="studio-intro">
          <div>
            <p className="eyebrow">SCREENSHOT TEXT EDITOR</p>
            <h1>Make every screenshot look intentional.</h1>
            <p>Upload an image, click detected text, then edit with pixel-matched fonts and colors.</p>
          </div>
          <span className="secure-chip">
            <Sparkles className="size-4" /> Processed in your browser
          </span>
        </div>

        {notice && (
          <div className="notice">
            {notice}
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}

        <ScreenshotEditor onBeforeExport={authorizeExport} />

        <div className="below-editor">
          <span>First export free</span>
          <span>Instant digital credit delivery</span>
          <span>Secure payment by Razorpay</span>
        </div>
      </main>

      <footer className="studio-footer">
        <span>© ScreenshotGuru</span>
        <nav>
          <Link to="/about">About</Link>
          <Link to="/contact">Contact</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/refunds">Refunds</Link>
          <Link to="/delivery">Delivery</Link>
        </nav>
      </footer>

      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
