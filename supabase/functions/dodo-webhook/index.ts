import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DodoPayments } from "https://esm.sh/dodopayments@2.4.1";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ============================================
// Test/Live Mode 自动检测
// ============================================
const DODO_MODE = Deno.env.get("DODO_MODE") || "live";
const isTestMode = DODO_MODE === "test";

// Product ID to credits mapping - 包含 Live 和 Test ID
const PRODUCT_CREDITS: Record<string, { credits: number; type: string }> = {
  // Live Mode Product IDs
  "pdt_0NcgjVAuBCls2boj8YVVr": { credits: 3000, type: "pro_monthly" },
  "pdt_0NctYcepOLToIEIh1qBxi": { credits: 3000, type: "pro_yearly" },
  "pdt_0NcgjXHAv4YGQGRus5jTK": { credits: 500, type: "credits_500" },
  "pdt_0NcgjZRQg8BmUo91hSPAw": { credits: 1000, type: "credits_1000" },
  "pdt_0Ncgjbbx6J3ziExgmpLvs": { credits: 2000, type: "credits_2000" },
  "pdt_0Nj2BOIxjWXYK7KJFznSj": { credits: 120, type: "welcome_gift_120" },
  "pdt_0Nj2BYdzYVo0gpmFzdwyl": { credits: 250, type: "welcome_gift_250" },
  "pdt_0Nj2BkTObSUe7155RRQsG": { credits: 600, type: "welcome_gift_600" },
  // The one-shot template product is converted into the exact server quote
  // carried in checkout metadata. It must never fall through to the $1.99
  // welcome-gift amount mapping.
  "pdt_0Nmwq5LW1mFDcLmfPtUta": { credits: 0, type: "template_single_generation" },
  // Test Mode Product IDs
  "pdt_0NcggxPQDj4ubWiMm4v1R": { credits: 3000, type: "pro_monthly" },
  "pdt_0Ndog1iWEKzhVYPKqZmkk": { credits: 3000, type: "pro_yearly" },
  "pdt_0NcghkLi3zBTrLsbGGn19": { credits: 500, type: "credits_500" },
  "pdt_0NcgiNG0uIQjRipAMZ15E": { credits: 1000, type: "credits_1000" },
  "pdt_0NcgiRadG6WEpRdvKgWqc": { credits: 2000, type: "credits_2000" },
};

// Amount (in cents) to credits mapping (for subscriptions)
const SUBSCRIPTION_AMOUNT_INFO: Record<number, { credits: number; plan: string; type: string }> = {
  2900: { credits: 3000, plan: "Pro", type: "pro_monthly" },
  23880: { credits: 3000, plan: "Pro", type: "pro_yearly" },
};

// One-time purchase amounts (in cents)
const ONETIME_AMOUNT_INFO: Record<number, { credits: number; type: string }> = {
  199: { credits: 120, type: "welcome_gift_120" },
  299: { credits: 250, type: "welcome_gift_250" },
  599: { credits: 600, type: "welcome_gift_600" },
  700: { credits: 500, type: "credits_500" },
  1200: { credits: 1000, type: "credits_1000" },
  2200: { credits: 2000, type: "credits_2000" },
};

