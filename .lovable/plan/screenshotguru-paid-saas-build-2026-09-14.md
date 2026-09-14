# ScreenshotGuru paid SaaS build

## Product experience
- Replace the blank page with the working uploaded ScreenshotGuru editor.
- Use the chosen Electric Sky palette, Outfit headings, Figtree body text, blue-white glass surfaces, and a focused left-side studio layout.
- Make the experience polished on phone and desktop, with a compact navigation bar, clear usage balance, tool search, and direct access to account, pricing, support, and company pages.

## Working tool suite
- Preserve and integrate the existing OCR-based screenshot text editor, including editable detected words, font matching, undo/redo, zoom, and PNG export.
- Add the screenshot-listed tools as usable workflows: erase text, copy/image-to-text, add or replace text, fix text, font finder, translate extracted text, AI-assisted image text editing, poster text editing, ecommerce main-image text editing, resize images, image-to-PDF, PDF-to-images, scanned-document conversion, and PDF text editing.
- Group related workflows into Image, Text, and PDF sections without duplicating the underlying processing.
- Process suitable image/PDF operations in the browser, show progress and errors, and provide real downloads rather than demo-only buttons.

## Credits and Razorpay
- Enable Lovable Cloud for accounts, credit balances, purchases, and payment records.
- Give each new account one free completed screenshot export, then sell a pack of 10 screenshot credits for ₹99.
- Add sign-up/sign-in, visible remaining credits, checkout, successful-payment credit allocation, duplicate-payment protection, and purchase history.
- Create secure server-side Razorpay order and webhook handling. Never expose payment secrets in browser code.
- Do not use the key visible in the uploaded screenshot because it is publicly exposed; after the secure payment endpoints exist, request a newly regenerated Razorpay Key ID and Key Secret through the secure secret form.

## Trust and approval pages
- Add About, Contact, Pricing, Privacy Policy, Terms & Conditions, No Refund/Cancellation Policy, and Digital Delivery/Shipping Policy pages.
- Publish the supplied details consistently: ScreenshotGuru, Mandore, Jodhpur, Rajasthan, India; +91 6367530490; screesnhotguru@gmail.com.
- State that this is a digital SaaS with no physical shipping and access/credits are delivered after successful payment.
- Use a clear no-refund policy for consumed digital credits while retaining legally required remedies for duplicate charges or service non-delivery.
- Avoid unsupported security or certification claims. Explain local file processing and any necessary payment/account data handling accurately.
- Add accessible navigation, a minimal footer, unique page titles/descriptions, and contact links.

## Security and launch readiness
- Validate uploads and payment requests, limit accepted file types/sizes, protect account data, and keep payment credentials server-side.
- Use HTTPS automatically on the Lovable preview/published domain; no fake SSL badge or unsupported certificate claim.
- Verify the complete mobile layout at the current 390×844 viewport and desktop, test editor exports and credit gating, and resolve build/runtime errors.

## Technical details
- Reuse `ScreenshotEditor`, `image-analysis`, and `font-fit` from the uploaded archive without copying its Git metadata.
- Add only browser/edge-compatible libraries needed for OCR and PDF/image processing.
- Create Cloud tables and row-level access rules for profiles, credit balances, purchases, and webhook events, including explicit grants.
- Implement payment calls as authenticated server functions and the Razorpay webhook as a signature-verified public server endpoint.
