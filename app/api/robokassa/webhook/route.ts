import { NextRequest, NextResponse } from 'next/server';
import { robokassaClient, WebhookData } from '@/lib/robokassa/client';
import { db } from '@/lib/db';
import { subscription, payment, user } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateId } from 'ai';

/**
 * Robokassa webhook handler for processing payment notifications
 * POST /api/robokassa/webhook
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🔔 Robokassa webhook received');
    
    // Parse form data from Robokassa
    const formData = await request.formData();
    const webhookData: WebhookData = {
      OutSum: formData.get('OutSum') as string,
      InvId: formData.get('InvId') as string,
      SignatureValue: formData.get('SignatureValue') as string,
      PaymentMethod: formData.get('PaymentMethod') as string || undefined,
      IncCurrLabel: formData.get('IncCurrLabel') as string || undefined,
      Shp_UserId: formData.get('Shp_UserId') as string || undefined,
      Shp_PlanType: formData.get('Shp_PlanType') as string || undefined,
      Shp_IsRecurring: formData.get('Shp_IsRecurring') as string || undefined,
    };
    
    console.log('📦 Webhook data:', {
      invoiceId: webhookData.InvId,
      amount: webhookData.OutSum,
      userId: webhookData.Shp_UserId,
      planType: webhookData.Shp_PlanType,
    });
    
    // Verify webhook signature
    if (!robokassaClient.verifyWebhookSignature(webhookData)) {
      console.error('❌ Invalid webhook signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }
    
    // Process payment success
    const paymentData = await robokassaClient.processPaymentSuccess(webhookData);
    
    if (!paymentData.userId) {
      console.error('❌ Missing user ID in webhook data');
      return NextResponse.json(
        { error: 'Missing user ID' },
        { status: 400 }
      );
    }
    
    // Check if user exists
    const existingUser = await db.select().from(user).where(eq(user.id, paymentData.userId)).limit(1);
    if (!existingUser.length) {
      console.error('❌ User not found:', paymentData.userId);
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }
    
    // Create or update payment record
    const paymentId = generateId();
    await db.insert(payment).values({
      id: paymentId,
      userId: paymentData.userId,
      merchantLogin: process.env.ROBOKASSA_MERCHANT_LOGIN!,
      invoiceId: paymentData.invoiceId,
      signatureValue: webhookData.SignatureValue,
      amount: paymentData.amount,
      currency: 'RUB',
      description: `${paymentData.planType} subscription payment`,
      status: 'success',
      paymentType: paymentData.isRecurring ? 'recurring' : 'one_time',
      paymentMethod: webhookData.PaymentMethod,
      paidAt: new Date(),
      robokassaData: webhookData,
      metadata: {
        planType: paymentData.planType,
        isRecurring: paymentData.isRecurring,
      },
    });
    
    console.log('💳 Payment record created:', paymentId);
    
    // Handle subscription creation/update
    if (paymentData.isRecurring) {
      await handleRecurringSubscription(paymentData, paymentId);
    } else {
      await handleOneTimePayment(paymentData, paymentId);
    }
    
    console.log('✅ Webhook processed successfully');
    
    // Return success response (required by Robokassa)
    return new NextResponse('OK', { status: 200 });
    
  } catch (error) {
    console.error('❌ Error processing Robokassa webhook:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Handle recurring subscription creation/renewal
 */
async function handleRecurringSubscription(
  paymentData: {
    userId: string;
    planType: string;
    amount: number;
    invoiceId: string;
    isRecurring: boolean;
  },
  paymentId: string
) {
  try {
    // Check for existing active subscription
    const existingSubscriptions = await db
      .select()
      .from(subscription)
      .where(eq(subscription.userId, paymentData.userId));
    
    const activeSubscription = existingSubscriptions.find(
      sub => sub.status === 'active' && sub.planType === paymentData.planType
    );
    
    const now = new Date();
    const recurringInterval = paymentData.planType === 'ultra' ? 'yearly' : 'monthly';
    const periodEnd = new Date(now);
    
    if (recurringInterval === 'monthly') {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    } else {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    }
    
    if (activeSubscription) {
      // Extend existing subscription
      await db
        .update(subscription)
        .set({
          currentPeriodEnd: periodEnd,
          lastPaymentId: paymentId,
          nextPaymentDate: periodEnd,
          updatedAt: now,
          failedPaymentsCount: 0, // Reset failed payments counter
        })
        .where(eq(subscription.id, activeSubscription.id));
      
      console.log('🔄 Subscription renewed:', activeSubscription.id);
    } else {
      // Create new subscription
      const subscriptionId = generateId();
      await db.insert(subscription).values({
        id: subscriptionId,
        userId: paymentData.userId,
        merchantLogin: process.env.ROBOKASSA_MERCHANT_LOGIN!,
        recurringId: paymentData.invoiceId, // Use invoice ID as recurring ID for now
        subscriptionId: subscriptionId,
        planType: paymentData.planType,
        amount: paymentData.amount,
        currency: 'RUB',
        recurringInterval,
        status: 'active',
        startedAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        lastPaymentId: paymentId,
        nextPaymentDate: periodEnd,
        failedPaymentsCount: 0,
        metadata: {
          createdFromPayment: paymentId,
          initialInvoiceId: paymentData.invoiceId,
        },
      });
      
      // Update payment with subscription ID
      await db
        .update(payment)
        .set({ subscriptionId })
        .where(eq(payment.id, paymentId));
      
      console.log('🆕 New subscription created:', subscriptionId);
    }
  } catch (error) {
    console.error('❌ Error handling recurring subscription:', error);
    throw error;
  }
}

/**
 * Handle one-time payment (temporary access)
 */
async function handleOneTimePayment(
  paymentData: {
    userId: string;
    planType: string;
    amount: number;
    invoiceId: string;
    isRecurring: boolean;
  },
  paymentId: string
) {
  try {
    // Create temporary subscription for one-time payment
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1); // 1 month access
    
    const subscriptionId = generateId();
    await db.insert(subscription).values({
      id: subscriptionId,
      userId: paymentData.userId,
      merchantLogin: process.env.ROBOKASSA_MERCHANT_LOGIN!,
      subscriptionId: subscriptionId,
      planType: paymentData.planType,
      amount: paymentData.amount,
      currency: 'RUB',
      recurringInterval: 'monthly',
      status: 'active',
      startedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      lastPaymentId: paymentId,
      cancelAtPeriodEnd: true, // Auto-cancel for one-time payments
      failedPaymentsCount: 0,
      metadata: {
        isOneTimePayment: true,
        createdFromPayment: paymentId,
        initialInvoiceId: paymentData.invoiceId,
      },
    });
    
    // Update payment with subscription ID
    await db
      .update(payment)
      .set({ subscriptionId })
      .where(eq(payment.id, paymentId));
    
    console.log('💰 One-time payment subscription created:', subscriptionId);
  } catch (error) {
    console.error('❌ Error handling one-time payment:', error);
    throw error;
  }
}

// Handle GET requests (for testing)
export async function GET() {
  return NextResponse.json({
    message: 'Robokassa webhook endpoint',
    timestamp: new Date().toISOString(),
  });
}