// Helper: Calculate next issue date (30 days from now)
function getNextIssueDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, webhook-id, webhook-signature, webhook-timestamp",
      },
    });
  }

  try {
    // Dodo signs the exact raw body. Never call req.json() before verification.
    const rawBody = await req.text();
    const webhookId = req.headers.get("webhook-id") || "";
    const webhookSignature = req.headers.get("webhook-signature") || "";
    const webhookTimestamp = req.headers.get("webhook-timestamp") || "";
    const webhookSecret =
      Deno.env.get("DODO_WEBHOOK_SECRET") ||
      Deno.env.get("DODO_PAYMENTS_WEBHOOK_KEY");
    const dodoApiKey = Deno.env.get("DODO_API_KEY");

    if (!webhookSecret || !dodoApiKey) {
      console.error("Webhook verification is not configured");
      return new Response(
        JSON.stringify({ error: "Webhook verification is not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!webhookId || !webhookSignature || !webhookTimestamp) {
      console.error("Missing required Dodo webhook headers");
      return new Response(
        JSON.stringify({ error: "Missing webhook verification headers" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      const dodo = new DodoPayments({
        bearerToken: dodoApiKey,
        webhookKey: webhookSecret,
      });
      dodo.webhooks.unwrap(rawBody, {
        headers: {
          "webhook-id": webhookId,
          "webhook-signature": webhookSignature,
          "webhook-timestamp": webhookTimestamp,
        },
      });
    } catch (verificationError) {
      console.error("Dodo webhook signature verification failed", verificationError);
      return new Response(
        JSON.stringify({ error: "Invalid webhook signature" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON payload" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    
    console.log("=== WEBHOOK RECEIVED ===");
    console.log(`[${DODO_MODE.toUpperCase()} MODE]`);
    console.log("Type:", payload.type);
    console.log("Full payload:", JSON.stringify(payload, null, 2));

    // ========================================
    // PAYMENT SUCCEEDED - Add credits & create purchase record
    // ========================================
    if (payload.type === "payment.succeeded") {
      const data = payload.data;
      const customerEmail = data?.customer?.email;
      const totalAmount = data?.total_amount;
      const subscriptionId = data?.subscription_id;
      const productCart = data?.product_cart;
      const paymentId = data?.payment_id;
      const productId = Array.isArray(productCart) && productCart.length > 0
        ? productCart[0]?.product_id
        : data?.product_id;

      // Welcome gifts use a dedicated atomic RPC. This path never grants credits
      // by email and is idempotent by both Dodo payment ID and webhook ID.
      if (typeof productId === "string" && PRODUCT_CREDITS[productId]?.type.startsWith("welcome_gift_")) {
        const metadata = data?.metadata || {};
        const userId = metadata?.user_id;
        const currency = String(data?.currency || "USD").toUpperCase();

        if (!userId || !paymentId || !webhookId) {
          console.error("Welcome gift payment is missing trusted identifiers", {
            hasUserId: Boolean(userId),
            hasPaymentId: Boolean(paymentId),
            hasWebhookId: Boolean(webhookId),
            productId,
          });
          return new Response(
            JSON.stringify({ error: "Welcome gift payment requires manual review" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const { data: redemption, error: redemptionError } = await supabase.rpc(
          "redeem_welcome_gift",
          {
            p_user_id: userId,
            p_payment_id: paymentId,
            p_event_id: webhookId,
            p_product_id: productId,
            p_amount_cents: totalAmount,
            p_currency: currency,
            p_payload: payload,
          },
        );

        if (redemptionError) {
          console.error("Welcome gift RPC failed", redemptionError);
          return new Response(
            JSON.stringify({ error: "Welcome gift processing failed" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        if (!redemption?.success) {
          console.error("Welcome gift requires manual review", {
            paymentId,
            webhookId,
            userId,
            productId,
            reason: redemption?.error,
          });
          // A paid but ineligible order cannot be fixed by repeated delivery.
          // Acknowledge it to prevent a retry storm; logs retain the reason.
          return new Response(JSON.stringify({
            success: true,
            action: "welcome_gift_manual_review",
            reason: redemption?.error || "not_eligible",
          }), { headers: { "Content-Type": "application/json" } });
        }

        console.log("Welcome gift processed", {
          paymentId,
          webhookId,
          userId,
          productId,
          duplicate: Boolean(redemption?.duplicate),
          creditsAdded: redemption?.credits_added || 0,
          newBalance: redemption?.new_balance,
        });

        return new Response(JSON.stringify({
          success: true,
          action: redemption?.duplicate ? "welcome_gift_duplicate" : "welcome_gift_redeemed",
          creditsAdded: redemption?.credits_added || 0,
          newTotal: redemption?.new_balance,
        }), { headers: { "Content-Type": "application/json" } });
      }

      if (!customerEmail) {
        console.error("Missing customer email");
        return new Response(JSON.stringify({ error: "Missing customer email" }), { status: 400 });
      }

      let creditsToAdd = 0;
      let newPlan: string | null = null;
      let productType = "unknown";
      let isTemplateSingleGeneration = false;

      // Determine credits and product type
      if (productCart && Array.isArray(productCart) && productCart.length > 0) {
        const productId = productCart[0].product_id;
        const productInfo = PRODUCT_CREDITS[productId];
        if (productInfo) {
          creditsToAdd = productInfo.credits;
          productType = productInfo.type;
          isTemplateSingleGeneration = productType === "template_single_generation";
          if (productType.startsWith("pro_")) {
            newPlan = "Pro";
          }
        } else {
          console.warn(`Unknown product ID: ${productId} - attempting amount-based lookup`);
        }
      }

      if (isTemplateSingleGeneration) {
        const metadata = data?.metadata && typeof data.metadata === "object"
          ? data.metadata as Record<string, unknown>
          : {};
        const quotedCredits = Number(metadata.estimatedCredits);
        if (!Number.isSafeInteger(quotedCredits) || quotedCredits < 1 || quotedCredits > 1000) {
          console.error("Template generation payment has an invalid server quote", {
            paymentId,
            productId,
            quotedCredits,
          });
          return new Response(JSON.stringify({ error: "Invalid template generation quote" }), { status: 400 });
        }
        creditsToAdd = quotedCredits;
      }
      
      // Fallback: try subscription ID lookup
      if (creditsToAdd === 0 && !isTemplateSingleGeneration && subscriptionId) {
        const subscriptionInfo = SUBSCRIPTION_AMOUNT_INFO[totalAmount];
        if (subscriptionInfo) {
          creditsToAdd = subscriptionInfo.credits;
          newPlan = subscriptionInfo.plan;
          productType = subscriptionInfo.type;
        }
      }
      
      // Fallback: try amount-based lookup
      if (creditsToAdd === 0 && !isTemplateSingleGeneration) {
        const onetimeInfo = ONETIME_AMOUNT_INFO[totalAmount];
        if (onetimeInfo) {
          creditsToAdd = onetimeInfo.credits;
          productType = onetimeInfo.type;
        } else {
          const subscriptionInfo = SUBSCRIPTION_AMOUNT_INFO[totalAmount];
          if (subscriptionInfo) {
            creditsToAdd = subscriptionInfo.credits;
            newPlan = subscriptionInfo.plan;
            productType = subscriptionInfo.type;
          }
        }
      }

      if (creditsToAdd === 0) {
        console.error("Could not determine credits for payment");
        return new Response(JSON.stringify({ error: "Unknown product or amount" }), { status: 400 });
      }

      // Find user
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("id, credits, plan")
        .eq("email", customerEmail)
        .single();

      if (userError || !user) {
        console.error("User not found:", customerEmail);
        return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
      }

      // Update user credits and plan
      const newCredits = (user.credits || 0) + creditsToAdd;
      const updateData: { credits: number; plan?: string } = { credits: newCredits };
      if (newPlan) updateData.plan = newPlan;

      const { error: updateError } = await supabase
        .from("users")
        .update(updateData)
        .eq("id", user.id);

      if (updateError) {
        console.error("Failed to update user:", updateError);
        return new Response(JSON.stringify({ error: "Update failed" }), { status: 500 });
      }

      // Create purchase record
      const { error: purchaseError } = await supabase
        .from("purchases")
        .insert({
          user_id: user.id,
          user_email: customerEmail,
          payment_id: paymentId,
          subscription_id: subscriptionId,
          product_type: productType,
          amount_cents: totalAmount,
          credits_granted: creditsToAdd,
          credits_remaining: creditsToAdd,
        });

      if (purchaseError) {
        console.error("Failed to create purchase record:", purchaseError);
      }

      // ========================================
      // Create/Reset active_subscriptions record for ALL subscriptions (monthly & yearly)
      // ========================================
      if ((productType === "pro_yearly" || productType === "pro_monthly") && subscriptionId) {
        // Check if subscription already exists
        const { data: existingSub } = await supabase
          .from("active_subscriptions")
          .select("id, status")
          .eq("subscription_id", subscriptionId)
          .single();

        // Determine subscription-specific values
        const isYearly = productType === "pro_yearly";
        const monthsTotal = isYearly ? 12 : 1;
        const nextIssueAt = isYearly ? getNextIssueDate() : null;

        if (!existingSub) {
          // New subscription - create record
          const { error: subError } = await supabase
            .from("active_subscriptions")
            .insert({
              user_id: user.id,
              user_email: customerEmail,
              subscription_id: subscriptionId,
              product_type: productType,
              status: "active",
              credits_per_month: 3000,
              months_total: monthsTotal,
              months_issued: 1,
              next_issue_at: nextIssueAt,
            });

          if (subError) {
            console.error("Failed to create active_subscription:", subError);
          } else {
            console.log(`Created active_subscription for ${productType}: ${subscriptionId}`);
          }
        } else {
          // Existing subscription - update/reactivate
          const { error: subUpdateError } = await supabase
            .from("active_subscriptions")
            .update({
              status: "active",
              months_issued: 1,
              next_issue_at: nextIssueAt,
              cancelled_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq("subscription_id", subscriptionId);

          if (subUpdateError) {
            console.error("Failed to update active_subscription:", subUpdateError);
          } else {
            console.log(`Updated active_subscription for ${productType}: ${subscriptionId}`);
          }
        }
      }

      console.log(`SUCCESS [${DODO_MODE}]: Added ${creditsToAdd} credits to ${customerEmail}. Plan: ${newPlan || user.plan}. Total: ${newCredits}`);
      return new Response(JSON.stringify({ 
        success: true, 
        action: "credits_added",
        mode: DODO_MODE,
        creditsAdded: creditsToAdd, 
        newTotal: newCredits,
        plan: newPlan || user.plan
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ========================================
    // REFUND - Deduct credits using FIFO logic
    // ========================================
    if (payload.type === "refund.succeeded" || payload.type === "payment.refunded") {
      const data = payload.data;
      const customerEmail = data?.customer?.email;
      const paymentId = data?.payment_id;

      if (!customerEmail) {
        console.error("Missing customer email for refund");
        return new Response(JSON.stringify({ error: "Missing customer email" }), { status: 400 });
      }

      // Find user
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("id, credits, plan")
        .eq("email", customerEmail)
        .single();

      if (userError || !user) {
        console.error("User not found for refund:", customerEmail);
        return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
      }

      // Find the purchase record by payment_id
      const { data: purchase, error: purchaseError } = await supabase
        .from("purchases")
        .select("*")
        .eq("payment_id", paymentId)
        .eq("is_refunded", false)
        .single();

      let creditsToDeduct = 0;
      let shouldDowngrade = false;
      let subscriptionId: string | null = null;

      if (purchase) {
        // FIFO: Deduct credits_remaining, not credits_granted
        creditsToDeduct = purchase.credits_remaining;
        shouldDowngrade = purchase.product_type.startsWith("pro_");
        subscriptionId = purchase.subscription_id;

        // Mark purchase as refunded and clear remaining credits
        const { error: updatePurchaseError } = await supabase
          .from("purchases")
          .update({ 
            is_refunded: true, 
            refunded_at: new Date().toISOString(),
            credits_remaining: 0
          })
          .eq("id", purchase.id);

        if (updatePurchaseError) {
          console.error("Failed to update purchase record:", updatePurchaseError);
        }

        console.log(`Found purchase: id=${purchase.id}, granted=${purchase.credits_granted}, remaining=${purchase.credits_remaining}, deducting=${creditsToDeduct}`);
      } else {
        // No purchase record found - fallback to amount-based deduction
        console.warn("No purchase record found for payment_id:", paymentId);
        const refundAmount = data?.amount || data?.total_amount;
        
        const subscriptionInfo = SUBSCRIPTION_AMOUNT_INFO[refundAmount];
        if (subscriptionInfo) {
          creditsToDeduct = subscriptionInfo.credits;
          shouldDowngrade = true;
        } else {
          const onetimeInfo = ONETIME_AMOUNT_INFO[refundAmount];
          if (onetimeInfo) {
            creditsToDeduct = onetimeInfo.credits;
          }
        }
        console.log(`Fallback deduction by amount (${refundAmount} cents): ${creditsToDeduct} credits`);
      }

      // Update user credits (never go below 0)
      const newCredits = Math.max(0, (user.credits || 0) - creditsToDeduct);
      const updateData: { credits: number; plan?: string } = { credits: newCredits };
      
      if (shouldDowngrade) {
        updateData.plan = "Free";
      }

      const { error: updateError } = await supabase
        .from("users")
        .update(updateData)
        .eq("id", user.id);

      if (updateError) {
        console.error("Failed to process refund:", updateError);
        return new Response(JSON.stringify({ error: "Update failed" }), { status: 500 });
      }

      // Also mark active_subscription as cancelled if exists
      if (subscriptionId) {
        const { error: subUpdateError } = await supabase
          .from("active_subscriptions")
          .update({ 
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("subscription_id", subscriptionId);

        if (subUpdateError) {
          console.error("Failed to update active_subscription on refund:", subUpdateError);
        }
      }

      // ========================================
      // 🔴 关键修复：调用 Dodo API 取消订阅，阻止未来扣费
      // ========================================
      if (subscriptionId && shouldDowngrade) {
        const dodoTestKey = Deno.env.get("DODO_TEST_API_KEY");
        const dodoLiveKey = Deno.env.get("DODO_API_KEY")!;
        
        let cancelSuccess = false;
        let usedEnv = "";
        
        // 先尝试 Test 环境
        if (dodoTestKey) {
          console.log(`[REFUND] Attempting to cancel subscription ${subscriptionId} in Test environment...`);
          try {
            const testResponse = await fetch(
              `https://test.dodopayments.com/subscriptions/${subscriptionId}`,
              {
                method: "PATCH",
                headers: {
                  "Authorization": `Bearer ${dodoTestKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ status: "cancelled" }),
              }
            );
            
            if (testResponse.ok) {
              cancelSuccess = true;
              usedEnv = "test";
              console.log(`[REFUND] SUCCESS: Subscription ${subscriptionId} cancelled in Test environment`);
            } else {
              console.log(`[REFUND] Subscription not found in Test environment (status: ${testResponse.status})`);
            }
          } catch (testErr) {
            console.error(`[REFUND] Test environment error:`, testErr);
          }
        }
        
        // 如果 Test 失败或不存在，尝试 Live 环境
        if (!cancelSuccess && dodoLiveKey) {
          console.log(`[REFUND] Attempting to cancel subscription ${subscriptionId} in Live environment...`);
          try {
            const liveResponse = await fetch(
              `https://live.dodopayments.com/subscriptions/${subscriptionId}`,
              {
                method: "PATCH",
                headers: {
                  "Authorization": `Bearer ${dodoLiveKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ status: "cancelled" }),
              }
            );
            
            if (liveResponse.ok) {
              cancelSuccess = true;
              usedEnv = "live";
              console.log(`[REFUND] SUCCESS: Subscription ${subscriptionId} cancelled in Live environment`);
            } else {
              const errorText = await liveResponse.text();
              console.error(`[REFUND] FAILED to cancel subscription in Live environment: ${errorText}`);
            }
          } catch (liveErr) {
            console.error(`[REFUND] Live environment error:`, liveErr);
          }
        }
        
        if (!cancelSuccess) {
          console.error(`[REFUND] WARNING: Failed to cancel subscription ${subscriptionId} in Dodo. Manual intervention may be required.`);
        }
      }

      console.log(`SUCCESS [${DODO_MODE}]: Refund processed for ${customerEmail}. Deducted ${creditsToDeduct} credits (was ${user.credits}, now ${newCredits}). Downgraded: ${shouldDowngrade}`);
      return new Response(JSON.stringify({ 
        success: true, 
        action: "refunded",
        mode: DODO_MODE,
        creditsDeducted: creditsToDeduct,
        previousCredits: user.credits,
        newCredits: newCredits,
        downgraded: shouldDowngrade
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ========================================
// SUBSCRIPTION RENEWED - Add monthly credits (for actual renewals only, not initial subscription)
// ========================================
if (payload.type === "subscription.renewed") {
  const data = payload.data;
  const customerEmail = data?.customer?.email;
  const subscriptionId = data?.subscription_id;
  const totalAmount = data?.recurring_pre_tax_amount || data?.total_amount || data?.amount;
  const createdAt = data?.created_at;
  const previousBillingDate = data?.previous_billing_date;

  if (!customerEmail) {
    console.error("Missing customer email for renewal");
    return new Response(JSON.stringify({ error: "Missing customer email" }), { status: 400 });
  }

  if (!subscriptionId) {
    console.error("Missing subscription_id for renewal");
    return new Response(JSON.stringify({ error: "Missing subscription_id" }), { status: 400 });
  }

  // ========================================
  // CHECK: Is this the initial subscription or an actual renewal?
  // If created_at and previous_billing_date are the same (or very close), it's the initial subscription
  // In that case, payment.succeeded already handled everything - skip here
  // ========================================
  if (createdAt && previousBillingDate) {
    const createdTime = new Date(createdAt).getTime();
    const previousBillingTime = new Date(previousBillingDate).getTime();
    const timeDiffMinutes = Math.abs(createdTime - previousBillingTime) / (1000 * 60);
    
    // If the difference is less than 5 minutes, this is the initial subscription
    if (timeDiffMinutes < 5) {
      console.log(`SKIPPED: This is an initial subscription, not a renewal. subscription_id: ${subscriptionId}, created_at: ${createdAt}, previous_billing_date: ${previousBillingDate}`);
      return new Response(JSON.stringify({ 
        success: true, 
        action: "skipped_initial_subscription",
        mode: DODO_MODE,
        reason: "Initial subscription - handled by payment.succeeded",
        subscriptionId: subscriptionId
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ========================================
  // This is an actual renewal (30+ days after initial subscription)
  // ========================================
  
  // Determine credits based on subscription amount
  let creditsToAdd = 0;
  let productType = "unknown";
  
  const subscriptionInfo = SUBSCRIPTION_AMOUNT_INFO[totalAmount];
  if (subscriptionInfo) {
    creditsToAdd = subscriptionInfo.credits;
    productType = subscriptionInfo.type;
  } else {
    // Default to monthly if can't determine
    creditsToAdd = 3000;
    productType = "pro_monthly";
  }

  // For yearly renewals, skip - yearly credits are handled differently
  if (productType === "pro_yearly") {
    console.log(`Yearly subscription renewal detected for ${customerEmail} - credits handled separately`);
    return new Response(JSON.stringify({ 
      success: true, 
      action: "yearly_renewal_acknowledged",
      mode: DODO_MODE,
      note: "Yearly credits handled by separate process"
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Find user
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, credits, plan")
    .eq("email", customerEmail)
    .single();

  if (userError || !user) {
    console.error("User not found for renewal:", customerEmail);
    return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
  }

  // Add credits for monthly renewal
  const newCredits = (user.credits || 0) + creditsToAdd;
  const { error: updateError } = await supabase
    .from("users")
    .update({ credits: newCredits, plan: "Pro" })
    .eq("id", user.id);

  if (updateError) {
    console.error("Failed to add renewal credits:", updateError);
    return new Response(JSON.stringify({ error: "Update failed" }), { status: 500 });
  }

  // Create purchase record for this actual renewal
  const renewalPaymentId = `renewal_${subscriptionId}_${Date.now()}`;
  const { error: purchaseError } = await supabase
    .from("purchases")
    .insert({
      user_id: user.id,
      user_email: customerEmail,
      payment_id: renewalPaymentId,
      subscription_id: subscriptionId,
      product_type: productType,
      amount_cents: totalAmount || 2900,
      credits_granted: creditsToAdd,
      credits_remaining: creditsToAdd,
    });

  if (purchaseError) {
    console.error("Failed to create renewal purchase record:", purchaseError);
  }

  // Update active_subscription next_issue_at
  const { error: subUpdateError } = await supabase
    .from("active_subscriptions")
    .update({
      next_issue_at: getNextIssueDate(),
      months_issued: supabase.rpc('increment_months_issued', { sub_id: subscriptionId }),
      updated_at: new Date().toISOString(),
    })
    .eq("subscription_id", subscriptionId);

  if (subUpdateError) {
    console.error("Failed to update active_subscription:", subUpdateError);
  }

  console.log(`SUCCESS [${DODO_MODE}]: Monthly subscription RENEWED for ${customerEmail}. Added ${creditsToAdd} credits. New total: ${newCredits}`);
  return new Response(JSON.stringify({ 
    success: true, 
    action: "renewed", 
    mode: DODO_MODE, 
    creditsAdded: creditsToAdd,
    newTotal: newCredits
  }), {
    headers: { "Content-Type": "application/json" },
  });
}

    // ========================================
    // SUBSCRIPTION CANCELLED - Mark subscription as cancelled
    // ========================================
    if (payload.type === "subscription.cancelled") {
      const data = payload.data;
      const subscriptionId = data?.subscription_id;
      const customerEmail = data?.customer?.email;

      if (subscriptionId) {
        const { error: subUpdateError } = await supabase
          .from("active_subscriptions")
          .update({ 
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("subscription_id", subscriptionId);

        if (subUpdateError) {
          console.error("Failed to mark subscription as cancelled:", subUpdateError);
        } else {
          console.log(`SUCCESS [${DODO_MODE}]: Subscription ${subscriptionId} marked as cancelled for ${customerEmail}`);
        }
      }

      return new Response(JSON.stringify({ 
        success: true, 
        action: "subscription_cancelled",
        mode: DODO_MODE,
        subscriptionId: subscriptionId
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ========================================
    // OTHER EVENTS - Log and acknowledge
    // ========================================
    console.log(`Acknowledged event type [${DODO_MODE}]:`, payload.type);
    return new Response(JSON.stringify({ success: true, acknowledged: true, type: payload.type, mode: DODO_MODE }), {
      headers: { "Content-Type": "application/json" },
    });
    
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: "Internal error", details: String(error) }), { status: 500 });
  }
});
