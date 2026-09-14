import { createServerFn } from "@tanstack/react-start";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const pack = { amount: 9900, credits: 10, currency: "INR" } as const;

export const getAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: wallet }, { data: purchases }] = await Promise.all([
      context.supabase.from("credit_wallets").select("balance").eq("user_id", context.userId).maybeSingle(),
      context.supabase.from("purchases").select("id, amount_paise, credits, status, created_at").eq("user_id", context.userId).order("created_at", { ascending: false }).limit(10),
    ]);
    return { balance: wallet?.balance ?? 1, purchases: purchases ?? [] };
  });

export const consumeCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: wallet, error } = await context.supabase.from("credit_wallets").select("balance").eq("user_id", context.userId).single();
    if (error || !wallet || wallet.balance < 1) throw new Error("You need a screenshot credit to export.");
    const { error: updateError } = await context.supabase.from("credit_wallets").update({ balance: wallet.balance - 1 }).eq("user_id", context.userId).eq("balance", wallet.balance);
    if (updateError) throw new Error("Could not use your credit. Please try again.");
    return { balance: wallet.balance - 1 };
  });

export const createRazorpayOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const keyId = process.env['RAZORPAY_KEY_ID'];
    const keySecret = process.env['RAZORPAY_KEY_SECRET'];
    if (!keyId || !keySecret) throw new Error("Payments are being connected. Please try again shortly.");
    const receipt = `ssg_${context.userId.slice(0, 8)}_${Date.now()}`;
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: pack.amount, currency: pack.currency, receipt, notes: { user_id: context.userId, credits: String(pack.credits) } }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Payment provider error [${response.status}]: ${raw}`);
    const order = z.object({ id: z.string(), amount: z.number(), currency: z.string() }).parse(JSON.parse(raw));
    const { data: purchase, error } = await context.supabase.from("purchases").insert({ user_id: context.userId, provider_order_id: order.id, amount_paise: pack.amount, credits: pack.credits }).select("id").single();
    if (error) throw new Error("Could not save the payment order.");
    return { keyId, orderId: order.id, amount: order.amount, currency: order.currency, purchaseId: purchase.id, credits: pack.credits };
  });

export const confirmRazorpayPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ orderId: z.string(), paymentId: z.string(), signature: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const secret = process.env['RAZORPAY_KEY_SECRET'];
    if (!secret) throw new Error("Payment verification is unavailable.");
    const expected = createHmac("sha256", secret).update(`${data.orderId}|${data.paymentId}`).digest("hex");
    const a = Buffer.from(data.signature); const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Payment verification failed.");
    const { data: purchase } = await context.supabase.from("purchases").select("id,status,credits").eq("provider_order_id", data.orderId).eq("user_id", context.userId).single();
    if (!purchase) throw new Error("Payment order not found.");
    if (purchase.status === "paid") return { ok: true };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: wallet } = await supabaseAdmin.from("credit_wallets").select("balance").eq("user_id", context.userId).single();
    await supabaseAdmin.from("purchases").update({ status: "paid", provider_payment_id: data.paymentId }).eq("id", purchase.id).eq("status", "created");
    await supabaseAdmin.from("credit_wallets").update({ balance: (wallet?.balance ?? 0) + purchase.credits }).eq("user_id", context.userId);
    return { ok: true };
  });
