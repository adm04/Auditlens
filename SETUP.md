# AuditLens — Accounts & Payments Setup (Supabase + Google + Dodo Payments)

This connects sign-in (Google or email) and the $10/month Pro subscription. Until you finish it, the extension runs in **developer mode**: no sign-in, and a "simulate Pro" switch in Settings.

Total time: about 45–60 minutes. Do everything in **Dodo test mode** first, then switch to live (step 8).

```
Extension ──sign in──▶ Supabase Auth (Google / email)
Extension ──get_plan / consume_audit──▶ Supabase database (RLS + RPCs)
Extension ──create-checkout──▶ Edge Function ──▶ Dodo checkout page ──pay──▶ Dodo
Dodo ──signed webhook──▶ Edge Function dodo-webhook ──▶ subscriptions table ──▶ extension unlocks Pro
```

---

## 1. Supabase project

1. Create a project at **supabase.com** (choose a region near your users).
2. In **SQL Editor**, paste the contents of `backend/supabase/migrations/20261012000000_billing.sql`, then **Run**. This creates the plans, usage and webhook tables, with row-level security.
3. In **Project Settings → API**, copy:
   - **Project URL**, e.g. `https://abcd1234.supabase.co`
   - **anon public** key

## 2. Get a fixed extension ID (needed for Google sign-in)

Google sign-in returns to `https://<extension-id>.chromiumapp.org/`, so the ID must stay the same.

- **After publishing on the Chrome Web Store:** the store ID is permanent. Use that.
- **While developing:** either upload a draft to the Chrome Web Store dashboard and copy its public key into `manifest.json` as `"key": "…"`, or keep using the ID shown in `chrome://extensions`. The unpacked ID only stays the same while the folder path doesn't change.

Your redirect URL is `https://<extension-id>.chromiumapp.org/`. To confirm it, open the extension's service worker console and run `chrome.identity.getRedirectURL()`.

## 3. Email sign-in (Supabase → Authentication)

1. **Sign In / Providers → Email:** enabled.
   - **Confirm email** on: users must click a link before signing in. AuditLens handles this ("Check your inbox").
   - **Confirm email** off: users can audit immediately.
2. **URL Configuration:**
   - Set **Site URL** to your website (or `https://<extension-id>.chromiumapp.org/`).
   - Add `https://<extension-id>.chromiumapp.org/` to **Redirect URLs**.
3. Optional: under **Emails**, customise the confirm and reset templates with your branding. For real volume, set up custom SMTP (for example Resend or Postmark), because Supabase's built-in mailer is rate-limited.

## 4. Google sign-in

1. Go to **Google Cloud Console → APIs & Services**.
2. Configure the **OAuth consent screen**: External, app name "AuditLens", support email, and your privacy policy and terms URLs.
3. Go to **Credentials → Create credentials → OAuth client ID → Web application**.
   - Add this **Authorised redirect URI**: `https://<your-project>.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client secret**.
5. In **Supabase → Authentication → Sign In / Providers → Google**:
   - Enable it.
   - Paste the Client ID and secret.
   - Save.

## 5. Dodo Payments

1. Sign up at **dodopayments.com**, complete business verification (KYC) for payouts to your Indian bank account, and stay in **Test mode**.
2. **Products → Create product → Subscription:**
   - Name: "AuditLens Pro"
   - Price: $10 USD, billed every 1 month.
   - Copy the **product ID** (`pdt_…`).
3. **Developer → API Keys:** create a key and copy it.
4. **Developer → Webhooks → Add endpoint:**
   - URL: `https://<your-project>.supabase.co/functions/v1/dodo-webhook`
   - Events: all `subscription.*` events. `payment.*` events are optional.
   - Copy the **signing secret** (`whsec_…`).

## 6. Deploy the Edge Functions

Install the Supabase CLI (see supabase.com/docs/guides/cli), then from the `backend/` folder:

