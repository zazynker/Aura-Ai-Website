import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const PRODUCTION_DOMAINS = new Set(["lazoraai.com", "www.lazoraai.com"]);

type ProductConfig = {
  kind: "subscription" | "credit_pack" | "welcome_gift" | "template_single_generation";
  liveId: string;
  testId?: string;
};

const PRODUCTS: Record<string, ProductConfig> = {
  "pdt_0NcgjVAuBCls2boj8YVVr": {
    kind: "subscription", liveId: "pdt_0NcgjVAuBCls2boj8YVVr", testId: "pdt_0NcggxPQDj4ubWiMm4v1R",
  },
  "pdt_0NctYcepOLToIEIh1qBxi": {
    kind: "subscription", liveId: "pdt_0NctYcepOLToIEIh1qBxi", testId: "pdt_0Ndog1iWEKzhVYPKqZmkk",
  },
  "pdt_0NcgjXHAv4YGQGRus5jTK": {
    kind: "credit_pack", liveId: "pdt_0NcgjXHAv4YGQGRus5jTK", testId: "pdt_0NcghkLi3zBTrLsbGGn19",
  },
  "pdt_0NcgjZRQg8BmUo91hSPAw": {
    kind: "credit_pack", liveId: "pdt_0NcgjZRQg8BmUo91hSPAw", testId: "pdt_0NcgiNG0uIQjRipAMZ15E",
  },
  "pdt_0Ncgjbbx6J3ziExgmpLvs": {
    kind: "credit_pack", liveId: "pdt_0Ncgjbbx6J3ziExgmpLvs", testId: "pdt_0NcgiRadG6WEpRdvKgWqc",
  },
  "pdt_0Nj2BOIxjWXYK7KJFznSj": {
    kind: "welcome_gift", liveId: "pdt_0Nj2BOIxjWXYK7KJFznSj",
  },
  "pdt_0Nj2BYdzYVo0gpmFzdwyl": {
    kind: "welcome_gift", liveId: "pdt_0Nj2BYdzYVo0gpmFzdwyl",
  },
  "pdt_0Nj2BkTObSUe7155RRQsG": {
    kind: "welcome_gift", liveId: "pdt_0Nj2BkTObSUe7155RRQsG",
  },
  "pdt_0Nmwq5LW1mFDcLmfPtUta": {
    kind: "template_single_generation", liveId: "pdt_0Nmwq5LW1mFDcLmfPtUta",
  },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isProduction(origin: string | null): boolean {
  if (!origin) return true;
  try {
    return PRODUCTION_DOMAINS.has(new URL(origin).hostname);
  } catch {
    return true;
  }
}

function safeReturnUrl(candidate: unknown, origin: string | null): string {
  const fallback = "https://lazoraai.com/#/pricing";
  if (typeof candidate !== "string") return fallback;
  try {
    const url = new URL(candidate);
    const allowed = new Set(["lazoraai.com", "www.lazoraai.com"]);
    if (origin) {
      try { allowed.add(new URL(origin).hostname); } catch { /* ignore */ }
    }
    return url.protocol === "https:" && allowed.has(url.hostname) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function getBilling(countryCode: string) {
  const billingMap: Record<string, { city: string; country: string; state: string; street: string; zipcode: string }> = {
    US: { city: "New York", country: "US", state: "NY", street: "NA", zipcode: "10001" },
    SG: { city: "Singapore", country: "SG", state: "Singapore", street: "NA", zipcode: "000000" },
    CN: { city: "Shanghai", country: "CN", state: "Shanghai", street: "NA", zipcode: "200000" },
    GB: { city: "London", country: "GB", state: "England", street: "NA", zipcode: "SW1A1AA" },
  };
  return billingMap[countryCode] || billingMap.US;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.slice("Bearer ".length),
    );
    if (authError || !user?.id || !user.email) return json(401, { error: "Unauthorized" });

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const requestedProductId = typeof body?.productId === "string" ? body.productId : "";
    const product = PRODUCTS[requestedProductId];
    if (!product) return json(400, { error: "Unknown product" });

    const origin = req.headers.get("origin") || req.headers.get("referer");
    const production = isProduction(origin);
    if (!production && !product.testId) {
      return json(503, { error: "This product is not configured in test mode" });
    }

    if (product.kind === "welcome_gift") {
      const { data: eligibility, error: eligibilityError } = await supabase.rpc(
        "get_my_welcome_gift_eligibility",
      );
      if (eligibilityError) {
        console.error("Welcome gift eligibility check failed", eligibilityError.message);
        return json(500, { error: "Unable to verify offer eligibility" });
      }
      if (!eligibility?.eligible) {
        return json(403, {
          error: "Welcome gift is not available",
          reason: eligibility?.reason || "not_eligible",
        });
      }
    }

    const apiUrl = production
      ? "https://live.dodopayments.com"
      : "https://test.dodopayments.com";
    const apiKey = production
      ? Deno.env.get("DODO_API_KEY")
      : Deno.env.get("DODO_TEST_API_KEY");
    if (!apiKey) return json(500, { error: "Payment service is not configured" });

    const actualProductId = production ? product.liveId : product.testId!;
    const successUrl = safeReturnUrl(body?.successUrl, origin);
    const country = typeof body?.country === "string" ? body.country.toUpperCase() : "US";
    const clientMetadata = body?.metadata && typeof body.metadata === "object"
      ? body.metadata as Record<string, unknown>
      : {};
    const metadata = {
      ...Object.fromEntries(
        Object.entries(clientMetadata)
          .filter(([key, value]) => /^[a-zA-Z0-9_]{1,40}$/.test(key) && typeof value === "string")
          .map(([key, value]) => [key, String(value).slice(0, 200)]),
      ),
      user_id: user.id,
      user_email: user.email,
      purchase_type: product.kind,
      live_product_id: product.liveId,
    };

    const common = {
      billing: getBilling(country),
      customer: {
        email: user.email,
        name: user.user_metadata?.name || user.email.split("@")[0],
      },
      payment_link: true,
      return_url: successUrl,
      metadata,
    };

    const isSubscription = product.kind === "subscription";
    const endpoint = isSubscription ? "/subscriptions" : "/payments";
    const requestBody = isSubscription
      ? { ...common, product_id: actualProductId, quantity: 1 }
      : { ...common, product_cart: [{ product_id: actualProductId, quantity: 1 }] };

    const response = await fetch(`${apiUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const details = await response.text();
      console.error("Dodo checkout creation failed", response.status, details);
      return json(502, { error: "Failed to create checkout" });
    }

    const data = await response.json();
    const checkoutUrl = data.payment_link || data.url || data.checkout_url;
    const paymentId = data.payment_id || data.subscription_id || data.id;
    if (!checkoutUrl || !paymentId) {
      console.error("Dodo response did not contain checkout identifiers", data);
      return json(502, { error: "Invalid checkout response" });
    }

    return json(200, {
      checkout_url: checkoutUrl,
      payment_id: paymentId,
      mode: production ? "live" : "test",
    });
  } catch (error) {
    console.error("create-checkout error", error);
    return json(500, { error: "Internal error" });
  }
});
