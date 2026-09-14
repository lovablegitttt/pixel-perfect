import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  mode: z.enum(["translate", "fix"]),
  language: z.string().max(40).optional(),
  items: z.array(z.string().max(400)).min(1).max(400),
});

/**
 * Rewrites a list of detected words/lines with the Lovable AI gateway.
 * Used by the "Translate text" and "Fix text" tools. Returns an array with
 * exactly the same length as the input so the editor can map results 1:1.
 */
export const transformTexts = createServerFn({ method: "POST" })
  .inputValidator((input) => schema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("The text assistant is not available right now.");

    const instruction =
      data.mode === "translate"
        ? `Translate each item into ${data.language ?? "Spanish"}. Keep numbers, symbols, URLs and proper nouns intact. Keep translations short so they fit the same space.`
        : `Correct spelling, casing and obvious OCR mistakes in each item. Do not translate, do not rephrase, do not add or remove words. If an item is already correct, return it unchanged.`;

    const body = {
      model: "google/gemini-3.8-flash",
      messages: [
        {
          role: "system",
          content:
            "You process short text fragments taken from a screenshot. You always reply with a JSON object of the form {\"items\": string[]} containing exactly one result per input item, in the same order. Never add commentary.",
        },
        {
          role: "user",
          content: `${instruction}\n\nItems:\n${JSON.stringify(data.items)}`,
        },
      ],
      response_format: { type: "json_object" as const },
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 429) throw new Error("Too many requests — please try again in a moment.");
    if (res.status === 402) throw new Error("The text assistant needs more credits to continue.");
    if (!res.ok) throw new Error("The text assistant could not be reached. Please try again.");

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("The text assistant returned an unexpected answer.");
    }
    const out = z
      .object({ items: z.array(z.string()) })
      .safeParse(parsed);
    if (!out.success) throw new Error("The text assistant returned an unexpected answer.");

    // Guarantee a 1:1 mapping back to the caller's items.
    return {
      items: data.items.map((original, i) => out.data.items[i] ?? original),
    };
  });
