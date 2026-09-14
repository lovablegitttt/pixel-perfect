import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/public/webhooks/razorpay")({
  server: { handlers: { POST: async ({ request }) => {
    const secret = process.env['RAZORPAY_WEBHOOK_SECRET'];
    if (!secret) return new Response("Webhook unavailable", { status: 503 });
    const raw = await request.text();
    const supplied = request.headers.get("x-razorpay-signature") ?? "";
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const a = Buffer.from(supplied); const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Invalid signature", { status: 401 });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return new Response("Invalid JSON", { status: 400 }); }
    if (!body || typeof body !== "object") return new Response("Invalid event", { status: 400 });
    const event = body as { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; notes?: { user_id?: string } } } } };
    const payment = event.payload?.payment?.entity;
    if (event.event !== "payment.captured" || !payment?.id || !payment.order_id || !payment.notes?.user_id) return Response.json({ received: true });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const eventId = `${event.event}:${payment.id}`;
    const { error: eventError } = await supabaseAdmin.from("payment_events").insert({ provider_event_id: eventId, event_type: event.event, payload: body as never });
    if (eventError) return Response.json({ received: true, duplicate: true });
    const { data: purchase } = await supabaseAdmin.from("purchases").select("id,status,credits,user_id").eq("provider_order_id", payment.order_id).eq("user_id", payment.notes.user_id).single();
    if (purchase && purchase.status !== "paid") {
      const { data: wallet } = await supabaseAdmin.from("credit_wallets").select("balance").eq("user_id", purchase.user_id).single();
      await supabaseAdmin.from("purchases").update({ status: "paid", provider_payment_id: payment.id }).eq("id", purchase.id);
      await supabaseAdmin.from("credit_wallets").update({ balance: (wallet?.balance ?? 0) + purchase.credits }).eq("user_id", purchase.user_id);
    }
    return Response.json({ received: true });
  } } },
});