```bash
supabase login
supabase link --project-ref <your-project-ref>

supabase secrets set \
  DODO_API_KEY=<test api key> \
  DODO_WEBHOOK_SECRET=<whsec_...> \
  DODO_PRO_PRODUCT_ID=<pdt_...> \
  DODO_ENV=test
# Optional: your own "thanks for upgrading" page instead of the built-in one
# supabase secrets set SITE_URL=https://yourwebsite.com/thanks

supabase functions deploy create-checkout
supabase functions deploy customer-portal
supabase functions deploy dodo-webhook --no-verify-jwt
supabase functions deploy checkout-done --no-verify-jwt
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically. Never put the service role key in the extension.

## 7. Point the extension at your backend

Edit **`src/config.js`**:

```js
SUPABASE_URL: 'https://abcd1234.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi…',
TERMS_URL: 'https://yourwebsite.com/terms',      // optional
PRIVACY_URL: 'https://yourwebsite.com/privacy',  // required by Google & the Chrome Web Store
```

Reload the extension. The popup now asks users to sign in.

### Test it end to end (test mode)

1. Create an account with your email, then try **Continue with Google**.
2. Run 3 audits. The 4th should show "You've used your 3 free audits this month".
3. Click **Upgrade**. Pay on Dodo's test checkout with a test card from Dodo's docs. Return to AuditLens; Pro unlocks within seconds.
4. Check Supabase **Table editor → subscriptions**: your row has `plan = pro`, `status = active`.
5. Click **Manage subscription** to open Dodo's billing portal, then cancel there. Pro stays active until the period ends, and then the account returns to Free.
6. In **Edge Functions → dodo-webhook → Logs**, check there are no errors.

## 8. Go live

1. In Dodo, switch to **Live mode**:
   - Create the same product again (live IDs differ) and copy its new product ID.
   - Create a live API key.
   - Add the live webhook endpoint and copy its new secret.
2. Update the secrets:
   ```bash
   supabase secrets set DODO_ENV=live DODO_API_KEY=<live key> DODO_WEBHOOK_SECRET=<live whsec> DODO_PRO_PRODUCT_ID=<live pdt>
   ```
3. Remove the developer toggle and publish:
   - Delete the "Developer: simulate Pro" label from `app/app.html`. It's already hidden when a backend is configured, but remove it anyway.
   - Bump the version in `manifest.json` and publish to the Chrome Web Store.

## How plans are enforced

- **Free:**
  - 3 single-page audits per calendar month (UTC), counted in the database by `consume_audit`.
  - The top 5 findings are shown in full; the rest are listed as locked.
  - PageSpeed scores are included.
  - PDF export is watermarked and contains only the top findings.
- **Pro ($10/month):**
  - Unlimited audits and multi-page site audits.
  - Every finding, the UI elements review and the heatmap.
  - All exports and your own branding.
  - AI copy suggestions.
- **Where limits are set:**
  - What each plan includes: `src/config.js → PLANS`.
  - The free audit limit, which must match `free_limit` in the SQL. A unit test checks they're equal.
  - Price: set in Dodo. `PRO_PRICE_LABEL` in config is only the label users see.
- **Grace periods:**
  - If a renewal webhook is late, Pro continues for 3 days after the period ends.
  - If Dodo can't charge the card (`on_hold`), Pro continues while Dodo retries, and the account box shows "Payment failed — update your card".
  - Offline users keep their last known plan for up to 7 days.
- **Honest limitation:** audits run on the user's computer, so a determined user could modify their copy of the extension to unlock screens. Audit counting and Pro status are server-side, which stops casual sharing. Anything that needs real protection, such as hosted AI or cloud sync, should run on the server.

## Costs to expect

- **Supabase:** the free tier covers early users. Pro is about $25/month once you outgrow it.
- **Dodo Payments:** per-transaction fee as a Merchant of Record. Dodo also handles VAT and sales tax. Check their pricing page for current rates.
- **Google sign-in:** free.
